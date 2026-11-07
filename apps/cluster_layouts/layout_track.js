'use strict';
/**
 * layout_track.js - "Track": a motorsport data display. A row of shift lights (green, yellow, red, all flashing
 * at the shift point) over a segmented rpm bar, a huge gear in the middle with the engine speed, tiles for oil,
 * coolant, boost and power (or torque) either side of it, the speed large on the left with a 0-60 timer (it
 * times every run from a stop, keeps the best of the drive) and the drive's peak power (or boost), and the
 * ranges and charge right of the KOMBI's box. An original design.
 */
const C = require('./layout_common');

const PALETTES = {
    comfort: { accent: '#ffb000', glow: '#ffb000', mode: 'COMFORT' },
    sport: { accent: '#ff3326', glow: '#ff3326', mode: 'SPORT' },
    efficient: { accent: '#35e08a', glow: '#35e08a', mode: 'EFFICIENT' },
};
const BASE = {
    bg: '#000000', text: '#ffffff', dim: '#9aa3ad', track: '#1a1d22', red: '#ff2a1f', ev: '#4ab4ff', regen: '#3ddc84',
    tileTop: '#13161a', tileBottom: '#08090b', tileEdge: '#2a2f36', off: '#16191d', green: '#2fe06b', yellow: '#ffc400', num: '#ffffff', tip: '#ffffff',
};
const pal = (lookId) => Object.assign({}, BASE, PALETTES[lookId] || PALETTES.comfort);

const white = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.12] });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const acc = (t) => ({ color: [t.accent, 1], glow: [t.glow, 0.35] });

/* ---------- the drive's numbers: the 0-60 timer and the peaks ---------- */
const run = { armed: false, t0: 0, last: null, best: null, peakKw: null, peakBoost: null, at: 0 };
/** Fed by the texts that show it (each update): starts on leaving a stop, stops at 60 mph (100 km/h). */
function track(o, d) {
    const now = Date.now();
    if (now - run.at < 10) return;
    run.at = now;
    if (C.isNum(d.kw) && d.kw > 0 && (run.peakKw === null || d.kw > run.peakKw)) run.peakKw = d.kw;
    if (d.engineOn !== false && C.isNum(d.boostActual) && (run.peakBoost === null || d.boostActual > run.peakBoost)) run.peakBoost = d.boostActual;
    if (!C.isNum(d.speed) || d.demo) return;
    const target = o.speedUnit === 'kmh' ? 100 : 96.56;
    if (d.speed < 1) { run.armed = true; run.t0 = 0; return; }
    if (run.armed && !run.t0) run.t0 = now;
    if (!run.t0) return;
    if (d.speed >= target) {
        const s = (now - run.t0) / 1000;
        run.last = s;
        if (run.best === null || s < run.best) run.best = s;
        run.t0 = 0; run.armed = false;
    } else if (now - run.t0 > 30000) { run.t0 = 0; run.armed = false; }
}
const zeroText = (o) => (d) => { track(o, d); return run.t0 ? ((Date.now() - run.t0) / 1000).toFixed(1) + ' s' : run.last !== null ? run.last.toFixed(1) + ' s' : '--'; };
const bestText = (o) => (d) => { track(o, d); return run.best !== null ? 'BEST ' + run.best.toFixed(1) + ' s' : 'FROM A STOP'; };
const zeroLabel = (o) => (o.speedUnit === 'kmh' ? '0-100 KM/H' : '0-60 MPH');
const peakText = (o) => (d) => {
    track(o, d);
    if (C.engineFocus(o)) return run.peakBoost === null ? '--' : o.speedUnit === 'kmh' ? run.peakBoost.toFixed(2) + ' bar' : (run.peakBoost * 14.5038).toFixed(1) + ' psi';
    return run.peakKw === null ? '--' : Math.round(run.peakKw) + ' kW';
};

/* ---------- pieces ---------- */
/** A tile: its card, the label at the top, the value under it. */
function tile(key, x, y, w, h, label, value, colours, valueH) {
    const vh = valueH || Math.round((h - 40) * 0.92);
    return [
        { key: key + 'Card', kind: 'panel', x, y, w, h, params: { u_box: [10, 2, 0.3, 1] }, colors: (t) => ({ top: t.tileTop, bottom: t.tileBottom, border: t.tileEdge }) },
        C.text(key + 'Lbl', x + 14, y + 10, w - 28, 18, label, lbl, { align: 0, tracking: 0.12 }),
        C.text(key, x + 14, y + 34, w - 28, vh, value, colours || white, { align: 0 }),
    ];
}
/** The shift lights: from 2500 rpm under the red line, all flashing red 300 rpm before it. */
function shiftLights(o, x, y, w, h, count) {
    const red = C.rpmScale(o).red * 1000, from = red - 2500, at = red - 300;
    return {
        key: 'shift', kind: 'leds', x, y, w, h, max: 1,
        value: (d) => (C.isNum(d.rpm) ? Math.max(0, Math.min(1, (d.rpm - from) / (at - from))) : 0),
        params: { u_count: [count], u_soft: [0], u_shape: [0] },
        dyn: (d) => ({ u_flash: [C.isNum(d.rpm) && d.rpm >= at ? 1 : 0] }),
        colors: (t) => ({ off: t.off, green: t.green, yellow: t.yellow, red: t.red }),
    };
}
/** The segmented rpm bar, red from the red line. */
function rpmBar(o, x, y, w, h) {
    const r = C.rpmScale(o);
    return { key: 'rpmBar', kind: 'band', x, y, w, h,
        params: { u_geo: [4, h / 2, 0, Math.max(4, h - 6)], u_span: [0, 0, 48, 0.3], u_marks: [0, 0, 0, 0], u_red: [r.red / r.max], u_soft: [1] },
        colors: (t) => ({ track: t.track, fill0: t.text, fill1: t.accent, redc: t.red, tip: t.accent, tick: t.dim, num: t.num }),
        value: (d) => (C.isNum(d.rpm) ? d.rpm / 1000 / r.max : 0), max: 1, sweep: true };
}
const rpmText = (d) => (C.isNum(d.rpm) && d.engineOn !== false ? String(Math.round(d.rpm / 50) * 50) : 'OFF');
const gearC = (t, d) => ({ color: [C.gearText(d) === 'R' ? t.red : t.text, 1], glow: [t.glow, 0.25] });
const powerC = (o) => (t, d) => (C.engineFocus(o) ? white(t) : { color: [C.isNum(d.kw) && d.kw < -0.3 ? t.regen : t.ev, 1], glow: [t.ev, 0.15] });
/* the tiles' numbers alone (their units in the labels: a unit beside a big number didn't fit a tile) */
const boostNum = (o) => (d) => {
    if (C.engineFocus(o)) return C.timingText(d);
    if (d.engineOn === false) return 'OFF';
    if (!C.isNum(d.boostActual)) return '--';
    return o.speedUnit === 'kmh' ? d.boostActual.toFixed(2) : (d.boostActual * 14.5038).toFixed(1);
};
const powerNum = (o) => (d) => {
    if (C.engineFocus(o)) return C.isNum(d.torque) ? String(Math.round(d.torque)) : '--';
    return C.isNum(d.kw) ? (Math.abs(d.kw) < 10 ? d.kw.toFixed(1) : String(Math.round(d.kw))) : '--';
};

module.exports = {
    id: 'track',
    title: 'Track',
    palette: pal,
    gearText: C.gearText,

    pieces(o) {
        const engine = C.engineFocus(o);
        const boostLbl = engine ? 'TIMING' : o.speedUnit === 'kmh' ? 'BOOST BAR' : 'BOOST PSI', powerLbl = engine ? 'TORQUE NM' : 'POWER KW';
        const right = () => [
            ...C.reading('fuel', 1672, 292, 216, 44, (d) => C.distText(o, d.frange), 'FUEL RANGE', white, lbl),
            ...C.reading('elec', 1672, 400, 216, 44, C.focus.range(o), C.focus.rangeLabel(o), engine ? white : (t) => ({ color: [t.ev, 1], glow: [t.ev, 0.2] }), lbl),
            C.text('socTxt', 1672, 506, 216, 44, C.focus.charge(o), white),
            C.bar('soc', 1680, 562, 200, 16, C.focus.bar(o), (t) => ({ track: t.track, fill0: engine ? t.accent : t.ev, fill1: engine ? t.accent : t.ev, redc: t.red, tip: t.text, tick: t.dim, num: t.num }), 16),
        ];

        if (o.centre === 'map') {
            // the shift lights in the strip under the map; the gear, speed and timer left of it; the readings right
            const bot = C.MAP.y + C.MAP.h;
            return C.aroundMap().map((r, i) => C.flat('bg' + i, r.x, r.y, r.w, r.h, 'bg')).concat(
                [shiftLights(o, 600, bot + 8, 720, 38, 15)],
                [
                    C.text('gear', 60, 200, 330, 170, C.gearText, gearC),
                    C.text('rpm', 60, 372, 330, 30, (d) => rpmText(d) + (C.isNum(d.rpm) && d.engineOn !== false ? ' RPM' : ''), acc),
                    C.text('speedDigits', 60, 420, 230, 80, (d) => C.speedText(o, d), white, { align: 1 }),
                    C.text('speedUnit', 300, 462, 90, 30, C.speedUnit(o), lbl, { align: 0 }),
                ],
                tile('zero', 60, 516, 330, 80, zeroLabel(o), zeroText(o), acc),
                C.readingUp('fuel', 1530, bot - 30, 150, 26, (d) => C.distText(o, d.frange), 'FUEL', white, lbl),
                [C.text('clock', 1700, 300, 200, 34, C.clock, white), C.text('outside', 1700, 344, 200, 30, (d) => C.outsideText(o, d.outside), lbl)],
                C.reading('power', 1690, 420, 210, 44, C.focus.power(o), C.focus.powerLabel(o, false), powerC(o), lbl),
                C.reading('elec', 1690, 510, 210, 36, C.focus.range(o), C.focus.rangeLabel(o), white, lbl),
            );
        }
        if (o.centre === 'stock') {
            // the stock centre (x 566-1104) left alone: the speed side left of it, the tiles between it and the box
            return [C.flat('bg', 0, 0, 566, 720, 'bg'), C.flat('bgR', 1104, 0, 816, 720, 'bg'), shiftLights(o, 150, 160, 400, 36, 10)].concat(
                [
                    C.text('gear', 60, 214, 260, 200, C.gearText, gearC),
                    C.text('rpm', 60, 418, 260, 32, (d) => rpmText(d), acc),
                    C.text('speedDigits', 330, 240, 210, 110, (d) => C.speedText(o, d), white),
                    C.text('speedUnit', 330, 356, 210, 26, C.speedUnit(o), lbl),
                ],
                tile('zero', 60, 480, 230, 120, zeroLabel(o), zeroText(o), acc),
                tile('peak', 310, 480, 230, 120, engine ? 'PEAK BOOST' : 'PEAK POWER', peakText(o)),
                tile('oil', 1120, 200, 136, 110, 'OIL', (d) => C.tempText(o, d.oil)),
                tile('coolant', 1268, 200, 136, 110, 'COOLANT', (d) => C.tempText(o, d.coolant)),
                tile('boost', 1120, 470, 136, 110, boostLbl, boostNum(o)),
                tile('power', 1268, 470, 136, 110, powerLbl, powerNum(o), powerC(o)),
                right(),
            );
        }

        // full screen
        const X0 = 580, X1 = 1340, GX = 760, GW = 400;
        return [C.flat('bg', 0, 0, 1920, 720, 'bg'), shiftLights(o, X0, 136, X1 - X0, 40, 15), rpmBar(o, X0, 188, X1 - X0, 26)].concat(
            [
                { key: 'gearCard', kind: 'panel', x: GX, y: 262, w: GW, h: 290, params: { u_box: [14, 2, 0.4, 1] }, colors: (t) => ({ top: t.tileTop, bottom: t.tileBottom, border: t.accent }) },
                C.text('gear', GX, 272, GW, 200, C.gearText, gearC),
                C.text('rpm', GX, 478, GW, 40, rpmText, acc),
                C.text('rpmLbl', GX, 522, GW, 18, 'RPM', lbl, { tracking: 0.2 }),
                C.text('mode', X0, 576, X1 - X0, 26, C.modeText, acc, { tracking: 0.25 }),
                // the speed, large, on the left
                C.text('speedDigits', 60, 196, 460, 170, (d) => C.speedText(o, d), white),
                C.text('speedUnit', 60, 370, 460, 28, C.speedUnit(o), lbl, { tracking: 0.12 }),
                C.text('clock', 70, 640, 200, 30, C.clock, white, { align: 0 }),
                C.text('outside', 310, 640, 200, 30, (d) => C.outsideText(o, d.outside), lbl, { align: 1 }),
            ],
            tile('zero', 60, 420, 220, 200, zeroLabel(o), zeroText(o), acc, 96),
            [C.text('zeroBest', 74, 576, 192, 24, bestText(o), lbl, { align: 0, tracking: 0.06 })],
            tile('peak', 300, 420, 220, 200, engine ? 'PEAK BOOST' : 'PEAK POWER', peakText(o), white, 96),
            [C.text('peakLbl2', 314, 576, 192, 24, 'THIS DRIVE', lbl, { align: 0, tracking: 0.06 })],
            tile('oil', X0, 262, 164, 135, 'OIL', (d) => C.tempText(o, d.oil)),
            tile('coolant', X0, 417, 164, 135, 'COOLANT', (d) => C.tempText(o, d.coolant)),
            tile('boost', 1176, 262, 164, 135, boostLbl, boostNum(o)),
            tile('power', 1176, 417, 164, 135, powerLbl, powerNum(o), powerC(o)),
            right(),
        );
    },
};
