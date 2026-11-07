'use strict';
/**
 * layout_digital_dash.js - "Digital dash": no dials at all, as much as the car tells, all digits and bars.
 *
 *   top:     the engine speed as a long segmented bar (red from the redline), the rpm and the drive mode
 *   left:    road speed, large; battery power (charging to the left, drawing to the right) and where the
 *            power goes (driving, climate, seats)
 *   right:   the gear, large; the battery's charge with the electric and fuel ranges
 *   middle:  six tiles - oil, coolant, gearbox oil, intake air, the battery's temperature, boost - each with an
 *            icon, its value, a trend line of the last two minutes and a bar that turns red where it is too hot
 *   bottom:  the time, outside, the xDrive split, the engine on or off
 *
 * With the map in the centre the tiles give way to it: oil, coolant, gearbox and battery temperature move to
 * a strip under the map. With the centre left to the stock cluster, nothing goes between x 820 and 1100.
 * Colours follow the drive mode like the other layouts. An original design.
 */
const C = require('./layout_common');

/*
 * OEM-style contrast: figures pure white with only a trace of glow (sharp edges at a glance), secondary text a
 * light grey-tint well above WCAG AA on black (~9:1), colour kept for accents (mode, bars, icons), cards lifted
 * from the background with a visible edge. Amber warns, red is the limit.
 */
const PALETTES = {
    comfort: {
        bgTop: '#0b111a', bgBottom: '#020305', card: '#141e2a', cardB: '#0b121b', edge: '#2c3d51', track: '#1d2835',
        fill0: '#2a7fd0', fill1: '#62c6ff', tip: '#c6ecff', red: '#ff453a', text: '#ffffff', glow: '#4aa8ff', dim: '#aebdcc',
        ev: '#5cbcff', regen: '#3ddc84', warm: '#ffb340', mode: 'COMFORT',
    },
    sport: {
        bgTop: '#140a0a', bgBottom: '#040202', card: '#221414', cardB: '#140b0b', edge: '#4a2a28', track: '#2c1a1a',
        fill0: '#b3261e', fill1: '#ff5a40', tip: '#ffc4b8', red: '#ffffff', text: '#ffffff', glow: '#ff4a3a', dim: '#d4b4ae',
        ev: '#5cbcff', regen: '#3ddc84', warm: '#ffb340', mode: 'SPORT',
    },
    efficient: {
        bgTop: '#07130f', bgBottom: '#010403', card: '#10211d', cardB: '#091512', edge: '#21493f', track: '#142a24',
        fill0: '#16956f', fill1: '#41f0bd', tip: '#c2ffec', red: '#ff453a', text: '#ffffff', glow: '#2fd8a6', dim: '#a6c9bf',
        ev: '#2fd8a6', regen: '#7dff9a', warm: '#ffb340', mode: 'EFFICIENT',
    },
};

const isNum = C.isNum;
const big = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.22] });
const txt = (t) => ({ color: [t.text, 1], glow: [t.glow, 0.05] });
const lbl = (t) => ({ color: [t.dim, 1], glow: [t.glow, 0] });
const evTxt = (t) => ({ color: [t.ev, 1], glow: [t.ev, 0.12] });
/* a piece of the background: its gradient is the screen's (top to bottom over 720 px), so pieces meet unseen */
const lerpHex = (a, b, f) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.substr(i, 2), 16) * (1 - f) + parseInt(b.substr(i, 2), 16) * f).toString(16).padStart(2, '0')).join('');
const bg = (key, x, y, w, h) => ({ key, kind: 'panel', x, y, w, h, params: { u_box: [0, 0, 0, 1] },
    colors: (t) => ({ top: lerpHex(t.bgTop, t.bgBottom, y / 720), bottom: lerpHex(t.bgTop, t.bgBottom, (y + h) / 720), border: t.bgBottom }) });
const card = (key, x, y, w, h) => ({ key, kind: 'panel', x, y, w, h, params: { u_box: [14, 1.5, 0.75, 1] }, colors: (t) => ({ top: t.card, bottom: t.cardB, border: t.edge }) });
const icon = (key, x, y, size, id, colour) => ({ key, kind: 'icon', x, y, w: size, h: size, params: { u_icon: [id], u_line: [0] }, colors: (t, d) => ({ color: [typeof colour === 'function' ? colour(t, d) : t[colour], 1] }) });
/* labels at 20 px: read at a glance while driving */
const label = (key, x, y, w, s, extra) => C.text(key, x, y, w, 20, s, lbl, Object.assign({ align: 0, tracking: 0.08 }, extra || {}));
const spark = (key, x, y, w, h, sample, colour) => ({ key, kind: 'spark', x, y, w, h, sample, every: 2000,
    colors: (t, d) => { const c = typeof colour === 'function' ? colour(t, d) : t[colour]; return { line: c, fill: c }; } });
/** A straight bar: value(d) 0..1, mark(d) 0..1 where it turns red (none: 2), fromRight. */
function bar(key, x, y, w, h, value, colours, opts) {
    const o = opts || {};
    return { key, kind: 'band', x, y, w, h, params: { u_geo: [Math.max(6, h / 2), h / 2, 0, Math.max(4, h * 0.5)], u_span: [o.fromRight ? -1 : 0, 0, o.segments || 0, 0.25], u_marks: [0, 0, 0, 0], u_soft: [0] },
        dyn: o.mark ? (d) => ({ u_red: [o.mark(d)] }) : () => ({ u_red: [2] }), colors: colours, value, max: 1, sweep: true };
}
const barC = (k) => (t) => ({ track: t.track, fill0: t[k], fill1: t[k], redc: t.red, tip: t.tip, tick: t.dim, num: t.dim });
const fillC = (t) => ({ track: t.track, fill0: t.fill0, fill1: t.fill1, redc: t.red, tip: t.tip, tick: t.dim, num: t.dim });

/* ---------- the readings ---------- */
const frac = (v, lo, hi) => (isNum(v) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : null);
const boostIn = (o, bar0) => (o.speedUnit === 'kmh' ? bar0 : bar0 * 14.5038);
/** id: { title, icon, value(d), text(o, d), unit(o), lo, hi (base units), hot (base units, or null) } */
const READ = {
    oil: { title: 'OIL', icon: 1, value: (d) => d.oil, lo: 40, hi: 150, hot: 130 },
    coolant: { title: 'COOLANT', icon: 0, value: (d) => d.coolant, lo: 40, hi: 130, hot: 118 },
    gearbox: { title: 'GEARBOX', icon: 2, value: (d) => d.gearbox, lo: 20, hi: 140, hot: 120 },
    iat: { title: 'INTAKE AIR', icon: 3, value: (d) => d.iat, lo: 0, hi: 80, hot: 60 },
    batt: { title: 'BATTERY', icon: 6, value: (d) => d.battTemp, lo: 0, hi: 60, hot: 45 },
    boost: { title: 'BOOST', icon: 5, value: (d) => (d.engineOn === false ? null : d.boostActual), lo: -0.6, hi: 1.6, hot: null, boost: true },
    // the high-pressure fuel rail (bar; psi with miles), for Show: Engine
    rail: { title: 'FUEL RAIL', icon: 5, value: (d) => (d.engineOn === false ? null : d.hpfp), lo: 0, hi: 350, hot: null, rail: true },
};
function readText(o, r, d) {
    const v = r.value(d);
    if ((r.boost || r.rail) && d.engineOn === false) return 'OFF';
    if (!isNum(v)) return '--';
    if (r.boost) { const b = boostIn(o, v); return o.speedUnit === 'kmh' ? b.toFixed(2) : b.toFixed(1); }
    if (r.rail) return String(Math.round(o.speedUnit === 'kmh' ? v : v * 14.5038));
    return String(Math.round(C.tempIn(o, v)));
}
const readUnit = (o, r) => (r.boost || r.rail ? (o.speedUnit === 'kmh' ? 'BAR' : 'PSI') : o.tempUnit === 'c' ? '°C' : '°F');
const hot = (r, d) => r.hot !== null && isNum(r.value(d)) && r.value(d) >= r.hot;

/** A tile: card, icon and title, unit, value, trend line and bar with its red mark. */
function tile(o, id, x, y, w, h) {
    const r = READ[id], k = 't_' + id;
    const accent = (t, d) => (hot(r, d) ? t.warm : t.glow);
    return [
        card(k + 'C', x, y, w, h),
        icon(k + 'I', x + 14, y + 12, 26, r.icon, accent),
        label(k + 'L', x + 48, y + 15, w - 62, r.title + '  ' + readUnit(o, r)),
        C.text(k + 'V', x + 16, y + 44, w - 32, 84, (d) => readText(o, r, d), (t, d) => ({ color: [hot(r, d) ? t.warm : t.text, 1], glow: [accent(t, d), 0.08] }), { align: 0, chars: 6 }),
        spark(k + 'S', x + 10, y + 134, w - 20, h - 174, (d) => frac(r.value(d), r.lo, r.hi), (t, d) => accent(t, d)),
        bar(k + 'B', x + 10, y + h - 30, w - 20, 16, (d) => frac(r.value(d), r.lo, r.hi) || 0, (t, d) => fillC(t, d),
            { mark: (d) => (r.hot === null ? 2 : (r.hot - r.lo) / (r.hi - r.lo)) }),
    ];
}
/** A compact reading for the strips: icon, value with its unit, title under it. */
function compact(o, id, x, y, w, up) {
    const r = READ[id], k = 'c_' + id;
    const val = (d) => { const s = readText(o, r, d); return s === '--' ? s : s + (r.boost ? '' : '°'); };
    const col = (t, d) => ({ color: [hot(r, d) ? t.warm : t.text, 1], glow: [t.glow, 0.05] });
    // up: the label above the value (a row that must end above the warning lights)
    if (up) {
        return [
            icon(k + 'I', x, y + 24, 22, r.icon, (t, d) => (hot(r, d) ? t.warm : t.glow)),
            C.text(k + 'L', x + 30, y, w - 30, 16, r.title, lbl, { align: 0, tracking: 0.08 }),
            C.text(k + 'V', x + 30, y + 18, w - 30, 32, val, col, { align: 0, chars: 6 }),
        ];
    }
    return [
        icon(k + 'I', x, y + 8, 22, r.icon, (t, d) => (hot(r, d) ? t.warm : t.glow)),
        C.text(k + 'V', x + 30, y - 4, w - 30, 46, val, col, { align: 0, chars: 6 }),
        label(k + 'L', x + 30, y + 46, w - 30, r.title),
    ];
}

const kw = (d) => (isNum(d.kw) ? d.kw : 0);
const pct = (v) => (isNum(v) ? Math.round(v) + '%' : '--');

module.exports = {
    id: 'digital_dash',
    title: 'Digital dash',
    palette: (lookId) => PALETTES[lookId] || PALETTES.comfort,
    gearText: C.gearText,
    /* the engine unit's readings it shows: read fast while it is up */
    needs: ['iat', 'boostActual', 'gearbox', 'splitRear'],   // (and C.focus.needs with Show: Engine)

    pieces(o) {
        const r = C.rpmScale(o), s = C.speedScale(o);
        const centre = o.centre || 'info', map = centre === 'map', stock = centre === 'stock';
        const engine = C.engineFocus(o);   // Show: Engine (the eDrive readings traded for the engine's)
        const gearC = (t, d) => ({ color: [C.gearText(d) === 'R' ? '#ff453a' : t.text, 1], glow: [t.glow, 0.2] });
        // the engine's state where its speed is read: 'ENGINE OFF' instead of '0 RPM' on electric
        const rpmTxt = (d) => (d.engineOn === false ? 'ENGINE OFF' : isNum(d.rpm) ? Math.round(d.rpm / 50) * 50 + ' RPM' : '-- RPM');
        const modeT = (key, x, y, w, h, tr) => C.text(key, x, y, w, h || 26, C.modeText, (t) => ({ color: [t.glow, 1], glow: [t.glow, 0.15] }), { align: 1, tracking: tr === undefined ? 0.24 : tr });
        /* what the glass shows (layout_common.js): nothing under the camera's cowl (top middle, to y 128) or in
         * the slanted top corners, nothing in the dark box the KOMBI leaves right of centre (x 1410-1630,
         * y 280-425), and the bottom edge left to the warning lights. At most 60 pieces: one layer each. */
        const list = [];
        // the background around the KOMBI's dark box, never under it (o.boxClear, on unless set off)
        const rects = map ? C.aroundMap() : stock ? [{ x: 0, y: 0, w: 820, h: 720 }, { x: 1100, y: 0, w: 820, h: 720 }] : [{ x: 0, y: 0, w: 1920, h: 720 }];
        [].concat(...rects.map((b) => (o.boxClear !== true ? [b] : C.cut(b, C.GEARBOX_HOLE)))).forEach((b, i) => list.push(bg('bg' + i, b.x, b.y, b.w, b.h)));

        /* the engine speed: a bar under the cowl (left of the stock centre; in the left column with the map) */
        const rpmBar = (x, y, w) => bar('rpmBar', x, y, w, 26, (d) => (isNum(d.rpm) ? Math.min(1, d.rpm / 1000 / r.max) : 0), fillC, { segments: Math.round(w / 26), mark: () => r.red / r.max });
        if (map) list.push(rpmBar(60, 540, 340), C.text('rpmTxt', 60, 572, 300, 24, rpmTxt, lbl, { align: 0, tracking: 0.1 }), modeT('mode', 1505, 140, 260, 22, 0.06));
        else if (stock) list.push(rpmBar(200, 138, 600), C.text('rpmTxt', 200, 170, 320, 24, rpmTxt, lbl, { align: 0, tracking: 0.1 }), modeT('mode', 1220, 170, 500));
        else list.push(rpmBar(200, 138, 1520), C.text('rpmTxt', 200, 170, 320, 24, rpmTxt, lbl, { align: 0, tracking: 0.1 }), modeT('mode', 1220, 170, 500));

        /* left: speed and battery power */
        list.push(
            C.text('speedDigits', 50, 196, 360, 170, (d) => C.speedText(o, d), big, { chars: 4 }),
            C.text('speedUnit', 60, 368, 340, 24, C.speedUnit(o), lbl, { tracking: 0.2 }),
            label('kwL', 70, 424, 320, C.focus.powerLabel(o, true)),
            C.text('kw', 66, 446, 340, 72, engine ? C.torqueText : (d) => (isNum(d.kw) ? (d.kw > 0.05 ? '+' : '') + (Math.abs(d.kw) < 10 ? d.kw.toFixed(1) : Math.round(d.kw)) + ' kW' : '--'),
                engine ? txt : (t, d) => ({ color: [kw(d) < -0.3 ? t.regen : t.text, 1], glow: [kw(d) < -0.3 ? t.regen : t.ev, 0.3] }), { align: 0, chars: 9 }),
            // one bar for both ways: drawing (to 100 kW) in blue, charging and regenerating (to 60 kW) in green
            engine ? bar('power', 70, 526, 320, 12, C.focus.torqueFrac, barC('fill1'))
                : bar('power', 70, 526, 320, 12, (d) => Math.min(1, Math.abs(kw(d)) / (kw(d) < 0 ? 60 : 100)), (t, d) => barC(kw(d) < -0.3 ? 'regen' : 'ev')(t)),
        );

        /* right: the gear above the dark box, charge and ranges below it */
        const RX = 1520, RW = 350;
        list.push(
            // the gear beside the dark box the KOMBI leaves (left of it) and below its eDrive readout (top right)
            C.text('gear', 1670, 286, 200, 130, C.gearText, gearC, { align: 1, chars: 3 }),   // right edge on the column below
            // the charge and electric range, or (Show: Engine) the ignition timing and the boost with its bar
            label('socL', RX, 460, 170, C.focus.chargeLabel(o)),
            C.text('soc', RX, 478, 150, 58, engine ? C.timingText : (d) => pct(d.soc), engine ? txt : evTxt, { align: 0, chars: 5 }),
            label('erangeL', RX + 180, 460, 170, C.focus.rangeLabel(o), { align: 1 }),
            C.text('erange', RX + 110, 478, 240, 58, C.focus.range(o), engine ? txt : evTxt, { align: 1, chars: 8 }),
            bar('socBar', RX, 540, RW, 12, C.focus.bar(o), barC(engine ? 'fill1' : 'ev'), { segments: 20 }),
            label('fuelL', RX, 566, 100, 'FUEL'),
            C.text('frange', RX + 90, 556, RW - 90, 52, (d) => C.distText(o, d.frange), txt, { align: 1, chars: 7 }),
            // the tank's fill, red in its last eighth
            bar('fuelBar', RX, 612, RW, 10, (d) => (isNum(d.fuelPct) ? d.fuelPct / 100 : 0), (t, d) => barC(isNum(d.fuelPct) && d.fuelPct < 12.5 ? 'red' : 'fill1')(t), { segments: 8 }),
        );

        /* the middle: six tiles; with the map, a strip under it; with the stock centre, two columns beside it */
        if (!map && !stock) {
            const X = 430, Y = 200, Wd = 960, Ht = 440, gap = 16, cw = (Wd - 2 * gap) / 3, ch = (Ht - gap) / 2;
            ['oil', 'coolant', 'gearbox', 'iat', engine ? 'rail' : 'batt', 'boost'].forEach((id, i) => list.push(...tile(o, id, Math.round(X + (i % 3) * (cw + gap)), Math.round(Y + Math.floor(i / 3) * (ch + gap)), Math.round(cw), Math.round(ch))));
        } else if (map) {
            ['oil', 'coolant', 'gearbox', engine ? 'boost' : 'batt'].forEach((id, i) => list.push(...compact(o, id, 450 + i * 260, 602, 230, true)));
        } else {
            ['oil', 'coolant', 'gearbox'].forEach((id, i) => list.push(...compact(o, id, 450, 214 + i * 110, 340)));
            ['iat', engine ? 'rail' : 'batt', 'boost'].forEach((id, i) => list.push(...compact(o, id, 1120, 214 + i * 110, 280)));
        }

        /* the bottom of the side columns: time, outside, the xDrive split (clear of the warning lights) */
        list.push(
            C.text('clock', 60, map ? 606 : 552, 170, 44, C.clock, txt, { align: 0, chars: 5 }),
            C.text('outside', 240, map ? 606 : 552, 160, 44, (d) => C.outsideText(o, d.outside), txt, { align: 0, chars: 6 }),
            label('splitL', RX, 634, 100, 'XDRIVE'),
            C.text('split', RX + 100, 628, RW - 100, 32, C.splitText, txt, { align: 1, chars: 12 }),
        );
        return list;
    },
};
