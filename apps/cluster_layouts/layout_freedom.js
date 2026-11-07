'use strict';
/**
 * layout_freedom.js - "Freedom": an over-the-top American layout. The stars and stripes wave behind everything,
 * bald eagles fly across, fireworks go off in red, white and blue (all on the cluster's own clock: shaders.js
 * FLAG_FS, EAGLE_FS, FIREWORKS_FS), and the readings sit over it: a huge speed inside a red-white-blue tach arc,
 * the gear, the drive mode, a plaque of readings along the bottom and the power (or torque) right of the KOMBI's
 * gear bracket. Built around the glass and the KOMBI's boxes like every layout (tools/clearance.js). An original
 * design.
 */
const C = require('./layout_common');

const PALETTES = {
    // one flag for every look; the looks change the glow
    comfort: { glow: '#3c7bff', accent: '#3c7bff', mode: 'COMFORT' },
    sport: { glow: '#ff2a3c', accent: '#ff2a3c', mode: 'SPORT' },
    efficient: { glow: '#7fd4ff', accent: '#7fd4ff', mode: 'EFFICIENT' },
};
const BASE = {
    red: '#c8102e', white: '#ffffff', blue: '#0a3161', gold: '#d4af37', text: '#ffffff', dim: '#d7dce6', track: '#18213a',
    plaqueTop: '#0d1a33', plaqueBottom: '#060c1a', plaqueEdge: '#d4af37', ev: '#7fd4ff', num: '#ffffff', tip: '#ffffff',
    body: '#3b2716', head: '#fbfbf5', beak: '#f2b632', rim: '#f5d68a',
};
const pal = (lookId) => Object.assign({}, BASE, PALETTES[lookId] || PALETTES.comfort);

const big = (t) => ({ color: [t.white, 1], glow: [t.glow, 0.5] });
const txt = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.15] });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const goldTxt = (t) => ({ color: [t.gold, 1], glow: [t.red, 0.35] });

/* the decor: background pieces (keys start 'bg': under everything, outside the clearance rules) */
const flag = (key, x, y, w, h, dim) => ({ key, kind: 'flag', x, y, w, h, params: { u_dim: [dim] },
    colors: (t) => ({ red: t.red, white: t.white, blue: t.blue }) });
const eagles = (key, x, y, w, h) => ({ key, kind: 'eagles', x, y, w, h, colors: (t) => ({ body: t.body, head: t.head, beak: t.beak, rim: t.rim }) });
const fireworks = (key, x, y, w, h) => ({ key, kind: 'fireworks', x, y, w, h, colors: (t) => ({ red: '#ff3b4e', white: t.white, blue: '#4d8dff' }) });
const plaque = (key, x, y, w, h) => ({ key, kind: 'panel', x, y, w, h, params: { u_box: [18, 2, 0.6, 0.94] },
    colors: (t) => ({ top: t.plaqueTop, bottom: t.plaqueBottom, border: t.plaqueEdge }) });
/** The tach: red to blue along the arc, white tip. */
const tachColours = (t) => ({ track: t.track, fill0: t.blue === '#0a3161' ? '#2d5bd7' : t.blue, fill1: t.red === '#c8102e' ? '#ff2a3c' : t.red, redc: t.white, tip: t.tip, tick: t.dim, num: t.num });

module.exports = {
    id: 'freedom',
    title: 'Freedom',
    palette: pal,
    gearText: C.gearText,

    pieces(o) {
        const r = C.rpmScale(o), engine = C.engineFocus(o);
        const centre = o.centre || 'info';
        const gearC = (t, d) => ({ color: [C.gearText(d) === 'R' ? t.red : t.white, 1], glow: [C.gearText(d) === 'R' ? t.white : t.red, 0.6] });
        const powerTxt = (t, d) => (engine ? txt(t) : { color: [C.isNum(d.kw) && d.kw < -0.3 ? '#3ddc84' : t.ev, 1], glow: [t.ev, 0.2] });
        // right of the KOMBI's gear bracket: the power (or torque), the xDrive split
        const rightColumn = (y0) => [
            ...C.reading('power', 1676, y0, 214, 46, C.focus.power(o), C.focus.powerLabel(o, true), powerTxt, lbl),
            ...C.reading('split', 1676, y0 + 92, 214, 32, C.splitText, 'XDRIVE', txt, lbl),
        ];

        if (centre === 'map') {
            const top = C.MAP.y, bot = C.MAP.y + C.MAP.h;
            return [].concat(
                C.aroundMap().map((b, i) => flag('bgFlag' + i, b.x, b.y, b.w, b.h, 0.34)),
                [eagles('bgEagles', 0, 0, 1920, top), fireworks('bgFire', 1504, 0, 416, 262)],
                [
                    C.text('speedDigits', 30, 210, 370, 150, (d) => C.speedText(o, d), big),
                    C.text('speedUnit', 30, 364, 370, 26, C.speedUnit(o), lbl, { tracking: 0.1 }),
                    C.text('gear', 1520, 128, 230, 110, C.gearText, gearC),
                    C.text('mode', 30, 420, 370, 26, C.modeText, goldTxt, { tracking: 0.2 }),
                ],
                C.readingUp('fuel', 560, bot + 2, 240, 30, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl),
                C.readingUp('elec', 1100, bot + 2, 300, 30, C.focus.both(o), C.focus.rangeLabel(o), txt, lbl),
                rightColumn(470),
            );
        }
        if (centre === 'stock') {
            // the stock centre (x 566-1104) left alone: the flag either side of it
            return [].concat(
                [flag('bgFlagL', 0, 0, 566, 720, 0.36), flag('bgFlagR', 1104, 0, 816, 720, 0.36), eagles('bgEagles', 0, 140, 566, 200), fireworks('bgFire', 1104, 0, 816, 262)],
                [
                    C.text('speedDigits', 60, 220, 460, 170, (d) => C.speedText(o, d), big),
                    C.text('speedUnit', 60, 394, 460, 26, C.speedUnit(o), lbl, { tracking: 0.1 }),
                    C.text('mode', 60, 446, 460, 26, C.modeText, goldTxt, { tracking: 0.2 }),
                    C.text('gear', 1120, 280, 280, 150, C.gearText, gearC),
                ],
                C.reading('fuel', 80, 512, 200, 40, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl),
                C.reading('elec', 300, 512, 220, 40, C.focus.range(o), C.focus.rangeLabel(o), txt, lbl),
                rightColumn(470),
            );
        }

        // full screen
        const CXa = 960, CYa = 700, RA = 520;
        return [].concat(
            [
                flag('bgFlag', 0, 0, 1920, 720, 0.4),
                eagles('bgEagles', 0, 130, 1920, 300),
                fireworks('bgFireL', 0, 0, 640, 420),
                fireworks('bgFireR', 1180, 0, 740, 280),
            ],
            [
                // the tach: an arc over the speed, its numbers inside it
                {
                    key: 'rpmArc', kind: 'band', x: CXa - RA - 30, y: CYa - RA - 30, w: 2 * RA + 60, h: RA + 30,
                    params: { u_geo: [RA + 30, RA + 30, RA, 26], u_span: [-55, 55, 40, 0.28], u_marks: [r.max, 1, 22, -44], u_red: [r.red / r.max] },
                    colors: tachColours, value: (d) => (C.isNum(d.rpm) ? d.rpm / 1000 / r.max : 0), max: 1, sweep: true,
                },
                C.text('speedDigits', 690, 250, 540, 200, (d) => C.speedText(o, d), big),
                C.text('speedUnit', 690, 452, 540, 28, C.speedUnit(o), lbl, { tracking: 0.12 }),
                C.text('banner', 1230, 150, 470, 40, 'FREEDOM', goldTxt, { align: 1, tracking: 0.3 }),
                C.text('mode', 1230, 196, 470, 24, C.modeText, txt, { align: 1, tracking: 0.2 }),
                C.text('gear', 150, 190, 300, 160, C.gearText, gearC),
                C.text('clock', 150, 364, 140, 36, C.clock, txt, { align: 0 }),
                C.text('outside', 300, 364, 150, 36, (d) => C.outsideText(o, d.outside), txt, { align: 1 }),
                plaque('plaque', 110, 486, 1280, 150),
            ],
            C.reading('oil', 140, 508, 220, 50, (d) => C.tempText(o, d.oil), 'OIL', txt, lbl),
            C.reading('coolant', 390, 508, 220, 50, (d) => C.tempText(o, d.coolant), 'COOLANT', txt, lbl),
            C.reading('fuel', 640, 508, 230, 50, (d) => C.distText(o, d.frange), 'FUEL RANGE', txt, lbl),
            C.reading('elec', 890, 508, 240, 50, C.focus.range(o), C.focus.rangeLabel(o), txt, lbl),
            C.reading('soc', 1150, 508, 220, 50, C.focus.charge(o), C.focus.chargeLabel(o), txt, lbl),
            rightColumn(472),
        );
    },
};
