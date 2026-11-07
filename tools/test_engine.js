'use strict';
/**
 * test_engine.js - the engine with each layout against a recording stand-in for the cluster render client
 * (tools/scene.js): what is sent at the start and while driving, the start-up sweep, the fail-safe, the
 * centre left to the stock cluster, and that every shader's uniforms fit the service's limits.
 *   node tools/test_engine.js
 */
const assert = require('assert');
const path = require('path');
const { makeScene, APP } = require('./scene');
const { LAYOUTS } = require(path.join(APP, 'layouts'));
const font = require(path.join(APP, 'font'));

const RESERVED = ['u_mvp', 'u_mv', 'u_m', 'u_v', 'u_p', 'u_normal'];   // the renderer's matrix names (PROTOCOL.md)
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };
const drive = (s, seconds, fn) => { for (let i = 0; i < seconds * 25; i++) { s.setData(fn(i / 25)); s.engine._tick(); } };
const effects = (s) => Array.from(s.client.layers.values()).filter((l) => l.kind === 'effect');
const textsOf = (s) => s.engine._pieces().filter((p) => p.text !== null).map((p) => p.text);
const hard = (t) => ({ speed: 80 + 80 * Math.sin(t / 4), rpm: 2500 + 2000 * Math.sin(t * 2), stage: 'D', gear: 1 + Math.floor(t / 10) % 8, oil: 100 + t / 6, coolant: 90, mode: t > 30 ? 'S' : null });

LAYOUTS.forEach((L) => {
    const id = L.id;
    check(id + ': only shader layers on the panel; the only pixels are the glyph atlas', () => {
        const s = makeScene({ layout: id, data: { speed: 0, rpm: 800, stage: 'P', oil: 40, coolant: 40 } });
        const ls = Array.from(s.client.layers.values());
        assert(ls.every((l) => l.kind === 'effect' || l.kind === 'asset'));
        assert.strictEqual(ls.filter((l) => l.kind === 'asset').length, 1);
        assert(effects(s).every((l) => l.opts.target === 'panel' && l.opts.x >= 0 && l.opts.y >= 0 && l.opts.x + l.opts.w <= 1920 && l.opts.y + l.opts.h <= 720), 'inside the panel');
        effects(s).forEach((l) => {
            const n = Object.keys(l.uniforms).length, nums = Object.keys(l.uniforms).reduce((a, k) => a + l.uniforms[k].v.length, 0);
            assert(n <= 30 && nums <= 4096, 'uniforms ' + n);
            Object.keys(l.uniforms).forEach((k) => assert(l.uniforms[k].v.length <= 1024, k + ' over 1024 numbers'));
        });
        effects(s).forEach((l) => RESERVED.forEach((n) => assert(!new RegExp('(^|[^A-Za-z0-9_])' + n + '($|[^A-Za-z0-9_])').test(l.opts.fs), 'the shader uses ' + n + ', a RAMSES matrix semantic')));
        console.log('     start: ' + effects(s).length + ' layers, ' + s.client.messages + ' messages, ' + Math.round(s.client.bytes / 1024) + ' KB in all');
        assert(s.client.bytes < 600 * 1024);
        s.stop();
    });
    check(id + ': driving sends a few KB a second, no pixels', () => {
        const s = makeScene({ layout: id, data: {} });
        s.engine._tick();
        s.client.reset();
        drive(s, 60, hard);
        const perSec = s.client.bytes / 60;
        console.log('     driving: ' + Math.round(s.client.messages / 60) + ' messages/s, ' + (perSec / 1024).toFixed(1) + ' KB/s');
        assert(!s.client.log.some((m) => m.op === 'pixels' || m.op === 'layer'));
        assert(perSec < 16 * 1024);
        s.stop();
    });
    check(id + ': parked with nothing changing sends nothing', () => {
        const s = makeScene({ layout: id, data: {} });
        const still = () => ({ speed: 0, rpm: 0, stage: 'P', oil: 50, coolant: 50 });
        drive(s, 2, still);
        s.client.reset();
        drive(s, 10, still);
        assert.strictEqual(s.client.messages, 0, JSON.stringify(s.client.log.slice(0, 3)));
        s.stop();
    });
    check(id + ': the readings reach the cluster (gear, digits, values)', () => {
        const s = makeScene({ layout: id, data: {} });
        drive(s, 2, () => ({ speed: 50 * 1.609344, rpm: 2500, stage: 'D', gear: 3, oil: 100, coolant: 90 }));
        const t = textsOf(s);
        ['D3', '50'].forEach((x) => assert(t.indexOf(x) >= 0, x + ' in ' + JSON.stringify(t)));
        const vals = s.engine._pieces().filter((p) => p.value !== null).map((p) => p.value);
        assert(vals.some((v) => Math.abs(v - 50) < 0.3 || Math.abs(v - 50 / 160) < 0.003), 'speed ' + vals);
        s.stop();
    });
    check(id + ': S on the selector shows S3', () => {
        const s = makeScene({ layout: id, data: {} });
        drive(s, 1, () => ({ speed: 60, rpm: 4000, stage: 'D', gear: 3, mode: 'S' }));
        assert(textsOf(s).indexOf('S3') >= 0);
        s.stop();
    });
    check(id + ': centre left to the stock cluster: nothing over the middle', () => {
        const s = makeScene({ layout: id, options: { centre: 'stock' }, data: { speed: 0 } });
        s.engine._tick();
        assert(!s.engine._pieces().some((l) => l.x < 1100 && l.x + l.w > 820), 'a piece over x 820-1100');
        s.stop();
    });
    check(id + ': map in the centre: nothing over the map window, the readings round it', () => {
        const C = require(path.join(APP, 'layout_common'));
        const s = makeScene({ layout: id, options: { centre: 'map' }, data: { speed: 0 } });
        s.engine._tick();
        const over = s.engine._pieces().filter((l) => C.overMap(l));
        // a band's rectangle may reach into the window as long as what it draws stays out: only bands may overlap
        assert(over.every((l) => l.geo && l.geo[2] > 0), 'over the map: ' + over.map((l) => l.key).join(' '));
        s.stop();
    });
    ['comfort', 'sport', 'efficient'].forEach((look) => check(id + ': ' + look + ' palette has every colour its pieces use', () => {
        const pal = L.palette(look);
        L.pieces({ speedUnit: 'mph', tempUnit: 'f', centre: 'info', redline: 7000, rpmMax: 8000 }).forEach((p) => {
            if (!p.colors) return;
            const c = p.colors(pal, { stage: 'D', gear: 3, oil: 90, coolant: 90 });
            Object.keys(c).forEach((k) => { const v = Array.isArray(c[k]) ? c[k][0] : c[k]; assert(/^#[0-9a-f]{6}$/i.test(v), p.key + '.' + k + ' = ' + v); });
        });
    }));
});

/*
 * Every layout is built around what the glass and the KOMBI keep for themselves: the camera's cowl, the dark box
 * the KOMBI leaves where its gear readout was, its eDrive readout's box, the slanted top corners and the warning
 * lights along the bottom. Every piece that draws something (not the backgrounds) stays clear of them; a dial
 * counts as its circle.
 */
const { clashes } = require('./clearance');
LAYOUTS.forEach((L) => ['info', 'map', 'stock'].forEach((centre) => ['phev', 'ice'].forEach((vehicle) => check(L.id + ' (' + centre + ', ' + vehicle + '): at most 60 pieces, all clear of the cowl, the KOMBI\'s boxes, the corners and the warning lights', () => {
    const ps = L.pieces({ speedUnit: 'mph', tempUnit: 'f', centre, redline: 7000, rpmMax: 8000, vehicle });
    assert(ps.length <= 60, ps.length + ' pieces: the renderer draws 64 layers an app');
    const bad = ps.map((p) => [p.key, clashes(p)]).filter(([, c]) => c.length).map(([k, c]) => k + ' ' + c.join(', '));
    assert(!bad.length, bad.join('; '));
}))));

/* 60 frames a second, a reading drawn within 5 ms: an update (every needle, bar and text of the layout) takes
 * well under 5 ms here; the unit's CPU is slower, so the budget asserted is 1.5 ms (worst 4 ms) on this machine */
LAYOUTS.forEach((L) => check(L.id + ': an update takes well under 5 ms (60 a second, drawn at once on a reading)', () => {
    const s = makeScene({ layout: L.id, data: {} });
    for (let i = 0; i < 30; i++) { s.setData(hard(i / 60)); s.engine._tick(); }   // warmed up
    const times = [];
    for (let i = 0; i < 600; i++) {
        s.setData(hard(i / 60));
        const t0 = process.hrtime.bigint();
        s.engine._full();     // the worst case: every needle, every text and colour at once
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length, p99 = times[Math.floor(times.length * 0.99)];
    console.log('     update: avg ' + avg.toFixed(3) + ' ms, 99% ' + p99.toFixed(3) + ' ms, worst ' + times[times.length - 1].toFixed(3) + ' ms');
    assert(avg < 1.5 && p99 < 4, 'avg ' + avg.toFixed(2) + ' ms, 99% ' + p99.toFixed(2) + ' ms');
    s.stop();
}));

check('start-up sweep: played by the cluster (one animation per needle and band), stopped after', () => {
    const s = makeScene({ layout: 'analog_sport', data: { speed: 0, rpm: 0 }, sweep: true });
    s.engine._tick();
    const anims = s.client.log.filter((m) => m.op === 'animate');
    assert(anims.length >= 4 && anims.every((a) => a.property === 'uniform' && a.name === 'u_value'));
    s.stop();
    assert(s.client.log.filter((m) => m.op === 'stop').length >= 4);
});

check('fail-safe: hidden while the car data is not live, shown again when it is; off when disabled', () => {
    let live = true, on = true;
    const s = makeScene({ data: { speed: 10 }, live: () => live, enabled: () => on });
    const visible = () => effects(s).length > 0 && effects(s).every((l) => l.opts.visible === true);
    const hidden = () => effects(s).length === 0;
    s.engine._tick(); assert(visible());
    live = false; s.engine._tick(); assert(visible(), 'a moment\'s gap in the data keeps it (nothing dropped and resent)');
    const now = Date.now; Date.now = () => now() + 2000; s.engine._tick(); Date.now = now;
    assert(hidden(), 'stale data for longer hides it');
    live = true; s.engine._tick(); assert(visible());
    on = false; s.engine._tick(); assert(hidden(), 'off hides it');
    s.stop();
});

console.log(ok + ' passed');
process.exit(0);
