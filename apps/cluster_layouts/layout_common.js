'use strict';
/**
 * layout_common.js - what the layouts share: units, the gear's text, temperature scales and piece makers
 * (see engine.js for what a piece is).
 */
const KMH_PER_MPH = 1.609344;
const isNum = (v) => typeof v === 'number' && isFinite(v);

const speedIn = (o, kmh) => (o.speedUnit === 'kmh' ? kmh : kmh / KMH_PER_MPH);
const speedUnit = (o) => (o.speedUnit === 'kmh' ? 'km/h' : 'mph');
const tempIn = (o, c) => (o.tempUnit === 'c' ? c : c * 9 / 5 + 32);
const tempText = (o, c) => (isNum(c) ? Math.round(tempIn(o, c)) + '°' : '--');
const speedText = (o, d) => (isNum(d.speed) ? String(Math.round(speedIn(o, d.speed))) : '--');

/** The speed scale for the unit: { max, major, minor }. */
const speedScale = (o) => (o.speedUnit === 'kmh' ? { max: 260, major: 20, minor: 10 } : { max: 160, major: 20, minor: 5 });
/** Engine speed in thousands: the scale's end (5-10) and the red zone's start. */
function rpmScale(o) {
    const max = Math.max(5, Math.min(10, Math.round((o.rpmMax || 8000) / 1000)));
    return { max, major: 1, minor: 0.25, red: Math.max(2, Math.min(max, (o.redline || 7000) / 1000)) };
}
/** A temperature (°C) on a 40-140 °C scale, 0..1. */
const tempFrac = (c) => (isNum(c) ? Math.max(0, Math.min(1, (c - 40) / 100)) : 0);

/** The gear: P R N, or D / S / M (the selector's programme) with the gear number. */
function gearText(d) {
    if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
    if (d.gear === -1) return 'R';
    const g = isNum(d.gear) && d.gear > 0 ? String(d.gear) : '';
    const mode = d.mode === 'S' || d.mode === 'M' ? d.mode : 'D';
    return d.stage === 'D' || g || d.mode ? mode + g : '-';
}
/** The selector letter lit in a P R N D row. */
function selectorLit(d) {
    const g = gearText(d);
    return g === '-' ? '' : g === 'P' || g === 'R' || g === 'N' ? g : 'D';
}
/** The drive mode line: the mode as the car names it (data.js FES_MODES), else S / M from the selector, else the
 * colours' name. */
const modeText = (d, t) => {
    if (d && d.driveMode) return d.driveMode;
    if (d && (d.mode === 'S' || d.mode === 'M')) return d.mode === 'M' ? 'MANUAL' : 'SPORT';
    return t.mode;
};
/* the local time (clock.js: the unit's apps run on UTC; the Time zone setting says where the car is) */
const clock = () => require('./clock').hm();

/* ---------- the map window and the extra readings ---------- */

/** Where waze-on-cluster's map (and the stock map) shows on the panel: the native map area (slot 0x100). With
 * the centre set to 'map', a layout leaves this clear and puts nothing over it. */
const MAP = { x: 416, y: 120, w: 1088, h: 480 };
/** Background rectangles round the map window (top, bottom, left, right). */
const aroundMap = () => [
    { x: 0, y: 0, w: 1920, h: MAP.y }, { x: 0, y: MAP.y + MAP.h, w: 1920, h: 720 - MAP.y - MAP.h },
    { x: 0, y: MAP.y, w: MAP.x, h: MAP.h }, { x: MAP.x + MAP.w, y: MAP.y, w: 1920 - MAP.x - MAP.w, h: MAP.h },
];
/** True when a rectangle overlaps the map window. */
const overMap = (r) => r.x < MAP.x + MAP.w && r.x + r.w > MAP.x && r.y < MAP.y + MAP.h && r.y + r.h > MAP.y;

/*
 * What the cluster's glass shows of the panel (from photos of a G05; the same on every car with this cluster):
 * the top corners are cut on a slant, the camera's cowl covers the top middle, the stock warning lights and
 * the gear's letter sit along the bottom, and while a layout is up the KOMBI leaves a dark box where the stock
 * gear readout was (right of centre). Layouts keep their readings out of these.
 */
const NOTCH = { x: 730, y: 0, w: 460, h: 128 };
/* the KOMBI's own bracket where its gear readout was (measured from a photo of the car: a thick grey bar on
 * top with a slanted left end, a thick bar on the right, a thin line at the bottom, black inside, at about
 * x 1490-1652, y 271-442), with a margin; drawn over us, so kept clear and dressed by boxBezel() */
const GEARBOX_HOLE = { x: 1410, y: 262, w: 252, h: 192 };
/* the bracket's grey (#1e1d21, from the photo against a tile of known colour) */
const BRACKET = '#1e1d21';
/** A bezel in the bracket's own grey behind it, a little larger: its bars merge into it and its black window
 * reads as a recessed screen, not a stray shape. */
const boxBezel = () => ({ key: 'boxBezel', kind: 'panel', x: 1476, y: 258, w: 190, h: 198, params: { u_box: [12, 1.5, 0, 1] },
    colors: () => ({ top: '#232227', bottom: BRACKET, border: '#2e2d33' }) });
/* a second, smaller one at the top right, where the stock eDrive readout sits on a plug-in hybrid */
const EDRIVE_HOLE = { x: 1770, y: 170, w: 150, h: 95 };
/*
 * Settings > Cluster: M car. An M car's KOMBI leaves two more dark boxes in the middle of the panel while a
 * layout is up (its own readouts' places in its M display), measured from one photo of a car showing Digital dash:
 * the photo's perspective fitted to the six tiles' corners (fit within 2 px of the photo, about 4 px here), then
 * the boxes' corners read back. The second box's right and bottom edges were at the tile's edges in the photo,
 * so it may reach further; the holes keep a margin round each (and more to the right and below the second).
 */
const M_BOXES = [{ x: 793, y: 289, w: 246, h: 92 }, { x: 1223, y: 328, w: 171, h: 78 }];
const M_HOLES = [{ x: 778, y: 274, w: 276, h: 122 }, { x: 1208, y: 313, w: 207, h: 113 }];
/** True for an M car (Settings > Cluster). */
const mCar = (o) => !!o && o.cluster === 'm';
/** The KOMBI's dark boxes a layout keeps its readings out of, for this car: the gear box, and an M car's two. */
const holes = (o) => [GEARBOX_HOLE, EDRIVE_HOLE].concat(mCar(o) ? M_HOLES : []);
/* the stock warning lights and the fallback gear letter along the bottom middle */
const TELLTALES = { x: 560, y: 652, w: 960, h: 68 };
/** Rectangles covering r but not hole: r itself when they don't meet, else up to four around the hole (the
 * background drawn around the KOMBI's dark box, so nothing of ours sits under it). */
function cut(r, hole) {
    const hx = Math.max(r.x, hole.x), hy = Math.max(r.y, hole.y), hx2 = Math.min(r.x + r.w, hole.x + hole.w), hy2 = Math.min(r.y + r.h, hole.y + hole.h);
    if (hx >= hx2 || hy >= hy2) return [r];
    return [
        { x: r.x, y: r.y, w: r.w, h: hy - r.y },                       // above
        { x: r.x, y: hy2, w: r.w, h: r.y + r.h - hy2 },                // below
        { x: r.x, y: hy, w: hx - r.x, h: hy2 - hy },                   // left
        { x: hx2, y: hy, w: r.x + r.w - hx2, h: hy2 - hy },            // right
    ].filter((q) => q.w > 0 && q.h > 0);
}
/** True when a point is inside the glass's slanted top corners (hidden). */
const inCorner = (x, y) => y < 217 - 0.55 * Math.min(x, 1920 - x);

/** A distance in km as the speed unit wants it: '312 MI', '502 KM', or '--'. */
const distText = (o, km) => (isNum(km) ? Math.round(o.speedUnit === 'kmh' ? km : km / KMH_PER_MPH) + (o.speedUnit === 'kmh' ? ' km' : ' mi') : '--');
/** The electric range: '~31 MI' when it is the estimate from the charge (data.js), else as distText. */
const erangeText = (o, d) => (isNum(d.erange) && d.erangeEst ? '~' : '') + distText(o, d.erange);
/** The xDrive split: 'F 38   R 62', 'FRONT 140 NM' (the transfer case's front torque, data.js), or 'XDRIVE --'. */
const splitText = (d) => (isNum(d.splitRear) ? 'F ' + Math.round(100 - d.splitRear) + '   R ' + Math.round(d.splitRear)
    : isNum(d.splitFrontNm) ? 'FRONT ' + d.splitFrontNm + ' Nm' : 'XDRIVE --');
/*
 * Settings > Vehicle: a plug-in hybrid (o.vehicle 'phev', the eDrive readings) or a petrol or diesel car
 * ('ice'). With ICE the layouts trade their eDrive readings for the engine's: battery power -> engine torque, charge -> ignition timing, electric range -> boost, the charge bar
 * -> boost against its target. Each helper takes o and gives the reading for the choice.
 */
const engineFocus = (o) => !!o && (o.vehicle === 'ice' || o.focus === 'engine');
const boostIn = (o, bar0) => (o.speedUnit === 'kmh' ? bar0 : bar0 * 14.5038);
const boostText = (o, d) => (d.engineOn === false ? 'OFF' : isNum(d.boostActual)
    ? (o.speedUnit === 'kmh' ? boostIn(o, d.boostActual).toFixed(2) + ' bar' : boostIn(o, d.boostActual).toFixed(1) + ' psi') : '--');
const torqueText = (d) => (isNum(d.torque) ? Math.round(d.torque) + ' Nm' : '--');
const timingText = (d) => (isNum(d.timing) ? d.timing.toFixed(1) + '°' : '--');
/** Boost (bar over atmosphere) 0..1.6 as 0..1. */
const boostFrac = (d) => (d.engineOn === false || !isNum(d.boostActual) ? 0 : Math.max(0, Math.min(1, d.boostActual / 1.6)));
const focus = {
    power: (o) => (engineFocus(o) ? torqueText : kwText),
    powerLabel: (o, long) => (engineFocus(o) ? (long ? 'ENGINE TORQUE' : 'TORQUE') : (long ? 'BATTERY POWER' : 'POWER')),
    /** 0..1 for the power bar: torque to 450 Nm, or none (the eDrive layouts draw their own centre-zero bar) */
    torqueFrac: (d) => (isNum(d.torque) ? Math.max(0, Math.min(1, d.torque / 450)) : 0),
    charge: (o) => (engineFocus(o) ? timingText : socText),
    chargeLabel: (o) => (engineFocus(o) ? 'TIMING' : 'CHARGE'),
    range: (o) => (engineFocus(o) ? (d) => boostText(o, d) : (d) => erangeText(o, d)),
    rangeLabel: (o) => (engineFocus(o) ? 'BOOST' : 'ELECTRIC'),
    /** the electric range and charge on one line, or the boost and timing */
    both: (o) => (engineFocus(o) ? (d) => boostText(o, d) + '  ' + timingText(d) : (d) => erangeText(o, d) + '  ' + socText(d)),
    bar: (o) => (engineFocus(o) ? boostFrac : (d) => (isNum(d.soc) ? d.soc / 100 : 0)),
    /** what the engine readings need read from the engine unit */
    needs: (o) => (engineFocus(o) ? ['boostActual', 'boostTarget', 'timing', 'hpfp'] : []),
};
/** Outside temperature with its unit letter: '48°F'. */
const outsideText = (o, c) => (isNum(c) ? Math.round(tempIn(o, c)) + '°' + (o.tempUnit === 'c' ? 'C' : 'F') : '--');
const socText = (d) => (isNum(d.soc) ? Math.round(d.soc) + '%' : '--');
const kwText = (d) => (isNum(d.kw) ? (d.kw > 0.05 ? '+' : '') + (Math.abs(d.kw) < 10 ? d.kw.toFixed(1) : Math.round(d.kw)) + ' kW' : '--');

/** A reading with its label under it: two text pieces. */
function reading(key, x, y, w, h, value, label, colors, labelColors) {
    return [
        text(key, x, y, w, h, value, colors),
        text(key + 'Lbl', x, y + h + Math.round(h * 0.14), w, Math.max(18, Math.round(h * 0.4)), label, labelColors, { tracking: 0.12 }),
    ];
}
/** A reading with its label above it (where the row must end above the warning lights): label 16 px, then the
 * value h high. */
function readingUp(key, x, y, w, h, value, label, colors, labelColors) {
    return [
        text(key + 'Lbl', x, y, w, 16, label, labelColors, { tracking: 0.1 }),
        text(key, x, y + 18, w, h, value, colors),
    ];
}
/** A straight bar (band shader in bar mode): value(d) 0..1. */
function bar(key, x, y, w, h, value, colors, segments) {
    return { key, kind: 'band', x, y, w, h, params: { u_geo: [4, h / 2, 0, Math.max(4, h - 8)], u_span: [0, 0, segments || 0, 0.25], u_marks: [0, 0, 0, 0], u_red: [2] },
        colors, value, max: 1, sweep: true };
}

/** A text piece. */
const text = (key, x, y, w, h, txt, colors, extra) => Object.assign({ key, kind: 'text', x, y, w, h, text: txt, colors, align: 0.5 }, extra || {});
/** A flat rectangle. */
const flat = (key, x, y, w, h, colour) => ({ key, kind: 'flat', x, y, w, h, colors: (t, d) => ({ color: [typeof colour === 'function' ? colour(t, d) : t[colour], 1] }) });

module.exports = {
    isNum, speedIn, speedUnit, tempIn, tempText, speedText, speedScale, rpmScale, tempFrac, gearText, selectorLit, clock, modeText, text, flat,
    MAP, aroundMap, overMap, cut, NOTCH, GEARBOX_HOLE, boxBezel, EDRIVE_HOLE, M_BOXES, M_HOLES, mCar, holes, TELLTALES, inCorner, distText, erangeText, splitText, outsideText, socText, kwText, reading, readingUp, bar, engineFocus, focus, boostText, torqueText, timingText, boostFrac,
};
