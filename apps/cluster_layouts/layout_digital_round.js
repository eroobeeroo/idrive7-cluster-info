'use strict';
/**
 * layout_digital_round.js - "Digital round": round dials drawn as a display rather than a printed face, a
 * lit value arc running to each needle, the fuel range in the speedometer and the electric range with the
 * battery's charge in the rev counter, and a centre card with the time and outside temperature, the P R N D
 * row, the gear, the digital speed and arc gauges for oil and coolant. With the map in the centre the dials
 * move to the edges and the readings round the map. Its colours follow the drive mode. An original design.
 */
const C = require('./layout_common');

const CY = 360;
const PALETTES = {
    comfort: {
        bg: '#030508', face0: '#141a22', face1: '#07090d', bezel: '#7c8a99', bezel2: '#1c232b', tick: '#f2f7ff', minor: '#5d6b7a',
        num: '#e9f1fb', glow: '#58b8ff', red: '#ff3b30', needle: '#9fd8ff', hub: '#10151b', accent: '#3fa6ff',
        cardTop: '#111821', cardBottom: '#06090d', cardEdge: '#21405e', text: '#f2f7ff', dim: '#a6aeb6', track: '#141c26', ev: '#4ab4ff',
    },
    sport: {
        bg: '#060303', face0: '#1e1213', face1: '#0a0606', bezel: '#a07a78', bezel2: '#2b1c1c', tick: '#ffffff', minor: '#7a5c5c',
        num: '#ffffff', glow: '#ff3b2f', red: '#ff2414', needle: '#ff5a4a', hub: '#170f0f', accent: '#ff2e22',
        cardTop: '#1d1112', cardBottom: '#0a0606', cardEdge: '#6a1f1a', text: '#ffffff', dim: '#b6a5a5', track: '#241515', ev: '#4ab4ff',
    },
    efficient: {
        bg: '#020606', face0: '#0f1a1a', face1: '#050b0b', bezel: '#6f9a92', bezel2: '#182624', tick: '#effffb', minor: '#4f6e69',
        num: '#e6fff8', glow: '#2fe0b0', red: '#ff3b30', needle: '#7ff0d0', hub: '#0c1514', accent: '#22d3a0',
        cardTop: '#0f1a19', cardBottom: '#050a0a', cardEdge: '#1c5a4c', text: '#effffb', dim: '#9eafac', track: '#102020', ev: '#22d3a0',
    },
};
const dialColours = (t) => ({ face0: t.face0, face1: t.face1, bezel: t.bezel, bezel2: t.bezel2, tick: t.tick, minor: t.minor, num: t.num, red: t.red, needle: t.needle, hub: t.hub, accent: t.accent, glow: t.glow });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const txt = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.25] });
const evTxt = (t) => ({ color: [t.ev, 1], glow: [t.ev, 0.3] });
const barColours = (t) => ({ track: t.track, fill0: t.ev, fill1: t.ev, redc: t.red, tip: t.glow, tick: t.dim, num: t.num });

/** A small arc gauge for a temperature (40-140 °C) with its digits and label. */
function tempArc(key, x, y, which, redC, o) {
    return [
        {
            key, kind: 'band', x, y, w: 200, h: 112,
            params: { u_geo: [100, 104, 76, 12], u_span: [-90, 90, 20, 0.22], u_marks: [4, 0, 0, -1], u_red: [(redC - 40) / 100] },
            colors: (t) => ({ track: t.track, fill0: t.accent, fill1: t.accent, redc: t.red, tip: t.glow, tick: t.dim, num: t.num }),
            value: (d) => C.tempFrac(d[which]), max: 1, sweep: true,
        },
        C.text(key + 'Txt', x, y + 64, 200, 40, (d) => C.tempText(o, d[which]), (t, d) => ({ color: [C.isNum(d[which]) && d[which] >= redC ? t.red : t.text, 1], glow: [t.glow, 0] })),
        C.text(key + 'Lbl', x, y + 112, 200, 16, which === 'oil' ? 'OIL' : 'COOLANT', lbl, { tracking: 0.16 }),
    ];
}

/** A dial sized `size` at cx, with its unit and the range (and charge) in its lower half. */
function dialSet(o, which, cx, size, cy) {
    cy = cy === undefined ? CY : cy;
    const k = size / 640, s = which === 'speed' ? C.speedScale(o) : C.rpmScale(o);
    const parts = [{
        key: which, kind: 'dial', x: cx - size / 2, y: cy - size / 2, w: size, h: size,
        params: { u_scale: [s.max, s.major, s.minor, which === 'speed' ? s.max + 1 : s.red], u_arc: [-128, 128, Math.round(40 * k + 2), 196 * k], u_needle_dim: [276 * k, 30 * k, 12 * k, 4], u_look: [0.35, 0.25, 1, 62 * k], u_look2: [7, k, 0.45, 0.6] },
        colors: dialColours, max: s.max, sweep: true,
        value: which === 'speed' ? (d) => (C.isNum(d.speed) ? C.speedIn(o, d.speed) : 0) : (d) => (C.isNum(d.rpm) ? d.rpm / 1000 : 0),
    }, C.text(which + 'Unit', cx - 120, cy + Math.round(86 * k), 240, Math.round(20 * k), which === 'speed' ? C.speedUnit(o) : 'X1000 RPM', lbl, { tracking: 0.14 })];
    const y = cy + Math.round(130 * k), w = Math.round(220 * k), h = Math.round(36 * k);
    if (which === 'speed') return parts.concat(C.reading('fuel', cx - w / 2, y, w, h, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl));
    // the electric range and charge, or (Show: Engine) the boost and timing
    return parts.concat(C.reading('elec', cx - w / 2, y, w, h, C.focus.both(o), C.focus.rangeLabel(o), C.engineFocus(o) ? txt : evTxt, lbl),
        [C.bar('soc', cx - w / 2, y + Math.round(h * 1.75) + 6, w, Math.round(14 * k + 4), C.focus.bar(o), C.engineFocus(o) ? (t) => Object.assign(barColours(t), { fill0: t.accent, fill1: t.accent }) : barColours, 16)]);
}

module.exports = {
    id: 'digital_round',
    title: 'Digital round',
    palette: (lookId) => PALETTES[lookId] || PALETTES.comfort,
    gearText: C.gearText,

    /*
     * Built around what the glass and the KOMBI keep (layout_common; checked by tools/clearance.js): the tach
     * left of the KOMBI's dark box, the temperatures right of it.
     */
    pieces(o) {
        const gear = (x, y, w, h) => C.text('gear', x, y, w, h, C.gearText, (t, d) => ({ color: [C.gearText(d) === 'R' ? t.red : t.text, 1], glow: [t.glow, 0.5] }));
        const selector = (x0, y, size, gap) => 'PRND'.split('').map((ch, i) => C.text('sel' + ch, x0 + i * gap, y, size, size, ch,
            (t, d) => (C.selectorLit(d) === ch ? { color: [ch === 'R' ? t.red : t.accent, 1], glow: [t.glow, 0.9] } : { color: [t.dim, 1], glow: [t.glow, 0] })));
        if (o.centre === 'map') {
            // the speedometer left of the map, a small tach right of the map and the box, the gear and speed in
            // the free corner above the box, the temperatures under the map above the warning lights
            const top = C.MAP.y, bot = C.MAP.y + C.MAP.h;
            return C.aroundMap().map((r, i) => C.flat('bg' + i, r.x, r.y, r.w, r.h, 'bg')).concat(
                dialSet(o, 'speed', 208, 404, 360), dialSet(o, 'rpm', 1792, 256, 500),
                [C.text('clock', 520, top - 78, 200, 34, C.clock, txt), C.text('outside', 1200, top - 78, 200, 34, (d) => C.outsideText(o, d.outside), txt)],
                selector(1530, 128, 26, 44), [gear(1520, 156, 230, 66),
                    C.text('speedDigits', 1520, 224, 230, 32, (d) => C.speedText(o, d) + ' ' + C.speedUnit(o), txt)],
                C.readingUp('oilR', 600, bot + 2, 200, 30, (d) => C.tempText(o, d.oil), 'OIL', txt, lbl),
                C.readingUp('coolantR', 1120, bot + 2, 200, 30, (d) => C.tempText(o, d.coolant), 'COOLANT', txt, lbl),
            );
        }
        const S = 520, cy = 392, L = 300;
        const stock = o.centre === 'stock', R = stock ? 1256 : 1120, SR = stock ? 296 : S;
        const list = [C.flat('bg', 0, 0, 1920, 720, 'bg')].concat(dialSet(o, 'speed', L, S, cy), dialSet(o, 'rpm', R, SR, cy));
        if (stock) {
            list[0] = C.flat('bg', 0, 0, 566, 720, 'bg');
            list.push(C.flat('bgR', 1104, 0, 816, 720, 'bg'));
        }
        // right of the dark box: the temperatures
        list.push(...tempArc('oil', 1690, 292, 'oil', 130, o), ...tempArc('coolant', 1690, 476, 'coolant', 118, o));
        if (stock) return list;
        // the card between the dials (below the camera's cowl, above the warning lights)
        const X = 574, Y = 140, W = 278, H = 470;
        return list.concat([
            { key: 'card', kind: 'panel', x: X, y: Y, w: W, h: H, params: { u_box: [30, 2, 1, 1] }, colors: (t) => ({ top: t.cardTop, bottom: t.cardBottom, border: t.cardEdge }) },
            C.text('clock', X + 20, Y + 18, 118, 30, C.clock, txt, { align: 0 }),
            C.text('outside', X + 140, Y + 18, 118, 30, (d) => C.outsideText(o, d.outside), txt, { align: 1 }),
        ], selector(X + 44, Y + 66, 34, 52), [
            gear(X, Y + 112, W, 130),
            C.text('speedDigits', X, Y + 262, W, 76, (d) => C.speedText(o, d), txt),
            C.text('speedDigitsUnit', X, Y + 344, W, 22, C.speedUnit(o), lbl, { tracking: 0.12 }),
            C.flat('rule', X + 30, Y + 384, W - 60, 2, 'cardEdge'),
            C.text('kwNow', X, Y + 400, W, 40, C.focus.power(o), C.engineFocus(o) ? txt : evTxt),
        ]);
    },
};
