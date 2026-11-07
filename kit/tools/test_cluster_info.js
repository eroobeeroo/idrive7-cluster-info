'use strict';

// Cluster Info (apps/cluster_info) on the current kit with stubbed car signals, and eDrive Live's provider
// (apps/edrive2/provider.js) next to it in a temporary folder: the panel's values come through the folder, the
// provider writes only while Cluster Info's panel wants them, and the page draws. No SDK or car needed:
//   node kit/tools/test_cluster_info.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..'), KIT = path.join(ROOT, 'kit', 'runtime');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
process.env.CLUSTER_INFO_DIR = path.join(tmp, 'cluster-info');
process.env.WOC_STATUS = path.join(tmp, 'woc', 'status.json');
fs.mkdirSync(path.dirname(process.env.WOC_STATUS));
fs.writeFileSync(process.env.WOC_STATUS, JSON.stringify({ state: 'showing', target: 'map', hud_width_pct: 0 }));

let app = null;
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req === './kit/mgu') return { run(a) { app = a; } };
    if (req.startsWith('./kit/')) return load.call(this, path.join(KIT, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'cluster_info', 'app.json'), 'utf8'));
const themes = require(path.join(KIT, 'themes'));
const { Recorder: Canvas } = require(path.join(KIT, 'record'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };

(async () => {
    const S = {};
    SPEC.settings.forEach((s) => { S[s.key] = s.default; });
    const handlers = {}, warns = [], loops = {};
    const ctx = {
        app: {}, ui: { onClick() {}, text() {}, image: async () => {} },
        settings: { get: (k) => S[k], set: (k, v) => { S[k] = v; }, onChange() {}, display: (k) => String(S[k]) },
        log: { info() {}, warn: (m) => warns.push(m), error: (m, e) => warns.push(m + ' ' + e) },
        spec: SPEC, dataDir: tmp,
        signals: { watch: (iface, inst, h) => { Object.assign(handlers, h); return Promise.resolve({ available: true }); } },
        onTab() {}, hideButton() {}, onScroll() {},
        loop: (name, fps, fn) => { loops[name] = fn; },
        theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Canvas(w, h),
    };
    require(path.join(ROOT, 'apps', 'cluster_info', 'main.js'));
    await app.start(ctx);
    await sleep(1300);
    const dir = process.env.CLUSTER_INFO_DIR;
    check('the shared folder is made, open to every app (sticky)', () => assert((fs.statSync(dir).mode & 0o1777) === 0o1777));
    check('the panel is up over the map: wanted.json says what it shows', () => {
        const w = JSON.parse(fs.readFileSync(path.join(dir, 'wanted.json'), 'utf8'));
        assert(w.power === true && w.values.indexOf('battery') >= 0 && w.values.indexOf('oil') >= 0, JSON.stringify(w));
    });

    // eDrive Live's provider beside it
    const { startProvider } = require(path.join(ROOT, 'apps', 'edrive2', 'provider.js'));
    let fast = 0;
    const prov = startProvider({ info() {}, warn: (m) => warns.push(m) }, {
        on: () => true, power: () => ({ kw: -1.6, old: false }), limits: () => ({ out: 120, in: 60 }), gaugeKw: () => 100,
        battery: () => 28.3, oil: () => 81, soc: () => 64.4, keepFast: () => { fast++; },
    });
    await sleep(700);
    check('the provider writes while wanted, and keeps its reads fast', () => {
        const f = JSON.parse(fs.readFileSync(path.join(dir, 'edrive2.json'), 'utf8'));
        assert(f.power.kw === -1.6 && f.values.battery.c === 28.3 && f.values.oil.c === 81 && f.values.soc.pct === 64.4 && fast > 0 && prov.status().wanted);
    });
    check('Cluster Info reads the provider\'s battery charge (a percentage)', () => {
        const { startProviders } = require(path.join(ROOT, 'apps', 'cluster_info', 'providers.js'));
        const r = startProviders({ info() {}, warn() {} }, { dir, setInterval: () => 0 });
        const v = r.value('soc');
        assert(v && v.pct === 64.4, JSON.stringify(v));
    });
    // the car's own oil temperature wins over a provider's
    handlers.statusEngineTemperature && handlers.statusEngineTemperature({ temperatureEngineDrive: 48 + 90, temperatureEngineOilDrive: 48 + 95 });
    await sleep(400);
    await loops.MAIN();
    check('the page draws without errors', () => assert(!warns.some((w) => /TypeError|ReferenceError|is not a function/.test(w)), warns.join(' | ')));

    // the panel goes: the provider stops and removes its file
    fs.writeFileSync(process.env.WOC_STATUS, JSON.stringify({ state: 'idle', target: 'map', hud_width_pct: 0 }));
    await sleep(4500);
    check('panel down: the provider stops writing and removes its file', () => assert(!fs.existsSync(path.join(dir, 'edrive2.json')) && !prov.status().wanted));
    // the turn signals and day / night as the car sends them (names, from photos of this app's page on a G05)
    const IND = require(path.join(ROOT, 'apps', 'cluster_info', 'indicators.js'));
    check('turn signals by name: right, left, hazards, off; day / night by name', () => {
        assert.strictEqual(IND.direction('DAUER_BLINKEN_RECHTS_EIN', 'DAUERBLINKEN_RECHTS'), 'right');
        assert.strictEqual(IND.direction('DAUER_BLINKEN_LINKS_EIN', 'DAUERBLINKEN_LINKS'), 'left');
        assert.strictEqual(IND.direction('BEIDSEITIGES_BLINKEN_EIN', 'WARNBLINKEN_MANUELL'), 'both');
        assert.strictEqual(IND.direction('TIPP_BLINKEN_LINKS_EIN', 'TIPPBLINKEN_LINKS'), 'left');
        assert.strictEqual(IND.direction('BLINKEN_AUS', 'BLINKEN_AUS'), 'off');
        assert.strictEqual(IND.direction(4, 8), 'right');
        assert.strictEqual(IND.night('TAG'), false); assert.strictEqual(IND.night('NACHT'), true); assert.strictEqual(IND.night('KEINE_AENDERUNG'), null);
    });
    console.log(ok + ' checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
