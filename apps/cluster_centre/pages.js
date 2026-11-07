'use strict';
/**
 * pages.js - Cluster Centre's pages: what goes in the centre of the factory cluster (the map area, 1088x480,
 * between the stock dials), as pieces the cluster draws (engine.js, shaders.js). Every page is built once, as
 * a group; switching pages only shows one group and hides the last. Pieces without a group (the background,
 * the shift light with the gear and the cool-down countdown) show on every page.
 *
 * The look: a dark background with a soft glow of the accent colour and a fine dot grid, glass cards, an icon
 * by every reading, a trend line of its last two minutes, glowing bars and arcs with a mark where a reading
 * turns too hot, a round-light shift light and an animated xDrive car. Everything sits in the middle (BOX):
 * the stock dials' edges and their own figures overlap the map area's sides.
 * o: { look ('native' | 'modern'), pages, style, accent, size ('normal' | 'large'), units, warn,
 *      shift: { on, from, at }, badge, custom, warmTarget, redline }.
 */
const { view, READINGS } = require('./readings');

const W = 1088, H = 480;
const BOX = { x: 176, y: 30, w: 736, h: 420 };
const BODY = { x: BOX.x, y: 104, w: BOX.w, h: BOX.y + BOX.h - 104 };
const isNum = (v) => typeof v === 'number' && isFinite(v);

const ACCENTS = { blue: '#3fa6ff', white: '#dfe8f2', orange: '#ff8a2a', red: '#ff3b30', green: '#2fd27a' };
/*
 * Two looks. 'native' blends into the stock iDrive 7 cluster: readings float on a dark blue-black that fades
 * into the cluster at its sides, no boxes but hairline dividers, thin numerals, thin bars and arcs, outlined
 * icons, little glow, cool white and blue with orange for warnings. 'modern': glass cards, bold numerals,
 * glowing bars and arcs, filled icons.
 */
const STYLES = {
    native: { card: false, sep: true, glow: 0.25, barT: 0.3, arcK: 0.5, soft: 1, iconLine: 1.6, ledK: 0.75, ledShape: 1, bg: [0.35, 0, 0.15, 22], feather: 0, title: 'dim' },
    modern: { card: true, sep: false, glow: 1, barT: 0.42, arcK: 1, soft: 0, iconLine: 0, ledK: 1, ledShape: 0, bg: [1, 1, 1, 22], feather: 0, title: 'accent' },
};
let ST = STYLES.native;          // the look being built (pieces() sets it)
function palette(accent, look) {
    const a = ACCENTS[accent] || ACCENTS.blue;
    if (look !== 'modern') {
        return {
            bgTop: '#070b11', bgBottom: '#020306', cardTop: '#0d131a', cardBottom: '#070a0e', edge: '#1c2631',
            text: '#ffffff', dim: '#bac4ce', faint: '#2a3542', accent: a, accentDim: '#2a3a4c', warn: '#ff8a1e', cold: '#5aa8f0',
            track: '#1c2531', ev: '#4aa8f5', regen: '#3ccf8e', green: '#3ccf8e', yellow: '#ffb020', body: '#121a23', wheel: '#090d12', hair: '#1f2a36',
        };
    }
    return {
        bgTop: '#0a0e14', bgBottom: '#020305', cardTop: mix('#121922', a, 0.05), cardBottom: '#070a0e', edge: mix('#1e2833', a, 0.25),
        text: '#ffffff', dim: '#b6bec6', faint: '#3a4654', accent: a, accentDim: mix('#000000', a, 0.35), warn: '#ff3b30', cold: '#4aa3ff',
        track: '#1a222c', ev: '#3fb6ff', regen: '#2fd27a', green: '#2fd27a', yellow: '#ffc533', body: '#18212b', wheel: '#0b0f14', hair: '#1e2833',
    };
}
const levelColour = (t, level) => (level === 'warn' ? t.warn : level === 'cold' ? t.cold : level === 'none' ? t.dim : t.text);
const levelAccent = (t, level) => (level === 'warn' ? t.warn : level === 'cold' ? t.cold : t.accent);

/* ---------- piece makers ---------- */
const text = (key, group, x, y, w, h, txt, colors, extra) => Object.assign({ key, group, kind: 'text', x, y, w, h, text: txt, colors, align: 0.5 }, extra || {});
const card = (key, group, x, y, w, h, r) => (ST.card ? { key, group, kind: 'panel', x, y, w, h, params: { u_box: [r || 18, 1.5, 1, 0.94] }, colors: (t) => ({ top: t.cardTop, bottom: t.cardBottom, border: t.edge }) } : null);
const hair = (key, group, x, y, w, h) => ({ key, group, kind: 'flat', x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), colors: (t) => ({ color: [t.hair, 1] }) });
const icon = (key, group, x, y, size, id, colour) => ({ key, group, kind: 'icon', x, y, w: size, h: size, params: { u_icon: [typeof id === 'function' ? 0 : id], u_line: [ST.iconLine * (size >= 40 ? 2 : 1)] },
    dyn: typeof id === 'function' ? (d) => ({ u_icon: [id(d)] }) : undefined, colors: (t, d) => ({ color: [typeof colour === 'function' ? colour(t, d) : t[colour], 1] }) });
const bar = (key, group, x, y, w, h, value, colors, opts) => ({
    key, group, kind: 'band', x, y, w, h, value, max: 1, sweep: true,
    params: { u_geo: [Math.max(6, h * 0.5), h / 2, 0, Math.max(3, h * ST.barT)], u_span: [opts && opts.fromRight ? -1 : 0, 0, (opts && opts.segments) || 0, 0.22], u_marks: [0, 0, 0, 0], u_soft: [ST.soft] },
    dyn: opts && opts.mark ? (d) => ({ u_red: [opts.mark(d)] }) : () => ({ u_red: [2] }),
    colors,
});
const arc = (key, group, x, y, w, h, cx, cy, R, T, a0, a1, value, colors, opts) => ({
    key, group, kind: 'band', x, y, w, h, value, max: 1, sweep: true,
    params: { u_geo: [cx, cy, R, Math.max(4, T * ST.arcK)], u_span: [a0, a1, ST.card ? (opts && opts.segments) || 0 : 0, 0.3], u_marks: [0, 0, 0, 0], u_soft: [ST.soft] },
    dyn: opts && opts.mark ? (d) => ({ u_red: [opts.mark(d)] }) : () => ({ u_red: [2] }),
    colors,
});
const spark = (key, group, x, y, w, h, sample, colour) => ({ key, group, kind: 'spark', x, y, w, h, sample, every: 2000,
    colors: (t, d) => { const c = typeof colour === 'function' ? colour(t, d) : t[colour]; return { line: ST.card ? c : mix('#000000', c, 0.8), fill: mix('#000000', c, ST.card ? 0.55 : 0.3) }; } });
const plain = (c) => (t) => ({ color: [typeof c === 'function' ? c(t) : t[c], 1], glow: [t.accent, 0] });
const glowing = (c, g) => (t) => ({ color: [t[c], 1], glow: [t[c] === t.text ? t.accent : t[c], g * ST.glow] });
const barColours = (fill) => (t, d) => { const f = typeof fill === 'function' ? fill(t, d) : t[fill]; return { track: t.track, fill0: mix('#000000', f, 0.72), fill1: f, redc: t.warn, tip: mix(f, '#ffffff', 0.35), tick: t.dim, num: t.text }; };
const label = (key, group, x, y, w, txt, extra) => { const e = Object.assign({ align: 0, tracking: 0.18 }, extra || {}), h = e.h || 14; delete e.h; return text(key, group, x, y, w, h, txt, plain('dim'), e); };

/**
 * A tile showing one reading: its glass card, icon and name, the unit, the value, then (style 'bar') the last
 * two minutes as a trend line and a glowing bar with the warning mark; (style 'number') a larger trend line;
 * (style 'arc') an arc gauge round the value.
 */
function tile(group, key, x, y, w, h, reading, style, o, sub) {
    const id = group + '.' + key, k = o.size === 'large' ? 1.2 : 1, r = READINGS[reading] || {};
    const v = (d) => view(reading, d, o.units, o.warn);
    const accentOf = (t, d) => levelAccent(t, v(d).level);
    // sized to be read at a glance while driving: the page is shrunk to fit between the stock readouts (0.76)
    const out = [card(id + '.card', group, x, y, w, h),
        icon(id + '.icon', group, x + 12, y + 11, 26, r.icon || 0, accentOf),
        label(id + '.lbl', group, x + 46, y + 14, w * 0.62, r.short || reading, { h: 20, tracking: 0.1 })];
    if (style === 'arc') {
        // the arc's ends dip below its centre (by R cos 62°): R and the centre keep all of it in the card
        const ah = h - 34, R = Math.min(w / 2 - 26, (ah - 26) / 1.47), cy = 14 + R, T = Math.max(10, R * 0.15);
        out.push(arc(id + '.arc', group, x, y + 34, w, h - 34, w / 2, cy, R, T, -118, 118, (d) => v(d).frac, barColours(accentOf), { segments: 0, mark: (d) => v(d).warnAt }));
        const valH = Math.round(Math.min(R * 0.58, 60) * k), vy = y + 34 + cy - valH * 0.62;
        out.push(text(id + '.val', group, x, vy, w, valH, (d) => v(d).text, (t, d) => ({ color: [levelColour(t, v(d).level), 1], glow: [accentOf(t, d), 0.35 * ST.glow] })));
        out.push(text(id + '.unit', group, x, vy + valH + 6, w, 14, (d) => v(d).unit, plain('dim'), { tracking: 0.16 }));
        return out;
    }
    out.push(text(id + '.unit', group, x + w * 0.62, y + 14, w * 0.38 - 14, 20, (d) => v(d).unit, plain('dim'), { align: 1, tracking: 0.08 }));
    const big = style === 'number';
    const valH = Math.round(Math.min(h * (big ? 0.5 : 0.44), big ? 120 : 96) * k);
    const vy = y + 44;
    out.push(text(id + '.val', group, x + 14, vy, w - 28, valH, (d) => v(d).text, (t, d) => ({ color: [levelColour(t, v(d).level), 1], glow: [accentOf(t, d), 0.3 * ST.glow] }), { align: 0 }));
    if (sub) out.push(text(id + '.sub', group, x + 14, vy + valH + 6, w - 28, 18, sub, plain('dim'), { align: 0, tracking: 0.08 }));
    const sy = vy + valH + (sub ? 30 : 8), sh = y + h - (big ? 10 : 26) - sy;
    if (sh >= 18) out.push(spark(id + '.spark', group, x + 10, sy, w - 20, sh, (d) => (v(d).value === null ? null : v(d).frac), accentOf));
    if (!big) out.push(bar(id + '.bar', group, x + 10, y + h - 22, w - 20, 14, (d) => v(d).frac, barColours(accentOf), { mark: (d) => v(d).warnAt }));
    return out;
}

/** Rectangles for n slots in the body (1, 2, 3, 4 or 6). */
function grid(n, area) {
    const a = area || BODY, gap = 12;
    const cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = n <= 3 ? 1 : 2;
    const w = (a.w - gap * (cols - 1)) / cols, h = (a.h - gap * (rows - 1)) / rows;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: Math.round(a.x + (i % cols) * (w + gap)), y: Math.round(a.y + Math.floor(i / cols) * (h + gap)), w: Math.round(w), h: Math.round(h) });
    return out;
}
function slotted(group, keys, style, o, subs) {
    const rects = grid(keys.length), out = [].concat(...rects.map((r, i) => tile(group, 's' + i, r.x, r.y, r.w, r.h, keys[i], style, o, subs && subs[i])));
    if (ST.sep) {
        // hairlines between the tiles instead of boxes round them
        rects.forEach((r, i) => {
            if (r.x > BODY.x + 1) out.push(hair(group + '.sv' + i, group, r.x - 6, r.y + 10, 1, r.h - 20));
            if (r.y > BODY.y + 1) out.push(hair(group + '.sh' + i, group, r.x + 10, r.y - 6, r.w - 20, 1));
        });
    }
    return out;
}

/* ---------- the pages ---------- */
const fmtMin = (m) => (m === null || m === undefined ? '--' : m < 1 ? '<1 MIN' : Math.round(m) + ' MIN');
const clockIn = (min) => (min === null || min === undefined ? '' : 'AT ' + require('./clock').hm(Date.now() + min * 60000));
const secs = (s) => (isNum(s) ? (s >= 60 ? Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2) : s.toFixed(s < 10 ? 2 : 1)) : '--');
/** A countdown: 1:20, 0:45. */
const mmss = (s) => (isNum(s) ? Math.floor(s / 60) + ':' + ('0' + Math.floor(s % 60)).slice(-2) : '--');
const tempOf = (o, c) => (isNum(c) ? Math.round(o.units.temp === 'f' ? c * 9 / 5 + 32 : c) : null);

const PAGES = {
    temps: { title: 'TEMPERATURES', needs: ['iat', 'gearbox'], build: (o, g) => slotted(g, ['oil', 'coolant', 'gearbox', 'iat', 'iatRise', 'outside'], o.style, o) },
    fuel: {
        title: 'FUEL AND BOOST', needs: ['hpfp', 'lpfp', 'timing', 'boostTarget'],
        build: (o, g) => slotted(g, ['hpfp', 'lpfp', 'boostActual', 'timing'], o.style, o,
            [null, null, (d) => (isNum(d.boostTarget) ? 'TARGET ' + view('boostTarget', d, o.units).text + ' ' + view('boostTarget', d, o.units).unit : ''), null]),
    },
    warmup: {
        title: 'WARM-UP', needs: [],
        build: (o, g) => {
            const w = (d) => d.warm || {};
            const L = { x: BODY.x, y: BODY.y, w: 330, h: BODY.h };
            const target = o.warmTarget || 90;
            const oilFrac = (d) => (isNum(d.oil) ? Math.max(0, Math.min(1, (d.oil - 20) / (target - 20))) : 0);
            const R = 120, cy = 176;
            return [card(g + '.oilC', g, L.x, L.y, L.w, L.h),
                icon(g + '.oilI', g, L.x + 14, L.y + 13, 20, 1, (t, d) => (w(d).ready ? t.green : t.cold)),
                label(g + '.oilL', g, L.x + 42, L.y + 17, 200, 'ENGINE OIL'),
                arc(g + '.oilA', g, L.x, L.y + 30, L.w, L.h - 30, L.w / 2, cy, R, 18, -125, 125, oilFrac,
                    (t, d) => ({ track: t.track, fill0: t.cold, fill1: w(d).ready ? t.green : t.yellow, redc: t.warn, tip: '#ffffff', tick: t.dim, num: t.text })),
                text(g + '.oil', g, L.x, L.y + 30 + cy - 60, L.w, 64, (d) => (isNum(d.oil) ? String(tempOf(o, d.oil)) : '--'), (t, d) => ({ color: [t.text, 1], glow: [w(d).ready ? t.green : t.cold, 0.4] })),
                text(g + '.oilU', g, L.x, L.y + 30 + cy + 12, L.w, 14, o.units.temp === 'f' ? '°F' : '°C', plain('dim'), { tracking: 0.16 }),
                text(g + '.oilT', g, L.x, L.y + L.h - 40, L.w, 14, 'WARM AT ' + tempOf(o, target) + (o.units.temp === 'f' ? '°F' : '°C'), plain('dim'), { tracking: 0.14 }),
                card(g + '.etaC', g, BODY.x + 342, BODY.y, 394, 160),
                icon(g + '.etaI', g, BODY.x + 356, BODY.y + 13, 20, 9, 'accent'),
                label(g + '.etaL', g, BODY.x + 384, BODY.y + 17, 330, 'OIL AT WORKING TEMPERATURE'),
                text(g + '.eta', g, BODY.x + 358, BODY.y + 46, 360, 62, (d) => (w(d).ready ? 'READY' : fmtMin(w(d).minutes)), (t, d) => ({ color: [w(d).ready ? t.green : t.text, 1], glow: [w(d).ready ? t.green : t.accent, 0.35] }), { align: 0 }),
                text(g + '.at', g, BODY.x + 358, BODY.y + 120, 360, 16, (d) => (w(d).ready ? 'DRIVE AS YOU LIKE' : clockIn(w(d).minutes)), plain('dim'), { align: 0, tracking: 0.12 }),
                card(g + '.limC', g, BODY.x + 342, BODY.y + 172, 394, BODY.h - 172),
                icon(g + '.limI', g, BODY.x + 356, BODY.y + 185, 20, 13, (t, d) => (w(d).ready ? t.green : t.yellow)),
                label(g + '.limL', g, BODY.x + 384, BODY.y + 189, 330, 'REV LIMIT FOR NOW'),
                text(g + '.lim', g, BODY.x + 358, BODY.y + 214, 360, 50, (d) => (isNum(w(d).limit) ? w(d).limit + ' RPM' : '--'), (t, d) => ({ color: [w(d).ready ? t.green : t.yellow, 1], glow: [w(d).ready ? t.green : t.yellow, 0.35] }), { align: 0 }),
                bar(g + '.limB', g, BODY.x + 352, BODY.y + BODY.h - 34, 374, 18, (d) => (isNum(w(d).limit) ? w(d).limit / (o.redline || 6500) : 0), (t, d) => barColours(w(d).ready ? 'green' : 'yellow')(t, d)),
            ];
        },
    },
    cooldown: {
        title: 'TURBO COOL-DOWN', needs: [],
        build: (o, g) => {
            const c = (d) => d.cool || {};
            const cx = BODY.w / 2, R = 128;
            return [card(g + '.c', g, BODY.x, BODY.y, BODY.w, BODY.h),
                arc(g + '.ring', g, BODY.x, BODY.y, BODY.w, BODY.h, cx, BODY.h / 2 + 6, R, 16, -179.5, 179.5, (d) => (c(d).active ? c(d).seconds / Math.max(30, c(d).total) : 1),
                    (t, d) => barColours(c(d).active ? 'yellow' : 'green')(t, d), { segments: 60 }),
                icon(g + '.i', g, BODY.x + cx - 18, BODY.y + BODY.h / 2 - 84, 36, 5, (t, d) => (c(d).active ? t.yellow : t.green)),
                text(g + '.left', g, BODY.x + cx - 120, BODY.y + BODY.h / 2 - 34, 240, 76, (d) => (c(d).active ? mmss(c(d).seconds) : 'OK'), (t, d) => ({ color: [t.text, 1], glow: [c(d).active ? t.yellow : t.green, 0.4] })),
                text(g + '.state', g, BODY.x + cx - 120, BODY.y + BODY.h / 2 + 52, 240, 14, (d) => (c(d).active ? 'DRIVE GENTLY' : 'TURBOS ARE COOL'), (t, d) => ({ color: [c(d).active ? t.yellow : t.green, 1], glow: [t.accent, 0] }), { tracking: 0.16 }),
                label(g + '.h1', g, BODY.x + 22, BODY.y + 20, 200, 'COUNTS DOWN'),
                text(g + '.h2', g, BODY.x + 22, BODY.y + 40, 200, 14, 'BELOW 3000 RPM', plain('text'), { align: 0, tracking: 0.12 }),
                label(g + '.h3', g, BODY.x + BODY.w - 222, BODY.y + 20, 200, 'BUILT UP BY', { align: 1 }),
                text(g + '.h4', g, BODY.x + BODY.w - 222, BODY.y + 40, 200, 14, 'HARD DRIVING', plain('text'), { align: 1, tracking: 0.12 })];
        },
    },
    xdrive: {
        title: 'XDRIVE', needs: ['splitRear'],
        build: (o, g) => {
            const pct = (k) => (d) => (isNum(d[k]) ? Math.round(d[k]) + '%' : '--');
            const share = (k) => (d) => (isNum(d[k]) ? d[k] / 100 : 0);
            const R = { x: BODY.x + 360, w: BODY.w - 360 };
            return [
                { key: g + '.car', group: g, kind: 'car', x: BODY.x + 20, y: BODY.y, w: 320, h: BODY.h, value: share('splitRear'), max: 1, sweep: false,
                    dyn: (d) => ({ u_valid: [isNum(d.splitRear) ? 1 : 0] }), colors: (t) => ({ body: t.body, edge: mix(t.edge, '#ffffff', 0.15), accent: t.accent, wheel: t.wheel }) },
                card(g + '.c', g, R.x, BODY.y, R.w, BODY.h),
                label(g + '.fl', g, R.x + 20, BODY.y + 18, 120, 'FRONT'),
                text(g + '.f', g, R.x + 20, BODY.y + 40, 200, 58, (d) => (!isNum(d.splitFront) && isNum(d.splitFrontNm) ? d.splitFrontNm + ' Nm' : pct('splitFront')(d)), glowing('text', 0.35), { align: 0 }),
                label(g + '.rl', g, R.x + R.w - 140, BODY.y + 18, 120, 'REAR', { align: 1 }),
                text(g + '.r', g, R.x + R.w - 180, BODY.y + 40, 160, 58, (d) => (!isNum(d.splitRear) && isNum(d.splitFrontNm) ? 'ON' : pct('splitRear')(d)), glowing('text', 0.35), { align: 1 }),
                // one bar: the front's share from the left, the rear's from the right
                bar(g + '.fb', g, R.x + 14, BODY.y + 112, (R.w - 28) / 2, 18, share('splitFront'), barColours('accent'), { fromRight: true }),
                bar(g + '.rb', g, R.x + 14 + (R.w - 28) / 2, BODY.y + 112, (R.w - 28) / 2, 18, share('splitRear'), barColours('accent')),
                label(g + '.tl', g, R.x + 20, BODY.y + 150, 300, 'REAR SHARE, LAST 2 MIN'),
                spark(g + '.sp', g, R.x + 12, BODY.y + 170, R.w - 24, 110, (d) => (isNum(d.splitRear) ? d.splitRear / 100 : null), 'accent'),
                text(g + '.src', g, R.x + 20, BODY.y + BODY.h - 28, R.w - 40, 13, (d) => (d.splitFrom === 'car' ? 'FROM THE CAR' : d.splitFrom ? 'FROM THE TRANSFER CASE' : 'NO SPLIT DATA YET'), plain('dim'), { align: 0, tracking: 0.12 }),
            ];
        },
    },
    edrive: {
        title: 'EDRIVE', needs: [],
        build: (o, g) => {
            const kw = (d) => (isNum(d.kw) ? d.kw : 0);
            const L = { x: BODY.x, y: BODY.y, w: 300, h: BODY.h }, M = { x: BODY.x + 312, w: 424 };
            const R = 108, cy = 150;
            const pd = (k, lbl, ic, y) => [icon(g + '.' + k + 'I', g, M.x + 220, y - 2, 20, ic, 'dim'), label(g + '.' + k + 'L', g, M.x + 246, y - 4, 100, lbl),
                bar(g + '.' + k, g, M.x + 350, y - 1, 64, 14, (d) => (isNum(d[k]) ? Math.min(1, d[k] / 100) : 0), barColours('accent'))];
            return [card(g + '.socC', g, L.x, L.y, L.w, L.h),
                icon(g + '.socI', g, L.x + 14, L.y + 13, 20, 6, 'ev'), label(g + '.socL', g, L.x + 42, L.y + 17, 200, 'BATTERY'),
                arc(g + '.ring', g, L.x, L.y + 26, L.w, L.h - 26, L.w / 2, cy, R, 16, -135, 135, (d) => (isNum(d.soc) ? d.soc / 100 : 0), barColours('ev'), { segments: 40 }),
                text(g + '.soc', g, L.x, L.y + 26 + cy - 40, L.w, 62, (d) => (isNum(d.soc) ? Math.round(d.soc) + '%' : '--'), glowing('ev', 0.4)),
                text(g + '.er', g, L.x, L.y + 26 + cy + 30, L.w, 18, (d) => view('erange', d, o.units).text + ' ' + view('erange', d, o.units).unit, plain('dim'), { tracking: 0.1 }),
                icon(g + '.btI', g, L.x + 20, L.y + L.h - 52, 18, 0, (t, d) => levelAccent(t, view('battTemp', d, o.units, o.warn).level)),
                text(g + '.bt', g, L.x + 44, L.y + L.h - 54, 120, 24, (d) => view('battTemp', d, o.units).text + view('battTemp', d, o.units).unit, (t, d) => ({ color: [levelColour(t, view('battTemp', d, o.units, o.warn).level), 1], glow: [t.accent, 0] }), { align: 0 }),
                text(g + '.btR', g, L.x + 140, L.y + L.h - 50, 144, 15, (d) => (isNum(d.battMin) && isNum(d.battMax) ? 'CELLS ' + tempOf(o, d.battMin) + '-' + tempOf(o, d.battMax) + '°' : ''), plain('dim'), { align: 1, tracking: 0.08 }),
                card(g + '.kwC', g, M.x, BODY.y, M.w, 196),
                icon(g + '.kwI', g, M.x + 14, BODY.y + 13, 20, 7, (t, d) => (kw(d) < -0.3 ? t.regen : t.ev)), label(g + '.kwL', g, M.x + 42, BODY.y + 17, 200, 'BATTERY POWER'),
                text(g + '.kw', g, M.x + 16, BODY.y + 40, 200, 50, (d) => view('kw', d, o.units).text, (t, d) => ({ color: [kw(d) < -0.3 ? t.regen : t.text, 1], glow: [kw(d) < -0.3 ? t.regen : t.ev, 0.35] }), { align: 0 }),
                text(g + '.kwU', g, M.x + M.w - 76, BODY.y + 17, 60, 14, 'kW', plain('dim'), { align: 1, tracking: 0.14 }),
                // either side of zero: charging fills left, drawing fills right
                bar(g + '.regen', g, M.x + 12, BODY.y + 104, (M.w - 24) / 2, 18, (d) => Math.min(1, Math.max(0, -kw(d)) / 60), barColours('regen'), { fromRight: true }),
                bar(g + '.draw', g, M.x + 12 + (M.w - 24) / 2, BODY.y + 104, (M.w - 24) / 2, 18, (d) => Math.min(1, Math.max(0, kw(d)) / 100), barColours('ev')),
                label(g + '.chg', g, M.x + 18, BODY.y + 130, 150, 'CHARGING'), label(g + '.drw', g, M.x + M.w - 168, BODY.y + 130, 150, 'DRAWING', { align: 1 }),
                spark(g + '.kwS', g, M.x + 10, BODY.y + 150, M.w - 20, 40, (d) => (isNum(d.kw) ? Math.max(0, Math.min(1, (d.kw + 60) / 160)) : null), 'ev'),
                card(g + '.pdC', g, M.x, BODY.y + 208, M.w, BODY.h - 208),
                icon(g + '.frI', g, M.x + 14, BODY.y + 221, 20, 4, 'accent'), label(g + '.frL', g, M.x + 42, BODY.y + 225, 160, 'FUEL RANGE'),
                text(g + '.fr', g, M.x + 16, BODY.y + 250, 190, 40, (d) => view('frange', d, o.units).text + ' ' + view('frange', d, o.units).unit, glowing('text', 0.2), { align: 0 }),
                label(g + '.pdT', g, M.x + 220, BODY.y + 225, 190, 'POWER GOES TO'),
            ].concat(pd('pdDrive', 'DRIVE', 10, BODY.y + 258), pd('pdClimate', 'CLIMATE', 12, BODY.y + 290), pd('pdSeats', 'SEATS', 0, BODY.y + 322));
        },
    },
    engine: {
        title: 'ENGINE', needs: [],
        build: (o, g) => {
            const e = (d) => d.eng || {};
            const onC = (t, d) => (d.engineOn ? t.yellow : d.engineOn === false ? t.green : t.dim);
            const stat = (k, x, w, ic, lbl, val) => [card(g + '.' + k + 'C', g, x, BODY.y + 150, w, BODY.h - 150), icon(g + '.' + k + 'I', g, x + 14, BODY.y + 163, 20, ic, 'accent'),
                label(g + '.' + k + 'L', g, x + 42, BODY.y + 167, w - 56, lbl), text(g + '.' + k, g, x + 16, BODY.y + 196, w - 32, 44, val, glowing('text', 0.2), { align: 0 })];
            return [card(g + '.c', g, BODY.x, BODY.y, BODY.w, 138),
                icon(g + '.big', g, BODY.x + 30, BODY.y + 31, 76, (d) => (d.engineOn === false ? 7 : 11), onC),
                text(g + '.state', g, BODY.x + 134, BODY.y + 34, 460, 60, (d) => (d.engineOn ? 'ENGINE ON' : d.engineOn === false ? 'ELECTRIC' : '--'), (t, d) => ({ color: [t.text, 1], glow: [onC(t, d), 0.45] }), { align: 0 }),
                text(g + '.why', g, BODY.x + 136, BODY.y + 102, 560, 15, (d) => (e(d).why ? 'STARTED: ' + e(d).why : ''), plain('dim'), { align: 0, tracking: 0.12 }),
            ].concat(stat('rpm', BODY.x, 236, 13, 'ENGINE SPEED', (d) => (isNum(d.rpm) ? String(Math.round(d.rpm / 10) * 10) : '--')),
                stat('on', BODY.x + 250, 236, 9, 'RAN THIS DRIVE', (d) => (isNum(e(d).onMs) ? Math.floor(e(d).onMs / 60000) + ' MIN' : '--')),
                stat('starts', BODY.x + 500, 236, 7, 'STARTS THIS DRIVE', (d) => (isNum(e(d).starts) ? String(e(d).starts) : '--')),
                [spark(g + '.rpmS', g, BODY.x + 10, BODY.y + BODY.h - 64, 216, 52, (d) => (isNum(d.rpm) ? Math.min(1, d.rpm / 7000) : null), 'accent')]);
        },
    },
    steering: {
        title: 'STEERING', needs: [],
        build: (o, g) => {
            const half = (BODY.w - 40) / 2;
            const centreBar = (k, y, val, max) => [bar(g + '.' + k + 'L', g, BODY.x + 20, y, half, 20, (d) => (isNum(val(d)) ? Math.min(1, Math.max(0, -val(d)) / max) : 0), barColours('accent'), { fromRight: true }),
                bar(g + '.' + k + 'R', g, BODY.x + 20 + half, y, half, 20, (d) => (isNum(val(d)) ? Math.min(1, Math.max(0, val(d)) / max) : 0), barColours('accent'))];
            return [card(g + '.c', g, BODY.x, BODY.y, BODY.w, BODY.h),
                icon(g + '.wI', g, BODY.x + 22, BODY.y + 20, 44, 8, 'accent'),
                label(g + '.saL', g, BODY.x + 80, BODY.y + 22, 200, 'STEERING ANGLE'),
                text(g + '.sa', g, BODY.x + 80, BODY.y + 40, 200, 40, (d) => (isNum(d.steer) ? Math.round(d.steer) + '°' : '--'), glowing('text', 0.2), { align: 0 }),
                label(g + '.yrL', g, BODY.x + 300, BODY.y + 22, 200, 'YAW RATE'),
                text(g + '.yr', g, BODY.x + 300, BODY.y + 40, 200, 40, (d) => (isNum(d.yaw) ? d.yaw.toFixed(1) + '°/S' : '--'), glowing('text', 0.2), { align: 0 }),
                label(g + '.lgL', g, BODY.x + 520, BODY.y + 22, 200, 'LATERAL G'),
                text(g + '.lg', g, BODY.x + 520, BODY.y + 40, 200, 40, (d) => view('gLat', d, o.units).text, glowing('text', 0.2), { align: 0 }),
            ].concat(centreBar('sa', BODY.y + 112, (d) => d.steer, 540), centreBar('lg', BODY.y + 160, (d) => d.gLat, 1.2), [
                label(g + '.lgS', g, BODY.x + 22, BODY.y + 196, 400, 'LATERAL G, LAST 2 MIN'),
                spark(g + '.sp', g, BODY.x + 12, BODY.y + 214, BODY.w - 24, 82, (d) => (isNum(d.gLat) ? Math.max(0, Math.min(1, (d.gLat + 1.2) / 2.4)) : null), 'accent'),
                text(g + '.note', g, BODY.x + 22, BODY.y + BODY.h - 26, 500, 13, (d) => (isNum(d.steer) ? '' : 'NEEDS THE CAR\'S STEERING SIGNAL'), plain('dim'), { align: 0, tracking: 0.1 })]);
        },
    },
    timer: {
        title: '0-60 AND QUARTER MILE', needs: [],
        build: (o, g) => {
            const p = (d) => d.perf || {};
            const kmh = o.units.speed === 'kmh', first = kmh ? '0-100 KM/H' : '0-60 MPH';
            const best = (k) => (d) => (isNum((p(d).best || {})[k]) ? 'BEST ' + secs(p(d).best[k]) : 'NO BEST YET');
            const last = (k) => (d) => secs(((p(d).run && p(d).mode === 'running' ? p(d).run : p(d).last) || {})[k]);
            const STATES = { off: 'PRESS ARM IN THE APP', armed: 'STOP THE CAR', ready: 'READY - GO WHEN YOU ARE', running: 'RUNNING', done: 'ARM AGAIN FOR ANOTHER RUN' };
            const stC = (t, d) => (p(d).mode === 'ready' ? t.green : p(d).mode === 'running' ? t.yellow : t.dim);
            const res = (k, x, lbl, val, bst, extra) => [card(g + '.' + k + 'C', g, x, BODY.y + 150, 362, BODY.h - 150), icon(g + '.' + k + 'I', g, x + 14, BODY.y + 163, 20, 9, 'accent'),
                label(g + '.' + k + 'L', g, x + 42, BODY.y + 167, 300, lbl), text(g + '.' + k, g, x + 16, BODY.y + 192, 200, 58, val, glowing('text', 0.3), { align: 0 }),
                text(g + '.' + k + 'B', g, x + 16, BODY.y + 262, 330, 14, bst, plain('dim'), { align: 0, tracking: 0.12 })].concat(extra || []);
            return [card(g + '.c', g, BODY.x, BODY.y, BODY.w, 138),
                icon(g + '.sw', g, BODY.x + 26, BODY.y + 30, 76, 9, stC),
                text(g + '.el', g, BODY.x + 130, BODY.y + 22, 300, 80, (d) => (p(d).mode === 'running' ? secs(p(d).elapsed) : '0.00'), glowing('text', 0.35), { align: 0 }),
                text(g + '.state', g, BODY.x + 130, BODY.y + 108, 560, 14, (d) => STATES[p(d).mode] || '', (t, d) => ({ color: [stC(t, d), 1], glow: [t.accent, 0] }), { align: 0, tracking: 0.16 }),
            ].concat(res('a', BODY.x, first, last('sixty'), best('sixty')),
                res('q', BODY.x + 374, 'QUARTER MILE', last('quarter'), best('quarter'), [text(g + '.qT', g, BODY.x + 374 + 200, BODY.y + 222, 146, 18, (d) => { const r = (p(d).mode === 'running' ? null : p(d).last) || {}; return isNum(r.trap) ? Math.round(kmh ? r.trap : r.trap / 1.609344) + (kmh ? ' KM/H' : ' MPH') : ''; }, plain('dim'), { align: 1, tracking: 0.08 })]));
        },
    },
};
// the custom pages: the slots the settings pick
['custom1', 'custom2'].forEach((id, i) => {
    PAGES[id] = {
        title: 'CUSTOM ' + (i + 1), needs: [], custom: i,
        build: (o, g) => { const c = (o.custom && o.custom[i]) || { slots: ['oil', 'coolant'], style: 'bar' }; return slotted(g, c.slots.length ? c.slots : ['oil'], c.style, o); },
        needsOf: (o) => ((o.custom && o.custom[i]) || { slots: [] }).slots,
    };
});

/** '#rrggbb' a..b by f. */
function mix(a, b, f) {
    const p = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
    return '#' + [0, 1, 2].map((i) => { const v = Math.round(p(a, i) + (p(b, i) - p(a, i)) * Math.max(0, Math.min(1, f))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

/**
 * Every piece: the background, each page chosen (its group the page's id) with its title, and on every page
 * the shift light with the gear and the cool-down countdown.
 */
function pieces(o) {
    ST = STYLES[o.look] || STYLES.native;
    const list = [{ key: 'bg', kind: 'bg', x: 0, y: 0, w: W, h: H, params: { u_look: ST.bg, u_feather: [ST.feather] }, colors: (t) => ({ top: t.bgTop, bottom: t.bgBottom, accent: t.accent }) }];
    o.pages.forEach((id) => {
        const pg = PAGES[id];
        if (!pg) return;
        const tw = pg.title.length * 12 + 24;
        list.push(text(id + '.title', id, BOX.x, 70, BOX.w, 22, pg.title, ST.title === 'accent' ? glowing('accent', 0.5) : plain('dim'), { tracking: 0.3 }));
        list.push({ key: id + '.tl', group: id, kind: 'flat', x: Math.round(W / 2 - tw - 120), y: 82, w: 120, h: 1, colors: (t) => ({ color: [t.accentDim, 1] }) });
        list.push({ key: id + '.tr', group: id, kind: 'flat', x: Math.round(W / 2 + tw), y: 82, w: 120, h: 1, colors: (t) => ({ color: [t.accentDim, 1] }) });
        list.push(...pg.build(o, id));
    });
    if (o.shift && o.shift.on) {
        const span = Math.max(500, o.shift.at - o.shift.from);
        const lit = (d) => (isNum(d.rpm) ? Math.max(0, Math.min(1, (d.rpm - o.shift.from) / span)) : 0);
        const flash = (d) => isNum(d.rpm) && d.rpm >= o.shift.at;
        list.push(text('gear', null, BOX.x, 26, 80, 42, (d) => gearOf(d), (t, d) => ({ color: [flash(d) ? t.warn : t.text, 1], glow: [flash(d) ? t.warn : t.accent, 0.45] }), { align: 0 }));
        const lh = Math.round(44 * ST.ledK);
        list.push({ key: 'shift', kind: 'leds', x: BOX.x + 96, y: 24 + (44 - lh) / 2, w: BOX.w - 192, h: lh, value: lit, max: 1, params: { u_count: [ST.ledShape ? 20 : 15], u_soft: [ST.soft], u_shape: [ST.ledShape] },
            dyn: (d) => ({ u_flash: [flash(d) ? 1 : 0] }), colors: (t) => (ST.ledShape ? { off: '#18202a', green: '#c7d3df', yellow: t.yellow, red: '#ff3b30' } : { off: '#151b22', green: t.green, yellow: t.yellow, red: t.warn }) });
    }
    if (o.badge) {
        const on = (d) => !!(d.cool && d.cool.active);
        list.push(icon('coolIcon', null, BOX.x + BOX.w - 92, 36, 20, 5, (t, d) => (on(d) ? t.yellow : t.bgBottom)));
        list.push(text('coolBadge', null, BOX.x + BOX.w - 70, 30, 70, 32, (d) => (on(d) ? mmss(d.cool.seconds) : ''), (t, d) => ({ color: [t.yellow, on(d) ? 1 : 0], glow: [t.yellow, on(d) ? 0.4 : 0] }), { align: 1 }));
    }
    const fit = FITS[o.fit] || FITS.clear;
    // the free/open-source credit is shown on the app's own screen (main.js), not drawn on the cluster glass
    return list.filter(Boolean).map((p) => (p.key === 'bg' || fit.k === 1 ? p : scaled(p, fit))).map(legible);
}

/*
 * The smallest text on the glass, in the cluster's pixels: the factory cluster's own small print (its 'mi/kWh',
 * 'Power %') stands about 20 px. Smaller text is grown to it about its centre line, its box widened from the
 * side it is aligned to, so it isn't clipped.
 */
const MIN_TEXT = 20;
function legible(p) {
    if (p.kind !== 'text' || p.h >= MIN_TEXT) return p;
    // the factory's small print isn't spaced out: tracking down to 0.04, then the box only as wide as the
    // text needs (a fixed text's width estimated, ~0.55 of the height a letter)
    const tr = Math.min(p.tracking || 0, 0.04), a = p.align === undefined ? 0.5 : p.align;
    // (a changing text keeps its box: they are laid out wide enough)
    const need = typeof p.text === 'string' ? p.text.length * MIN_TEXT * (0.55 + tr) : p.w;
    const w = Math.min(W, Math.max(p.w, need)), x = Math.max(0, Math.min(W - w, p.x - (w - p.w) * a));
    return Object.assign({}, p, { tracking: tr, y: Math.round((p.y - (MIN_TEXT - p.h) / 2) * 100) / 100, h: MIN_TEXT,
        x: Math.round(x * 100) / 100, w: Math.round(w * 100) / 100 });
}

/*
 * Where the pages sit. The stock cluster draws its own readouts over the edges of the centre (the digital
 * speed and its line on the left, the efficiency gauge and the range on the right, its flanks at both
 * sides), so by default the pages are made smaller and sit between them: x about 290 to 850 of the 1088.
 * 'full' uses the whole middle (BOX) as designed.
 */
const FITS = { clear: { k: 0.76, cx: 570, cy: 236 }, full: { k: 1, cx: W / 2, cy: H / 2 } };
/* a piece's params that are pixels (by kind and index), scaled with it */
const PX = { panel: { u_box: [0, 1] }, band: { u_geo: [0, 1, 2, 3], u_marks: [2, 3] }, icon: { u_line: [0] }, dial: { u_arc: [2, 3], u_needle_dim: [0, 1, 2, 3], u_look: [3], u_look2: [0, 1] } };
function scaled(p, f) {
    const q = Object.assign({}, p);
    const x = f.cx + (p.x - W / 2) * f.k, y = f.cy + (p.y - H / 2) * f.k;
    q.x = Math.round(x * 100) / 100; q.y = Math.round(y * 100) / 100; q.w = Math.round(p.w * f.k * 100) / 100; q.h = Math.round(p.h * f.k * 100) / 100;
    const px = PX[p.kind];
    if (px && p.params) {
        q.params = Object.assign({}, p.params);
        Object.keys(px).forEach((u) => {
            if (!q.params[u]) return;
            q.params[u] = q.params[u].slice();
            px[u].forEach((i) => { if (typeof q.params[u][i] === 'number') q.params[u][i] = Math.round(q.params[u][i] * f.k * 1000) / 1000; });
        });
    }
    return q;
}
/** The gear for the top: P R N, or D / S / M and the gear. */
function gearOf(d) {
    if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
    if (d.gear === -1) return 'R';
    const g = isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
    return (d.mode === 'S' || d.mode === 'M' ? d.mode : 'D') + g;
}

module.exports = { PAGES, pieces, palette, ACCENTS, STYLES, FITS, grid, W, H, BOX, BODY, gearOf, mix };
