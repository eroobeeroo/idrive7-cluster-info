'use strict';

// eDrive Live (apps/edrive2) starts on the current kit, with a stubbed diagnostic link: it draws every page in demo
// mode and with no reading, its widget, and the map overlay is wired to its power. No SDK or vehicle needed:
//   node kit/tools/test_edrive_live.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..'), KIT = path.join(ROOT, 'kit', 'runtime');
const APP = path.join(ROOT, 'apps', 'edrive2');
const SPEC = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const themes = require(path.join(KIT, 'themes'));
const { Recorder: Canvas } = require(path.join(KIT, 'record'));   // what the kit draws into (display.js)

let app = null, phys = [];
class FakeDiag extends EventEmitter {
    constructor() { super(); this.available = true; this.busyMs = 1000; FakeDiag.last = this; }
    init() {}
    async physical(target, sid, data, timeoutMs, accept, opts) { phys.push(opts); return null; }
}
class FakeReader {
    constructor(diag) { this.diag = diag; this.raws = {}; }
    key(c) { return c.did; }
    async read(p) { await this.diag.physical(p.ecu, 0x22, [], p.timeoutMs, null, p.diagOpts); return null; }
}
const stubs = {
    './kit/mgu': { run(a) { app = a; } },
    './kit/diag': { Diag: FakeDiag, hex: require(path.join(KIT, 'diag')).hex },
    './kit/dids': { DidReader: FakeReader },
};
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (stubs[req]) return stubs[req];
    if (req.startsWith('./kit/')) return load.call(this, path.join(KIT, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edrive-live-'));
    const S = {};
    SPEC.settings.forEach((s) => { S[s.key] = s.default; });
    const loops = {}, clicks = {}, warns = [];
    let widgetDraw = null;
    const ctx = {
        app: {}, ui: { onClick: (id, fn) => { clicks[id] = fn; }, text() {}, image: async () => {} },
        settings: { get: (k) => S[k], onChange() {} },
        log: { info() {}, warn: (m) => warns.push(m), error: (m, e) => warns.push(m + ' ' + e) },
        spec: SPEC, dataDir: dir,
        signals: { watch: () => Promise.resolve({}) },
        onTab() {}, hideButton() {}, onScroll() {},
        loop: (name, fps, fn) => { loops[name] = fn; },
        theme: () => themes.theme('m_tricolour'), canvas: (w, h) => new Canvas(w, h),
        widget: { loop: (fps, fn) => { widgetDraw = fn; }, onChange() {}, active: () => false, set() {}, instances: () => [] },
    };
    require(path.join(APP, 'main.js'));
    assert(app && typeof app.start === 'function', 'the app registers with mgu.run');
    await app.start(ctx);
    assert(loops.MAIN, 'the main loop is started');

    const pages = Math.max(1, (SPEC.screens && SPEC.screens.length) || 3);
    for (const demo of ['on', 'off']) {
        S.demo = demo;
        for (let i = 0; i < pages + 2; i++) {
            await loops.MAIN();
            if (clicks.BTN_PAGE) await clicks.BTN_PAGE();
        }
        if (widgetDraw) await widgetDraw({ spawnId: 1, big: true, visible: true, w: 384, h: 256 });
    }
    assert(!warns.some((w) => /TypeError|ReferenceError|is not a function/.test(w)), 'no errors drawn: ' + warns.join(' | '));
    // its requests carry the short waits (the kit's diag.js takes them per request)
    phys = [];
    await FakeDiag.last.physical(7, 0x22, [0xdd, 0x68], 1000, null);
    await FakeDiag.last.physical(7, 0x22, [0xdd, 0x68], 1000, null, { pendingTimeoutMs: 1500 });
    assert(FakeDiag.last.busyMs === 150, 'busy retries 150 ms apart');
    assert(phys.length === 2 && phys.every((o) => o && o.callTimeoutMs === 2000 && o.pendingTimeoutMs === 1500), 'short waits on every request');
    assert.ok(SPEC.settings.some((s) => s.key === 'clusterInfo'), 'the Cluster Info setting');
    assert.ok(fs.existsSync(path.join(APP, 'provider.js')) && !fs.existsSync(path.join(APP, 'overlay.js')), 'a provider for Cluster Info, no panel of its own');
    console.log('eDrive Live ' + SPEC.version + ': starts and draws on the current kit (' + Object.keys(clicks).length + ' buttons)');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
