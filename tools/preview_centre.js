'use strict';
/**
 * preview_centre.js - draws a Cluster Centre page as the cluster would (the centre's 1088x480 scene, its
 * pieces from pages.js through engine.js, the shaders run in WebGL 1 like tools/preview.js). Fails if a
 * shader does not compile.
 *   node tools/preview_centre.js --page temps [--look native|modern] [--fit clear|full] [--accent blue] [--style bar|arc|number] [--units metric]
 *                                [--rpm 3400] [--out page.png]
 */
const path = require('path');
const { FakeClient } = require('./scene');          // (also maps ./kit/ to kit/runtime)
const { render } = require('./preview');

const APP = path.join(__dirname, '..', 'apps', 'cluster_centre');

function args(argv) {
    const a = { page: 'temps', fit: 'clear', look: 'native', accent: 'blue', style: 'bar', units: 'us', rpm: 3400, out: 'page.png' };
    for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); a[k] = isNaN(Number(argv[i + 1])) ? argv[++i] : Number(argv[++i]); }
    return a;
}

/** Sample data for every reading and feature, as a drive would have them. */
function sample(a) {
    const { WarmUp, CoolDown } = require(path.join(APP, 'features'));
    const w = new WarmUp({ target: 90, coldLimit: 3500, redline: 6500 });
    const t0 = 1e9;
    [62, 64, 66, 68].forEach((c, i) => w.feed(t0 + i * 30000, { oil: c }));
    const cool = new CoolDown();
    for (let i = 0; i < 300; i++) cool.feed(i * 200, { rpm: i < 150 ? 5200 : 2000 });
    return {
        speed: 97, rpm: a.rpm, gear: 4, stage: 'D', oil: 104, coolant: 92, gearbox: 81, iat: 39, outside: 9, iatRise: 30, hpfp: 182, lpfp: 5.3,
        timing: 14.5, boostTarget: 0.92, boostActual: 0.88, torque: 380, gLat: 0.34, gLong: 0.1, soc: 64, kw: 18.6, battTemp: 27, battMin: 25, battMax: 29,
        pdDrive: 62, pdClimate: 26, pdSeats: 12, erange: 29, frange: 520, splitRear: 61, splitFront: 39, splitFrom: 'car', engineOn: true,
        warm: Object.assign(w.state({ oil: 68 })), cool: cool.state(),
        perf: { mode: 'done', last: { sixty: 4.82, quarter: 13.21, trap: 166 }, best: { sixty: 4.71, quarter: 13.05 } },
        eng: { onMs: 14 * 60000, share: 38, starts: 5, why: null },
    };
}

if (require.main === module) {
    const a = args(process.argv.slice(2));
    const { startCluster } = require(path.join(APP, 'engine'));
    const { pieces, palette } = require(path.join(APP, 'pages'));
    const client = new FakeClient();
    const units = a.units === 'metric' ? { temp: 'c', press: 'bar', speed: 'kmh', torque: 'nm' } : { temp: 'f', press: 'psi', speed: 'mph', torque: 'lbft' };
    const o = { look: a.look, fit: a.fit, pages: [a.page], style: a.style, accent: a.accent, size: 'normal', units, warn: {}, shift: { on: true, from: 4000, at: 6200 }, badge: true,
        custom: [{ style: 'bar', slots: ['oil', 'coolant', 'gearbox', 'iat'] }, { style: 'arc', slots: ['soc', 'kw', 'splitRear', 'boostActual'] }] };
    const d = sample(a);
    const e = startCluster({ client, log: { info() {}, warn: (m) => console.error(m) }, target: 'map', contend: true, layout: () => ({ id: 'centre', pieces }), options: () => o,
        theme: () => palette(a.accent, a.look), font: () => (a.look === 'modern' ? 'bold' : 'light'), data: () => d, live: () => true, enabled: () => true, sweep: () => false, group: a.page });
    // two minutes of driving first, on a made-up clock, so the trend lines have a past
    const now = Date.now, t0 = now(), base = Object.assign({}, d);
    let fake = t0 - 130000;
    Date.now = () => fake;
    for (let i = 0; i < 66 * 2; i++) {
        fake += 1000;
        const f = i / 132, wob = (a, b) => a + b * Math.sin(i / 7) + b * 0.5 * Math.sin(i / 2.3);
        Object.assign(d, { oil: base.oil - 14 * (1 - f) + wob(0, 1.2), coolant: base.coolant - 6 * (1 - f) + wob(0, 0.8), gearbox: base.gearbox - 10 * (1 - f) + wob(0, 1),
            iat: wob(base.iat, 4), iatRise: wob(base.iatRise, 4), outside: base.outside, hpfp: wob(base.hpfp, 40), lpfp: wob(base.lpfp, 0.3), boostActual: Math.max(0, wob(0.6, 0.35)),
            timing: wob(base.timing, 4), rpm: wob(3200, 1300), splitRear: wob(base.splitRear, 14), kw: wob(10, 25), gLat: wob(0, 0.35), soc: base.soc + 4 * (1 - f) });
        e._tick();
    }
    Object.assign(d, base, { rpm: a.rpm });
    for (let i = 0; i < 40; i++) { fake += 40; e._tick(); }
    Date.now = now;
    const ls = Array.from(client.layers.values());
    const assets = {};
    ls.filter((l) => l.kind === 'asset').forEach((l) => { assets[l.ref] = { w: l.opts.w, h: l.opts.h, px: l.pixels.toString('base64') }; });
    const quads = ls.filter((l) => l.kind === 'effect' && l.opts.visible !== false).sort((x, y) => (x.opts.z - y.opts.z) || (x.ref - y.ref))
        .map((l) => ({ ref: l.ref, x: l.opts.x, y: l.opts.y, w: l.opts.w, h: l.opts.h, fs: l.opts.fs, uniforms: l.uniforms, binds: l.binds }));
    e.stop();
    render({ w: 1088, h: 480, quads, assets }, a.out, false).then((errors) => {
        if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
        console.log('wrote ' + path.resolve(a.out) + ' (' + quads.length + ' layers)');
        process.exit(0);
    }).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { sample };
