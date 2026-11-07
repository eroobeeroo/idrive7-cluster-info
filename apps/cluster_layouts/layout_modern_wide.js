'use strict';
/**
 * layout_modern_wide.js - "Modern wide": no round dials. Two long segmented arcs frame the cluster like
 * brackets (road speed rising on the left, engine speed on the right), the speed and the gear stand large
 * inside them, and the centre holds the time, outside temperature and drive mode, the fuel and electric
 * ranges with the battery's charge and power, and oil and coolant. With the map in the centre the arcs stay
 * at the edges and the readings move to strips above and below the map. Its colours follow the drive mode.
 * An original design.
 */
const C = require('./layout_common');

/* the arcs: short enough that their ends and numerals clear the glass's slanted top corners */
const R = 520, T = 28, CY = 380;
const LCX = 720, RCX = 1200;
const L_LAYER = { x: 100, y: 80, w: 420, h: 600 };
const R_LAYER = { x: 1400, y: 80, w: 420, h: 600 };

const PALETTES = {
    comfort: {
        bgTop: '#0b1018', bgBottom: '#020305', track: '#121a24', fill0: '#1d5f9e', fill1: '#5cc8ff', tip: '#a8e4ff',
        red: '#ff3b30', tick: '#3b4c5e', num: '#9fb3c8', text: '#f2f7ff', glow: '#3fa6ff', dim: '#a6b0ba', rule: '#1c2a3a', ev: '#4ab4ff',
        mode: 'COMFORT',
    },
    sport: {
        bgTop: '#140909', bgBottom: '#040202', track: '#241414', fill0: '#8a1a14', fill1: '#ff4a30', tip: '#ffb0a0',
        red: '#ffffff', tick: '#5e3b3b', num: '#d8a8a0', text: '#ffffff', glow: '#ff3b2f', dim: '#bca8a4', rule: '#3a1c1c', ev: '#4ab4ff',
        mode: 'SPORT',
    },
    efficient: {
        bgTop: '#06120f', bgBottom: '#010403', track: '#0f201c', fill0: '#127a5e', fill1: '#3cf0b8', tip: '#b0ffe6',
        red: '#ff3b30', tick: '#2f5048', num: '#9cc8bc', text: '#effffb', glow: '#22d3a0', dim: '#9eb6b0', rule: '#163a32', ev: '#22d3a0',
        mode: 'EFFICIENT',
    },
};
const bandColours = (t) => ({ track: t.track, fill0: t.fill0, fill1: t.fill1, redc: t.red, tip: t.tip, tick: t.tick, num: t.num });
const big = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.45] });
const txt = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.15] });
const evTxt = (t) => ({ color: [t.ev, 1], glow: [t.ev, 0.3] });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const bg = (key, x, y, w, h) => ({ key, kind: 'panel', x, y, w, h, params: { u_box: [0, 0, 0, 1] }, colors: (t) => ({ top: t.bgTop, bottom: t.bgBottom, border: t.bgBottom }) });

module.exports = {
    id: 'modern_wide',
    title: 'Modern wide',
    palette: (lookId) => PALETTES[lookId] || PALETTES.comfort,
    gearText: C.gearText,

    pieces(o) {
        const s = C.speedScale(o), r = C.rpmScale(o);
        const arcs = [
            {
                // road speed: up the left, the circle's centre to the right of the layer
                key: 'speedArc', kind: 'band', x: L_LAYER.x, y: L_LAYER.y, w: L_LAYER.w, h: L_LAYER.h,
                params: { u_geo: [LCX - L_LAYER.x, CY - L_LAYER.y, R, T], u_span: [-118, -62, 44, 0.3], u_marks: [s.max / s.major, s.major, 22, 44], u_red: [2] },
                colors: bandColours, value: (d) => (C.isNum(d.speed) ? C.speedIn(o, d.speed) / s.max : 0), max: 1, sweep: true,
            },
            {
                // engine speed: up the right
                key: 'rpmArc', kind: 'band', x: R_LAYER.x, y: R_LAYER.y, w: R_LAYER.w, h: R_LAYER.h,
                params: { u_geo: [RCX - R_LAYER.x, CY - R_LAYER.y, R, T], u_span: [118, 62, 44, 0.3], u_marks: [r.max, 1, 22, 44], u_red: [r.red / r.max] },
                colors: bandColours, value: (d) => (C.isNum(d.rpm) ? d.rpm / 1000 / r.max : 0), max: 1, sweep: true,
            },
        ];
        const gearC = (t, d) => ({ color: [C.gearText(d) === 'R' ? '#ff3b30' : t.text, 1], glow: [t.glow, 0.45] });
        const rpmTxt = (d) => (C.isNum(d.rpm) ? Math.round(d.rpm / 50) * 50 + ' RPM' : '-- RPM');
        const hotC = (k, lim) => (t, d) => ({ color: [C.isNum(d[k]) && d[k] >= lim ? '#ff3b30' : t.text, 1], glow: [t.glow, 0] });
        if (o.centre === 'map') {
            // the arcs bulge out to x ~200 / ~1720; the speed and gear sit between them and the map
            const top = C.MAP.y, bot = C.MAP.y + C.MAP.h;
            return C.aroundMap().map((b, i) => bg('bg' + i, b.x, b.y, b.w, b.h)).concat(arcs, [
                // (the gear above the dark box the KOMBI leaves right of centre, its rpm and mode below it)
                C.text('speedDigits', 228, 160, 186, 110, (d) => C.speedText(o, d), big),
                C.text('speedUnit', 228, 280, 186, 20, C.speedUnit(o), lbl, { tracking: 0.2 }),
                C.text('clock', 228, 440, 186, 30, C.clock, txt),
                C.text('outside', 228, 480, 186, 30, (d) => C.outsideText(o, d.outside), txt),
                C.text('gear', 1506, 158, 186, 100, C.gearText, gearC),
                C.text('rpmDigits', 1506, 460, 186, 20, rpmTxt, lbl, { tracking: 0.1 }),
                C.text('mode', 1506, 482, 186, 18, C.modeText, (t) => ({ color: [t.glow, 1], glow: [t.glow, 0.6] }), { tracking: 0.25 }),
            ],
            C.readingUp('fuel', 440, bot + 2, 220, 30, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl),
            C.readingUp('elec', 670, bot + 2, 220, 30, C.focus.both(o), C.focus.rangeLabel(o), C.engineFocus(o) ? txt : evTxt, lbl),
            C.readingUp('oil', 900, bot + 2, 160, 30, (d) => C.tempText(o, d.oil), 'OIL', hotC('oil', 130), lbl),
            C.readingUp('coolant', 1070, bot + 2, 160, 30, (d) => C.tempText(o, d.coolant), 'COOLANT', hotC('coolant', 118), lbl));
        }
        const list = [bg('bg', 0, 0, 1920, 720)].concat(arcs, [
            // the gear stays left of the dark box the KOMBI leaves where its own gear readout was
            C.text('speedDigits', 470, 270, 300, 140, (d) => C.speedText(o, d), big),
            C.text('speedUnit', 470, 420, 300, 22, C.speedUnit(o), lbl, { tracking: 0.2 }),
            C.text('gear', 1150, 270, 260, 140, C.gearText, gearC),
            C.text('rpmDigits', 1150, 420, 260, 22, rpmTxt, lbl, { tracking: 0.12 }),
        ]);
        if (o.centre === 'stock') {
            list[0] = bg('bg', 0, 0, 760, 720);
            list.splice(1, 0, bg('bgR', 1160, 0, 760, 720));
            return list;
        }
        return list.concat([
            // below the camera's cowl, which covers the top middle
            C.text('clock', 790, 140, 170, 38, C.clock, txt),
            C.text('outside', 960, 140, 170, 38, (d) => C.outsideText(o, d.outside), txt),
            C.text('mode', 780, 190, 360, 18, C.modeText, (t) => ({ color: [t.glow, 1], glow: [t.glow, 0.6] }), { tracking: 0.3 }),
            C.flat('rule1', 860, 222, 200, 2, 'rule'),
        ],
        C.reading('fuel', 780, 240, 180, 44, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl),
        C.reading('elec', 960, 240, 180, 44, C.focus.range(o), C.focus.rangeLabel(o), C.engineFocus(o) ? txt : evTxt, lbl),
        [C.bar('soc', 800, 340, 320, 22, C.focus.bar(o), (t) => ({ track: t.track, fill0: C.engineFocus(o) ? t.fill1 || t.accent : t.ev, fill1: C.engineFocus(o) ? t.fill1 || t.accent : t.ev, redc: t.red, tip: t.tip, tick: t.dim, num: t.num }), 24)],
        C.reading('soc', 800, 376, 160, 36, C.focus.charge(o), C.focus.chargeLabel(o), C.engineFocus(o) ? txt : evTxt, lbl),
        C.reading('kw', 960, 376, 160, 36, C.focus.power(o), C.focus.powerLabel(o), txt, lbl),
        [C.flat('rule2', 800, 474, 320, 2, 'rule')],
        C.reading('oil', 790, 494, 160, 44, (d) => C.tempText(o, d.oil), 'OIL', hotC('oil', 130), lbl),
        C.reading('coolant', 970, 494, 160, 44, (d) => C.tempText(o, d.coolant), 'COOLANT', hotC('coolant', 118), lbl));
    },
};
