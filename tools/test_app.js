'use strict';
/**
 * test_app.js - the whole app (apps/cluster_layouts/main.js) on the kit with stubbed car signals and a
 * recording stand-in for the cluster render client: off by default, on with the page's button, the car's
 * readings reach the cluster as needle values and glyph codes, and the page draws. No SDK or car needed:
 *   node tools/test_app.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { FakeClient, APP, KIT } = require('./scene');

let app = null, client = null;
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './kit/mgu') return { run(a) { app = a; } };
    if (req === './cluster_render_client') return { ClusterRender: function () { client = new FakeClient(); return client; } };
    return load.call(this, req, parent, isMain);
};
process.env.SOMEIP_CATALOG = '/nonexistent/someip-interfaces.json';
process.env.CLUSTER_INFO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
process.env.CLUSTER_PRESENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const themes = require(path.join(KIT, 'themes'));
const { Recorder: Canvas } = require(path.join(KIT, 'record'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };

(async () => {
    const S = {}, changes = [];
    SPEC.settings.forEach((s) => { S[s.key] = s.default; });
    const handlers = {}, clicks = {}, warns = [];
    let pages = 0;
    const ctx = {
        app: {}, ui: { onClick(n, fn) { clicks[n] = fn; }, text() {}, image: async () => { pages++; } },
        settings: { get: (k) => S[k], set: (k, v) => { S[k] = v; changes.forEach((f) => f(k, v)); }, onChange(f) { changes.push(f); }, display: (k) => String(S[k]) },
        log: { info() {}, warn: (m) => warns.push(m), error: (m, e) => warns.push(m + ' ' + e) },
        spec: SPEC, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cl-')),
        signals: { watch: (iface, inst, h) => { Object.assign(handlers, h); return Promise.resolve({ available: true }); },
            proxy: () => Promise.reject(new Error('no TASU here')), on: () => Promise.resolve(), onAvailable: () => Promise.resolve() },
        loop() {}, theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Canvas(w, h),
    };
    require(path.join(APP, 'main.js'));
    await app.start(ctx);
    await sleep(300);
    const effects = () => Array.from(client.layers.values()).filter((l) => l.kind === 'effect');
    check('every signal the app reads is declared in app.json', () => {
        const declared = [].concat(...Object.keys(SPEC.signals).map((i) => Object.keys(SPEC.signals[i])));
        Object.keys(handlers).forEach((h) => assert(declared.indexOf(h) >= 0, h));
    });
    const eng = () => require(path.join(APP, 'engine')).startCluster.last;
    check('off by default: no layers at all (the stock cluster shows)', () => {
        assert(effects().length === 0, 'no layers while off: hidden ones count against the renderer\'s limits');
    });
    await clicks.BTN_SHOW();
    await sleep(120);
    check('shown after the button', () => assert(effects().every((l) => l.opts.visible === true)));
    // the car: 50 mph, 2500 rpm, D3, oil 100 C
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: Math.round(50 * 1.609344 / 0.015625) });
    handlers.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 2500 / 0.25 });
    handlers.statusGearboxDrive({ statusActualGearDrive: 'G3', statusActualStageDrive: 'D' });
    handlers.statusEngineTemperature({ temperatureEngineDrive: 90 + 48, temperatureEngineOilDrive: 100 + 48 });
    handlers.ExteriorTemperature({ temperatureExterior: (9 + 40) * 2 });
    await sleep(1500);
    check('the readings reach the cluster: needles and texts', () => {
        const dial = (max) => eng()._pieces().find((p) => p.kind === 'dial' && p.params.u_scale[0] === max);
        assert(Math.abs(dial(160).value - 50) < 0.5, 'speed ' + dial(160).value);
        assert(Math.abs(dial(8).value - 2.5) < 0.02, 'rpm ' + dial(8).value);
        const texts = eng()._pieces().filter((p) => p.text !== null).map((p) => p.text);
        ['D3', '50'].forEach((t) => assert(texts.indexOf(t) >= 0, t + ' in ' + JSON.stringify(texts)));
    });
    check('a colour change sends uniforms only', () => {
        client.reset();
        ctx.settings.set('look', 'sport');
        assert(client.log.length > 0 && client.log.every((m) => m.op === 'uniform'));
    });
    check('km/h: the layout is made again with the km/h scale', () => {
        ctx.settings.set('speedUnit', 'kmh');
        const dial = eng()._pieces().find((p) => p.kind === 'dial');
        assert.strictEqual(dial.params.u_scale[0], 260);
    });
    await sleep(200);
    check('the page draws', () => assert(pages > 0));
    check('warnings only for what this machine lacks (no catalog, no diagnostic link)', () => assert(warns.some((w) => /catalog not readable/.test(w)) && warns.every((w) => /catalog not readable|TASU/.test(w)), JSON.stringify(warns)));
    check('outside temperature read (9 °C -> 48 °F on the layouts)', () => {
        const texts = eng()._pieces().filter((p) => p.text !== null).map((p) => p.text);
        assert(texts.some((x) => /^48°/.test(x)), JSON.stringify(texts));
    });
    console.log(ok + ' passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
