'use strict';
/**
 * test_centre.js - Cluster Centre: the warm-up, cool-down and 0-60 logic with a made-up clock; every page's
 * pieces (inside the centre, texts that fit, colours that exist); page switching sends only visibility; and
 * the whole app on stubbed signals with a recording render client.
 *   node tools/test_centre.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { FakeClient, KIT } = require('./scene');

const APP = path.join(__dirname, '..', 'apps', 'cluster_centre');
const RESERVED = ['u_mvp', 'u_mv', 'u_m', 'u_v', 'u_p', 'u_normal'];   // the renderer's matrix names (PROTOCOL.md)
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };
const { WarmUp, CoolDown, PerfTimer, QUARTER_M } = require(path.join(APP, 'features'));
const { PAGES, pieces, palette, W, H } = require(path.join(APP, 'pages'));
const { READINGS, view } = require(path.join(APP, 'readings'));
const { sample } = require('./preview_centre');

/* ---------- the logic ---------- */
check('warm-up: rate, minutes to the target, and the rev limit rising with the oil', () => {
    const w = new WarmUp({ target: 90, coldLimit: 3500, redline: 6500 });
    for (let i = 0; i <= 24; i++) w.feed(i * 5000, { oil: 50 + i * 0.5 });          // 6 °C a minute
    const s = w.state({ oil: 62 });
    assert(Math.abs(w.rate() - 6) < 0.01);
    assert(Math.abs(s.minutes - 28 / 6) < 0.01 && !s.ready);
    assert.strictEqual(s.limit, 4800);                                              // 3500 + 3000 * 22/50 = 4820, to 100 rpm
    assert(w.state({ oil: 91 }).ready && w.state({ oil: 91 }).limit === 6500);
});
check('cool-down: hard driving builds it (30 s to 3 min), gentle driving counts it down', () => {
    const c = new CoolDown({ hardRpm: 4500 });
    for (let t = 0; t <= 20000; t += 200) c.feed(t, { rpm: 5500 });
    assert(c.state().active && c.state().seconds === 60, String(c.state().seconds));
    for (let t = 20200; t <= 50000; t += 200) c.feed(t, { rpm: 3500 });          // above gentle: no count-down
    assert.strictEqual(c.state().seconds, 60);
    for (let t = 50200; t <= 130000; t += 200) c.feed(t, { rpm: 1500 });
    assert(!c.state().active);
});
check('0-60 and quarter mile: from a standstill at a steady 0.5 g', () => {
    const p = new PerfTimer({ kmh: false });
    p.arm();
    p.feed(0, { speed: 0 });
    assert.strictEqual(p.mode, 'ready');
    const a = 0.5 * 9.80665 * 3.6;                                                  // km/h a second
    let t = 1000;
    for (; t < 40000 && p.mode !== 'done'; t += 50) p.feed(t, { speed: Math.max(0.8, a * (t - 1000) / 1000) });
    const r = p.state(t).last;
    assert(Math.abs(r.sixty - 96.56 / a) < 0.1, 'sixty ' + r.sixty);             // 5.47 s
    assert(Math.abs(r.quarter - Math.sqrt(2 * QUARTER_M / (a / 3.6))) < 0.15, 'quarter ' + r.quarter);
    assert(p.state(t).best.sixty === r.sixty);
});

/* ---------- the pages ---------- */
const units = { temp: 'f', press: 'psi', speed: 'mph', torque: 'lbft' };
const opts = (extra) => Object.assign({ pages: Object.keys(PAGES), style: 'bar', accent: 'blue', size: 'normal', units, warn: {}, shift: { on: true, from: 4000, at: 6200 }, badge: true,
    custom: [{ style: 'bar', slots: Object.keys(READINGS).slice(0, 6) }, { style: 'arc', slots: Object.keys(READINGS).slice(6, 12) }] }, extra);
['bar', 'arc', 'number'].forEach((style) => check('pages (' + style + ' tiles): every piece inside the centre, texts up to 32 glyphs, colours that exist', () => {
    const ps = pieces(opts({ style })), t = palette('orange'), d = sample({ rpm: 6300 });
    assert(ps.length > 100);
    ps.forEach((p) => {
        assert(p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H, p.key + ' ' + [p.x, p.y, p.w, p.h]);
        if (p.kind === 'text') { const s = typeof p.text === 'function' ? p.text(d, t) : p.text; assert(String(s).length <= 32, p.key + ': ' + s); }
        if (p.colors) { const c = p.colors(t, d); Object.keys(c).forEach((k) => { const v = Array.isArray(c[k]) ? c[k][0] : c[k]; assert(/^#[0-9a-f]{6}$/i.test(v), p.key + '.' + k + ' ' + v); }); }
    });
}));
check('every reading has a view in each unit set', () => {
    const d = sample({ rpm: 3000 });
    Object.keys(READINGS).forEach((k) => [units, { temp: 'c', press: 'bar', speed: 'kmh', torque: 'nm' }].forEach((u) => {
        const v = view(k, d, u);
        assert(typeof v.text === 'string' && v.frac >= 0 && v.frac <= 1, k);
    }));
    assert.strictEqual(view('oil', { oil: 100 }, units).text, '212');
    assert.strictEqual(view('hpfp', { hpfp: 100 }, units).text, '1450');
    assert.strictEqual(view('oil', { oil: 131 }, units, {}).level, 'warn');
    assert.strictEqual(view('oil', { oil: 121 }, units, { oilHigh: 120 }).level, 'warn');
});

/* ---------- on the cluster: groups ---------- */
check('pages are groups: a page is built alone, a layer a piece; a switch puts the new page up before the old goes', () => {
    const { startCluster } = require(path.join(APP, 'engine'));
    const client = new FakeClient(), d = sample({ rpm: 3000 });
    const e = startCluster({ client, log: { info() {}, warn(m) { throw new Error(m); } }, target: 'map', contend: true, z: 200, layout: () => ({ id: 'c', pieces }), options: () => opts(),
        theme: () => palette('blue'), data: () => d, live: () => true, enabled: () => true, sweep: () => false, group: 'temps' });
    e._tick();
    const effects = () => Array.from(client.layers.values()).filter((l) => l.kind === 'effect');
    assert(effects().every((l) => l.opts.target === 'map' && l.opts.contend === true && l.opts.visible));
    assert(e._pieces().every((p) => !p.group || p.group === 'temps'));
    e._groups().forEach((g) => {
        let live = effects().length, peak = live;
        const add = client.effect.bind(client), drop = client.drop.bind(client);
        client.effect = (o) => { live++; peak = Math.max(peak, live); return add(o); };
        client.drop = (r) => { if (client.layers.get(r) && client.layers.get(r).kind === 'effect') live--; return drop(r); };
        client.reset();
        e.setGroup(g);
        client.effect = add; client.drop = drop;
        assert(effects().length === e._pieces().length, g + ': one layer a piece, only this page');
        assert(peak <= 60, g + ': ' + peak + ' layers at once during the switch (the service allows 64 an app)');
        assert(effects().every((l) => l.opts.visible), g + ': shown at once');
        assert(!client.log.some((m) => m.op === 'pixels'));
        effects().forEach((l) => Object.keys(l.uniforms).forEach((k) => assert(l.uniforms[k].v.length <= 1024, g + ' ' + k)));
        effects().forEach((l) => RESERVED.forEach((n) => assert(!new RegExp('(^|[^A-Za-z0-9_])' + n + '($|[^A-Za-z0-9_])').test(l.opts.fs), g + ': ' + n)));
        assert(e._pieces().length > 3 && e._pieces().every((p) => !p.group || p.group === g), g);
        console.log('     ' + g + ': ' + e._pieces().length + ' pieces, ' + peak + ' layers at most during the switch, ' + (client.bytes / 1024).toFixed(1) + ' KB');
    });
    e.setGroup('xdrive');
    client.reset();
    for (let i = 0; i < 25 * 30; i++) { d.rpm = 2500 + 2000 * Math.sin(i / 20); d.splitRear = 60 + 20 * Math.sin(i / 30); e._tick(); }
    console.log('     driving on the xDrive page: ' + (client.bytes / 30 / 1024).toFixed(1) + ' KB/s');
    assert(client.bytes / 30 < 12 * 1024);
    e.stop();
});

/* ---------- the app ---------- */
(async () => {
    process.env.SOMEIP_CATALOG = '/nonexistent/someip-interfaces.json';
    process.env.CLUSTER_INFO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
    process.env.CLUSTER_PRESENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    let app = null, client = null;
    const load = Module._load;
    Module._load = function (req, parent, isMain) {
        if (req === './kit/mgu') return { run(a) { app = a; } };
        if (req === './cluster_render_client') return { ClusterRender: function () { client = new FakeClient(); return client; } };
        return load.call(this, req, parent, isMain);
    };
    const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
    const themes = require(path.join(KIT, 'themes'));
    const { Canvas } = require(path.join(KIT, 'canvas'));
    const S = {}, changes = [], clicks = {}, handlers = {}, warns = [];
    SPEC.settings.forEach((s) => { S[s.key] = s.default; });
    let pages = 0, lastImage = null;
    const ctx = {
        app: {}, ui: { onClick(n, fn) { clicks[n] = fn; }, text() {}, image: async (n, cv) => { pages++; lastImage = cv; } },
        settings: { schema: SPEC.settings, get: (k) => S[k], set: (k, v) => { S[k] = v; changes.forEach((f) => f(k, v)); }, onChange(f) { changes.push(f); }, display: (k) => String(S[k]) },
        log: { info() {}, warn: (m) => warns.push(m), error: (m, e) => warns.push(m + ' ' + e) },
        spec: SPEC, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')),
        signals: {
            watch: (iface, inst, h) => { Object.assign(handlers, h); return Promise.resolve({ available: true }); },
            proxy: () => Promise.reject(new Error('no TASU here')), on: () => Promise.resolve(), onAvailable: () => Promise.resolve(),
        },
        loop() {}, theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Canvas(w, h),
    };
    require(path.join(APP, 'main.js'));
    await app.start(ctx);
    await new Promise((r) => setTimeout(r, 300));
    const effects = () => Array.from(client.layers.values()).filter((l) => l.kind === 'effect');
    check('app: every signal it reads is declared in app.json', () => {
        const declared = [].concat(...Object.keys(SPEC.signals).map((i) => Object.keys(SPEC.signals[i])));
        Object.keys(handlers).forEach((h) => assert(declared.indexOf(h) >= 0, h));
    });
    const eng = () => require(path.join(APP, 'engine')).startCluster.last;
    check('app: off by default: no layers, the stock map shows', () => assert(effects().length === 0));
    await clicks.BTN_SHOW();
    handlers.statusCarSpeed2({ speedVehicleCentreOfGravity: Math.round(40 / 0.015625) });
    handlers.statusEngineSpeed2({ actualValueRPMEngineCrankshaft: 2000 / 0.25 });
    handlers.statusEngineTemperature({ temperatureEngineDrive: 90 + 48, temperatureEngineOilDrive: 100 + 48 });
    await new Promise((r) => setTimeout(r, 400));
    const page = () => eng().group();
    check('app: shown, one page at a time (the first chosen)', () => assert(effects().every((l) => l.opts.visible) && page() && eng()._pieces().every((p) => !p.group || p.group === page())));
    const before = page();
    await clicks.BTN_NEXT();
    check('app: Next page shows another page', () => assert(page() && page() !== before && effects().every((l) => l.opts.visible)));
    await clicks.BTN_ARM();
    await new Promise((r) => setTimeout(r, 200));
    check('app: Arm 0-60 shows the timer page armed', () => {
        const texts = eng()._pieces().filter((p) => p.text !== null).map((p) => p.text);
        assert(texts.indexOf('STOP THE CAR') >= 0 || texts.indexOf('READY - GO WHEN YOU ARE') >= 0, JSON.stringify(texts));
    });
    check('app: a colour change sends colours only', () => { client.reset(); ctx.settings.set('accent', 'orange'); assert(client.log.length > 0 && client.log.every((m) => m.op === 'uniform')); });
    check('app: turning a page off rebuilds the pages without it', () => {
        assert(eng()._groups().indexOf('edrive') >= 0);
        ctx.settings.set('page_edrive', 'off');
        assert(eng()._groups().indexOf('edrive') < 0);
    });
    check('app: the screen shows the page preview', () => assert(pages > 0 && lastImage && lastImage.w === 1600));
    check('app: warnings only for what this machine lacks (no diagnostic link, no catalog)', () => assert(warns.every((w) => /TASU|catalog/.test(w)), JSON.stringify(warns)));
    console.log(ok + ' passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
