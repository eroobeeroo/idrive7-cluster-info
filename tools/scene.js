'use strict';
/**
 * scene.js - for the tools and tests: runs the app's engine.js against a stand-in for the cluster render
 * client that records what would be sent (layers, uniforms, binds, asset pixels, bytes), so the scene can
 * be checked and drawn (preview.js) without a car.
 */
const path = require('path');
const EventEmitter = require('events');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'cluster_layouts');
/** The kit's runtime (canvas, fonts): KIT_DIR, else this repo's kit/runtime. */
const KIT = process.env.KIT_DIR || path.join(ROOT, 'kit', 'runtime');
const load = Module._load;
Module._load = function (req, parent, isMain) {
    if (req.startsWith('./kit/')) return load.call(this, path.join(KIT, req.slice(6)), parent, isMain);
    return load.call(this, req, parent, isMain);
};

class FakeClient extends EventEmitter {
    constructor() { super(); this.layers = new Map(); this.next = 1; this.bytes = 0; this.messages = 0; this.log = []; }
    _count(obj, extra) { this.messages++; this.bytes += JSON.stringify(obj).length + 5 + (extra || 0); this.log.push(obj); }
    connect() { this.connected = true; }
    close() { this.connected = false; }
    _add(kind, o) { const ref = this.next++; this.layers.set(ref, { ref, kind, opts: Object.assign({}, o), uniforms: {}, binds: {} }); this._count(Object.assign({ op: kind === 'asset' ? 'asset' : 'layer', kind }, o)); return ref; }
    effect(o) { return this._add('effect', o); }
    image(o) { return this._add('image', o); }
    asset(o) { return this._add('asset', o); }
    pixels(ref, rects, px) { const l = this.layers.get(ref); l.pixels = Buffer.from(px); this._count({ op: 'pixels', ref }, px.length); }
    uniform(ref, name, v, o) { const l = this.layers.get(ref); l.uniforms[name] = { v: v.slice(), type: o && o.type }; this._count({ op: 'uniform', ref, name, v: v.join(' ') }); }
    bind(ref, sampler, asset) { this.layers.get(ref).binds[sampler] = asset; this._count({ op: 'bind', ref, sampler, asset }); }
    set(ref, o) { Object.assign(this.layers.get(ref).opts, o); this._count(Object.assign({ op: 'set', ref }, o)); }
    drop(ref) { this.layers.delete(ref); this._count({ op: 'drop', ref }); }
    animate(ref, o) { const l = this.layers.get(ref); l.anims = l.anims || {}; const n = (l.nextAnim = (l.nextAnim || 0) + 1); l.anims[n] = o; this._count(Object.assign({ op: 'animate', ref, anim: n }, o)); return n; }
    stop(ref, anim) { const l = this.layers.get(ref); if (l && l.anims) delete l.anims[anim]; this._count({ op: 'stop', ref, anim }); }
    reset() { this.bytes = 0; this.messages = 0; this.log = []; }
}

const nullLog = { info() {}, warn() {}, error() {} };

/**
 * A scene for settings and fixed car data: { client, engine, scene() }.
 * opts: { layout, look ('comfort' | 'sport' | 'efficient'), options, data, live, enabled, sweep }
 */
function makeScene(opts) {
    const { startCluster } = require(path.join(APP, 'engine'));
    const { byId } = require(path.join(APP, 'layouts'));
    const client = new FakeClient();
    let data = opts.data || {};
    const o = Object.assign({ speedUnit: 'mph', tempUnit: 'f', centre: 'info', redline: 7000, rpmMax: 8000 }, opts.options);
    const engine = startCluster({
        client, log: opts.log || nullLog,
        layout: () => byId(opts.layout || 'analog_sport'),
        options: () => o,
        theme: () => Object.assign({}, byId(opts.layout || 'analog_sport').palette(opts.look || 'comfort'),
            opts.black ? { bg: '#000000', bgTop: '#000000', bgBottom: '#000000', face0: '#000000', face1: '#000000' } : {}),
        sweep: () => (opts.sweep === undefined ? false : opts.sweep),
        data: () => data,
        live: () => (opts.live === undefined ? true : opts.live()),
        enabled: () => (opts.enabled === undefined ? true : opts.enabled()),
    });
    engine._tick();   // layers exist only once shown
    return {
        client, engine,
        setData(d) { data = d; },
        data: () => data,
        /** The visible layers in drawing order, with what a renderer needs to draw them. */
        scene() {
            const ls = Array.from(client.layers.values());
            const assets = {};
            ls.filter((l) => l.kind === 'asset').forEach((l) => { assets[l.ref] = { w: l.opts.w, h: l.opts.h, px: l.pixels ? l.pixels.toString('base64') : '' }; });
            const order = { ambient: 0, content: 1, overlay: 2, alert: 3 };
            const quads = ls.filter((l) => l.kind === 'effect' && l.opts.visible !== false)
                .sort((a, b) => (order[a.opts.klass] - order[b.opts.klass]) || ((a.opts.z || 0) - (b.opts.z || 0)) || (a.ref - b.ref))
                .map((l) => ({ ref: l.ref, x: l.opts.x, y: l.opts.y, w: l.opts.w, h: l.opts.h, fs: l.opts.fs, uniforms: l.uniforms, binds: l.binds }));
            return { w: 1920, h: 720, quads, assets };
        },
        stop() { engine.stop(); },
    };
}

module.exports = { makeScene, FakeClient, APP, KIT };
