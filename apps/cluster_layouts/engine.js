'use strict';
/**
 * engine.js - puts a layout on the whole instrument cluster panel through the cluster render service, for the
 * cluster to draw itself.
 *
 * Each piece of the layout is an effect layer (a GLSL shader over a rectangle, shaders.js) in the `panel`
 * target (slot 0x203: the whole 1920x720 cluster, over the stock gauges and under the warning lights). The
 * KOMBI's renderer draws the scene on the cluster's GPU; the head unit sends:
 *   - once: the glyph atlas (font.js, ~96 KB) and each layer's shader and settings;
 *   - while driving: a needle's or band's value (one number, up to RATE_HZ times a second, only when it
 *     moved), a text's glyph codes when what it shows changes, and colours when they change (the gear's
 *     colour in reverse, the drive mode's colours).
 * No picture of the cluster is ever sent. When the layout comes up, the needles and bands sweep to full and
 * back: an animation the cluster plays on its own clock.
 *
 * Fail-safe: shown only while enabled() and live() (the car's data answers, or demo data); otherwise every
 * layer is hidden, the service releases the panel and the stock gauges are back.
 *
 * A piece (layout_*.js pieces(o)):
 *   { key, kind: 'flat' | 'panel' | 'dial' | 'band' | 'text' | 'bg' | 'icon' | 'spark' | 'car' | 'leds', x, y, w, h, z,
 *     params: { u_name: [numbers] }       fixed uniforms (sent once),
 *     colors(t, d) -> { name: '#rrggbb' | ['#rrggbb', a] }   sent as u_<name> (vec3, or vec4 with a) when they change,
 *     value(d) -> number, max             dial: the reading on its scale (max: the scale's end); band: 0..1,
 *     sweep: true                         part of the start-up sweep,
 *     group: 'name'                       built only while that group is active (setGroup: a page),
 *     dyn(d, t) -> { u_name: [numbers] }  more uniforms, sent when they change (at the text rate),
 *     sample(d) -> 0..1, every            a trend line's samples (kind spark), every `every` ms (2 s),
 *     time: true                          u_time from the renderer's clock (car and leds always),
 *     text: 'fixed' | (d, t) -> string, align (0 left .. 1 right), tracking (glyph heights)   texts }
 *
 * One small shader per piece, each over only its own rectangle: the shaders the KOMBI is known to run. (One
 * big generated shader drawing many pieces over a large area made the cluster restart: never again.)
 */
const font = require('./font');
const SH = require('./shaders');
const { rgb } = require('./themes');

const DEFAULT_TARGET = 'panel';
const RATE_HZ = 60;          // value updates a second (a frame of the cluster's 60 Hz), and at once on a new reading
const TEXT_HZ = 30;          // text and colour updates a second at most (digits that keep up with the needles)
const STALE_MS = 3000;
const TAU_MS = 30;           // a needle's easing towards its reading: smooth between the car's samples, ~30 ms behind
const MIN_GAP_MS = 4;        // a reading's update at most this soon after the last
const EPS = 0.0015;          // a value moving less than this (of its max) is not sent
const SWEEP_MS = 700;        // up, then as long back down
const FS = { flat: SH.FLAT_FS, panel: SH.PANEL_FS, dial: SH.DIAL_FS, band: SH.BAND_FS, text: SH.TEXT_FS, bg: SH.BG_FS, icon: SH.ICON_FS, spark: SH.SPARK_FS, car: SH.CAR_FS, leds: SH.LEDS_FS, flag: SH.FLAG_FS, eagles: SH.EAGLE_FS, fireworks: SH.FIREWORKS_FS };
const Z = { flag: -210, bg: -200, fireworks: -190, eagles: -180, flat: -100, panel: -50, spark: -20, band: 0, dial: 0, car: 0, leds: 0, text: 20, icon: 20 };
/* kinds that animate on the renderer's own clock (u_time): nothing is sent to move them */
const TIMED = { car: true, leds: true, flag: true, eagles: true, fireworks: true };
const HIST = 64;
/* the most layers up at once while one set replaces another (the service allows 64 an app) */
const MAX_AT_ONCE = 60;
/* car data gone for this long before the layout hides (a moment's gap would drop and resend every layer) */
const LIVE_GRACE_MS = 1500;                 // a trend line's samples

/**
 * startCluster(opts) -> { rebuild(), recolour(), stop(), status() }
 *   opts.client   a ClusterRender (cluster_render_client.js), not yet connected
 *   opts.layout() the layout module now; opts.options() its options now
 *   opts.theme()  the colours now (the layout's palette for the look now)
 *   opts.data()   the car's data now ({ speed km/h, rpm, gear, stage, mode, oil, coolant, demo, ... })
 *   opts.live(), opts.enabled(), opts.sweep() (optional: the start-up sweep wanted), opts.log
 *   opts.font() the glyph family ('bold' default, 'light'; font.js), opts.target ('panel' default, 'map', 'hud'), opts.contend (take the slot over from the stock HMI), opts.z
 *   (added to every layer's z: above another client's layers on the same target)
 */
function startCluster(opts) {
    const { client: cr, log } = opts;
    // the target: the whole panel by default; 'map' is the centre (slot 0x100, 1088x480), taken over from the
    // stock map in Map view while a layer wants it (contend)
    const TARGET = opts.target || 'panel', contend = !!opts.contend, zShift = opts.z || 0;
    let specs = [], pieces = [], fontRef = 0, fontFam = null, shown = false, built = false, sweepEnd = 0, group = opts.group || null;
    /* only the active group's pieces (a page) are built; pieces without a group always */
    const inGroup = (p) => !p.spec.group || p.spec.group === group;
    const hist = new Map();          // trend lines' samples by piece key, kept across pages and rebuilds
    const state = { renderer: 'connecting', target: '--', refused: '' };
    const warned = new Set();
    const warnOnce = (m) => { if (!warned.has(m)) { warned.add(m); log.warn('cluster: ' + m); } };

    cr.on('ready', () => { state.renderer = 'connected (' + (cr.backend || '?') + ')'; });
    cr.on('disconnected', () => { state.renderer = 'reconnecting'; });
    cr.on('target', (name, st, holder, reason) => {
        if (name !== TARGET) return;
        state.target = st + (holder ? ' (' + holder + ')' : '') + (reason ? ': ' + reason : '');
        if (/scene id in use/.test(reason || '') && TARGET !== 'map') state.target += ' - an app on the HUD (Waze?) holds it';
        log.info(TARGET + ' ' + state.target);
    });
    // a refused layer's later uniforms come back as "no such layer": the layer's own reason is the one to show
    const refusedRefs = new Set();
    const why = (reason) => (/too many layers/.test(reason) ? 'too many layers: ' + refusedRefs.size + ' of ' + pieces.length + ' pieces not drawn (needs Cluster renderer 0.3.104)' : reason);
    cr.on('layer', (ref, st, reason) => { if (st === 'error') { refusedRefs.add(ref); state.refused = why(reason); warnOnce('layer refused: ' + reason); } });
    cr.on('refused', (op, ref, reason) => {
        if (/no such layer/.test(reason || '')) return;
        if (op === 'layer' || op === 'effect') refusedRefs.add(ref);
        state.refused = why(op + ': ' + reason); warnOnce(op + ' refused: ' + reason);
    });
    // the renderer's status text (its targets and every slot the KOMBI reports, cluster-render 0.3.107+), asked
    // for every few seconds while shown, for the app's page
    let statusText = '', statusAt = 0;
    cr.on('status', (text) => { statusText = String(text || ''); });
    cr.on('error', (e) => { state.renderer = 'not reachable'; warnOnce(String((e && e.message) || e)); });

    /* The free/open-source credit is shown on each app's own screen (the head unit menu), not drawn on the
     * cluster glass, so no mark is woven into the layouts or the centre pages here. Any stray _credit a layout
     * might carry is dropped so nothing lands on the cluster. */
    const withCredit = (list) => (list || []).filter((x) => x.key !== '_credit');

    const fam = () => (opts.font ? opts.font() : 'bold');
    const fontCells = () => { const a = font.atlas(fam()); return [a.cols, a.aspect, a.rows]; };
    const colourValue = (c) => (Array.isArray(c) ? rgb(c[0]).concat([c[1]]) : rgb(c));

    /*
     * The layers for the active group. The service gives an app 64 layers, so the new set never goes up beside
     * the whole old one: on a page change the pieces every page shares (no group: the background, the shift
     * light) are kept as they are, and when old and new would pass MAX_AT_ONCE the old ones go first but one,
     * which holds the target (an empty target goes back to the stock HMI) until the new ones are up.
     * keep: reuse the old ungrouped pieces (a page change: they are the same).
     */
    function build(keep) {
        const L = opts.layout(), o = opts.options();
        const a = font.atlas(fam());
        if (fontRef && fontFam !== a.fam) { pieces.forEach((p) => cr.drop(p.ref)); pieces = []; cr.drop(fontRef); fontRef = 0; }
        if (!fontRef) {
            fontFam = a.fam;
            fontRef = cr.asset({ target: TARGET, format: 'r8', w: a.w, h: a.h, sampling: 'bilinear' });
            cr.pixels(fontRef, null, a.px);
        }
        const kept = keep ? pieces.filter((p) => !p.spec.group) : [];
        let old = pieces.filter((p) => kept.indexOf(p) < 0);
        pieces = kept.slice();
        refusedRefs.clear(); state.refused = '';
        if (!keep) specs = withCredit(L.pieces(o));
        const want = specs.filter((s) => (!s.group || s.group === group) && !(keep && !s.group));
        if (old.length + kept.length + want.length > MAX_AT_ONCE) {
            const anchor = kept.length ? null : old[0];
            old.forEach((p) => { if (p !== anchor) cr.drop(p.ref); });
            old = anchor ? [anchor] : [];
        }
        want.forEach((s) => {
            // shown at once when the old page is up: the new page goes up before the old one goes, so the target
            // is never left empty (which would hand it back to the stock HMI)
            const ref = cr.effect({ target: TARGET, klass: 'content', z: zShift + (s.z !== undefined ? s.z : Z[s.kind]), x: s.x, y: s.y, w: s.w, h: s.h, fs: FS[s.kind], visible: shown, contend, time: !!(s.time || TIMED[s.kind]) });
            if (!ref) { warnOnce('piece ' + s.key + ' refused here'); return; }
            const p = { ref, spec: s, colours: '', text: null, value: 0, sent: -1, anim: 0, dyn: '', histSent: -1 };
            if (s.kind !== 'flat') cr.uniform(ref, 'u_size', [s.w, s.h]);
            if (s.kind === 'dial' || s.kind === 'band' || s.kind === 'text') {
                cr.bind(ref, 'u_font', fontRef);
                cr.uniform(ref, 'u_font_cells', fontCells());
                cr.uniform(ref, 'u_digit_adv', [Math.round(font.digitAdvance(fam()) * 1000) / 1000]);
            }
            Object.keys(s.params || {}).forEach((u) => cr.uniform(ref, u, s.params[u]));
            if (s.value) cr.uniform(ref, 'u_value', [0]);
            pieces.push(p);
        });
        old.forEach((p) => cr.drop(p.ref));
        built = true;
        // drawing order: what was kept stays where its z puts it, among the new ones
        update(true);
        values();
        log.info('layout ' + L.id + (group ? ' page ' + group : '') + ': ' + pieces.length + ' layers on the ' + TARGET + ', glyph atlas ' + a.w + 'x' + a.h + ' (' + Math.round(a.px.length / 1024) + ' KB, once)');
    }

    /** Colours and texts: sent only when they changed (force: all). */
    function update(force) {
        const t = opts.theme(), d = opts.data();
        pieces.forEach((p) => {
            const s = p.spec;
            if (!inGroup(p)) return;
            if (s.colors) {
                const c = s.colors(t, d) || {}, key = JSON.stringify(c);
                if (force || key !== p.colours) { p.colours = key; Object.keys(c).forEach((n) => cr.uniform(p.ref, 'u_' + n, colourValue(c[n]))); }
            }
            if (s.dyn) {
                const u = s.dyn(d, t) || {}, key = JSON.stringify(u);
                if (force || key !== p.dyn) { p.dyn = key; Object.keys(u).forEach((n) => cr.uniform(p.ref, n, u[n])); }
            }
            if (s.sample) {
                // a trend line (sampled by samples(), for every page): sent when it has a new sample
                const H = hist.get(s.key) || { list: [], at: 0 };
                if (force || p.histSent !== H.at) {
                    p.histSent = H.at;
                    const h = H.list.map((x) => Math.round(x * 1000) / 1000);
                    while (h.length < HIST) h.push(-1);
                    cr.uniform(p.ref, 'u_hist', h, { type: 'vec4' });
                    cr.uniform(p.ref, 'u_count', [H.list.length]);
                }
            }
            if (s.kind === 'text') {
                const txt = typeof s.text === 'function' ? String(s.text(d, t)) : String(s.text);
                if (force || txt !== p.text) {
                    p.text = txt;
                    const ln = font.line(txt, s.w / s.h, s.align, s.tracking, fam());
                    cr.uniform(p.ref, 'u_text', ln.codes, { type: 'vec4' });
                    cr.uniform(p.ref, 'u_x', ln.centres, { type: 'vec4' });
                }
            }
        });
    }

    /** Trend lines: a sample every s.every ms (2 s) on every page, so a page shows its recent past. */
    function samples() {
        const now = Date.now();
        let d = null;
        specs.forEach((s) => {
            if (!s.sample) return;
            let H = hist.get(s.key);
            if (!H) { H = { list: [], at: 0 }; hist.set(s.key, H); }
            if (now - H.at < (s.every || 2000)) return;
            d = d || opts.data();
            H.at = now;
            const v = s.sample(d);
            H.list.push(typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : -1);
            while (H.list.length > HIST) H.list.shift();
        });
    }

    /** Values (needles, bands): each eased towards its reading, sent when it moved enough. */
    let valuesAt = 0;
    function values() {
        const d = opts.data(), now = Date.now();
        // eased by time, not by update: the same ~30 ms whether a reading or the frame timer brought it
        // (at least a frame's worth an update, so updates in quick succession still settle)
        const k = valuesAt ? 1 - Math.exp(-Math.max(1000 / RATE_HZ, now - valuesAt) / TAU_MS) : 1;
        valuesAt = now;
        pieces.forEach((p) => {
            const s = p.spec;
            if (!s.value || !inGroup(p)) return;
            const max = s.max || 1, want = Math.max(0, Math.min(max * 1.02, Number(s.value(d)) || 0));
            p.value += (want - p.value) * k;
            if (Math.abs(want - p.value) < max * EPS / 4) p.value = want;
            if (Math.abs(p.value - p.sent) >= max * EPS) { p.sent = p.value; cr.uniform(p.ref, 'u_value', [Math.round(p.value * 10000) / 10000]); }
        });
    }

    /** The start-up sweep: each needle and band to full and back, played by the cluster. */
    function sweep() {
        const now = Date.now();
        pieces.forEach((p) => {
            if (!p.spec.sweep || !p.spec.value || !inGroup(p)) return;
            const max = p.spec.max || 1;
            p.anim = cr.animate(p.ref, { property: 'uniform', name: 'u_value', keys: '0:0 ' + SWEEP_MS + ':' + max + ' ' + (2 * SWEEP_MS) + ':0', loop: false });
        });
        sweepEnd = now + 2 * SWEEP_MS + 150;
    }
    function endSweep() {
        pieces.forEach((p) => { if (p.anim) { cr.stop(p.ref, p.anim); p.anim = 0; } });
        sweepEnd = 0;
    }

    /* Layers exist only while shown: hidden ones still count against the render service's limits (64 an app,
     * 96 for all apps), so another app (Cluster Centre beside Cluster Layouts) would be refused. */
    function setShown(on) {
        if (on === shown) return;
        if (on) {
            build();
            shown = true;
            pieces.forEach((p) => cr.set(p.ref, { visible: true }));
            if (!opts.sweep || opts.sweep()) sweep();
        } else {
            endSweep();
            shown = false;
            pieces.forEach((p) => cr.drop(p.ref));
            pieces = []; built = false;
        }
        log.info(on ? 'layout shown on the cluster' : 'layout hidden: the stock cluster is back');
    }

    let lastText = 0;
    let notLiveAt = 0;
    function tick() {
        // off: at once; the car's data stale: after LIVE_GRACE_MS, so a gap does not drop and resend everything
        const on = !!opts.enabled(), live = !!opts.live(), now0 = Date.now();
        if (live) notLiveAt = 0; else if (!notLiveAt) notLiveAt = now0;
        const want = on && (live || (shown && now0 - notLiveAt < LIVE_GRACE_MS)), was = shown;
        setShown(want);
        if (want && !was) return;   // just built, with everything sent
        if (Date.now() - statusAt > 3000) { statusAt = Date.now(); try { cr.status(); } catch (e) { /* not connected yet */ } }
        if (!want) { const now = Date.now(); if (now - lastText >= 1000 / TEXT_HZ) { lastText = now; samples(); } return; }
        if (sweepEnd && Date.now() >= sweepEnd) endSweep();
        values();
        const now = Date.now();
        if (now - lastText >= 1000 / TEXT_HZ) { lastText = now; samples(); update(false); }
    }

    /** The pieces made again (the options changed); the glyph atlas stays. */
    function rebuild() { specs = withCredit(opts.layout().pieces(opts.options())); if (built) { endSweep(); build(); } }
    /** Another group (page): its pieces built, the new page up before the old one goes. */
    function setGroup(g) {
        if (g === group) return;
        group = g;
        if (built) { endSweep(); build(true); }
    }

    cr.connect();
    specs = withCredit(opts.layout().pieces(opts.options()));   // for the trend lines' samples; layers once shown
    /* a new reading: drawn at once (within MIN_GAP_MS of the last update), not at the next frame; the time one
     * update takes is kept (perf) */
    let tickAt = 0, nudged = false;
    const perf = { n: 0, totalMs: 0, maxMs: 0 };
    const timed = () => {
        // (process.hrtime() as [s, ns]: the unit runs Node 8, which has no hrtime.bigint)
        const t0 = process.hrtime();
        tickAt = Date.now();
        tick();
        const dt = process.hrtime(t0), ms = dt[0] * 1e3 + dt[1] / 1e6;
        perf.n++; perf.totalMs += ms; if (ms > perf.maxMs) perf.maxMs = ms;
    };
    const nudge = () => {
        if (nudged || !shown) return;
        nudged = true;
        setImmediate(() => { nudged = false; if (Date.now() - tickAt >= MIN_GAP_MS) timed(); });
    };
    if (opts.onFresh) opts.onFresh(nudge);
    const timer = setInterval(timed, 1000 / RATE_HZ);
    const api = {
        rebuild, setGroup,
        group: () => group,
        recolour: () => update(true),
        stop() { clearInterval(timer); setShown(false); cr.close(); },
        status: () => ({ shown, renderer: state.renderer, target: state.target, layers: pieces.length, pieces: pieces.length, refused: state.refused }),
        /** The renderer's own status text (empty until it answers). */
        rendererStatus: () => statusText,
        _tick: tick,
        /** For the tests: one complete update (values, trend samples, texts and colours), whatever is due. */
        _full: () => { values(); samples(); update(false); },
        /** How long an update takes in this app (ms): { n, avgMs, maxMs }. */
        perf: () => ({ n: perf.n, avgMs: perf.n ? Math.round(perf.totalMs / perf.n * 1000) / 1000 : 0, maxMs: Math.round(perf.maxMs * 1000) / 1000 }),
        /** For the tests: the built pieces and what each shows now. */
        _pieces: () => pieces.map((p) => ({ key: p.spec.key, kind: p.spec.kind, x: p.spec.x, y: p.spec.y, w: p.spec.w, h: p.spec.h, geo: (p.spec.params || {}).u_geo,
            text: p.spec.kind === 'text' ? (typeof p.spec.text === 'function' ? p.text : String(p.spec.text)) : null, value: p.spec.value ? p.value : null, layer: p.ref,
            group: p.spec.group || null, params: p.spec.params || {} })),
        /** For the tests: the groups (pages) the layout has now. */
        _groups: () => Array.from(new Set(specs.map((s) => s.group).filter(Boolean))),
    };
    startCluster.last = api;
    return api;
}

module.exports = { startCluster, TARGET: DEFAULT_TARGET, STALE_MS, SWEEP_MS };
