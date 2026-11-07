'use strict';
/**
 * readings.js - every reading a page can show: its name on the app and on the cluster, its kind (the unit it
 * is converted to by the settings), its gauge range and when it is too hot / low. The custom pages' slots
 * pick from this list; the built-in pages use it too, so units and warnings are the same everywhere.
 */
const isNum = (v) => typeof v === 'number' && isFinite(v);

/* kinds: temp (°C), press (bar), speed (km/h), rpm, pct, kw, nm, deg, km, none; icon: shaders.js ICON_FS */
const READINGS = {
    oil: { title: 'Engine oil temperature', short: 'OIL', icon: 1, kind: 'temp', min: 40, max: 140, warnHigh: 130, cold: 60 },
    coolant: { title: 'Coolant temperature', short: 'COOLANT', icon: 0, kind: 'temp', min: 40, max: 130, warnHigh: 118, cold: 60 },
    iat: { title: 'Intake air temperature', short: 'INTAKE AIR', icon: 3, kind: 'temp', min: 0, max: 80, warnHigh: 60 },
    iatRise: { title: 'Intake air above outside', short: 'IAT RISE', icon: 3, kind: 'tempDelta', min: 0, max: 40, warnHigh: 25 },
    gearbox: { title: 'Gearbox oil temperature', short: 'GEARBOX', icon: 2, kind: 'temp', min: 40, max: 130, warnHigh: 115, cold: 50 },
    outside: { title: 'Outside temperature', short: 'OUTSIDE', icon: 12, kind: 'temp', min: -20, max: 45 },
    hpfp: { title: 'High pressure fuel', short: 'HPFP', icon: 4, kind: 'press', min: 0, max: 350, warnLow: 30 },
    lpfp: { title: 'Low pressure fuel', short: 'LPFP', icon: 4, kind: 'press', min: 0, max: 8, warnLow: 3.5 },
    boostActual: { title: 'Boost (actual)', short: 'BOOST', icon: 5, kind: 'press', min: 0, max: 2 },
    boostTarget: { title: 'Boost (target)', short: 'BOOST TARGET', icon: 5, kind: 'press', min: 0, max: 2 },
    timing: { title: 'Ignition timing', short: 'TIMING', icon: 13, kind: 'deg', min: -10, max: 40 },
    rpm: { title: 'Engine speed', short: 'RPM', icon: 13, kind: 'rpm', min: 0, max: 7000 },
    speed: { title: 'Speed', short: 'SPEED', icon: 13, kind: 'speed', min: 0, max: 250 },
    torque: { title: 'Engine torque', short: 'TORQUE', icon: 11, kind: 'nm', min: 0, max: 600 },
    splitRear: { title: 'xDrive: rear share', short: 'REAR', icon: 10, kind: 'pct', min: 0, max: 100 },
    splitFront: { title: 'xDrive: front share', short: 'FRONT', icon: 10, kind: 'pct', min: 0, max: 100 },
    gLat: { title: 'Lateral g', short: 'LAT G', icon: 8, kind: 'g', min: -1.2, max: 1.2 },
    gLong: { title: 'Longitudinal g', short: 'LONG G', icon: 8, kind: 'g', min: -1.2, max: 1.2 },
    soc: { title: 'Battery charge', short: 'CHARGE', icon: 6, kind: 'pct', min: 0, max: 100, warnLow: 10 },
    kw: { title: 'Battery power', short: 'POWER', icon: 7, kind: 'kw', min: -60, max: 100 },
    battTemp: { title: 'Battery temperature', short: 'BATTERY', icon: 6, kind: 'temp', min: 0, max: 50, warnHigh: 42, cold: 5 },
    erange: { title: 'Electric range', short: 'ELECTRIC', icon: 7, kind: 'km', min: 0, max: 60 },
    frange: { title: 'Fuel range', short: 'FUEL RANGE', icon: 4, kind: 'km', min: 0, max: 700, warnLow: 50 },
};

/** Units now: { temp: 'f' | 'c', press: 'bar' | 'psi' | 'kpa', speed: 'mph' | 'kmh' }. */
function convert(kind, v, u) {
    if (!isNum(v)) return v;
    if (kind === 'temp') return u.temp === 'f' ? v * 9 / 5 + 32 : v;
    if (kind === 'tempDelta') return u.temp === 'f' ? v * 9 / 5 : v;
    if (kind === 'press') return u.press === 'psi' ? v * 14.5038 : u.press === 'kpa' ? v * 100 : v;
    if (kind === 'speed' || kind === 'km') return u.speed === 'mph' ? v / 1.609344 : v;
    if (kind === 'nm') return u.torque === 'lbft' ? v * 0.737562 : v;
    return v;
}
function unitText(kind, u) {
    return { temp: '°' + (u.temp === 'f' ? 'F' : 'C'), tempDelta: '°' + (u.temp === 'f' ? 'F' : 'C'), press: u.press === 'psi' ? 'PSI' : u.press === 'kpa' ? 'KPA' : 'BAR',
        speed: u.speed === 'mph' ? 'mph' : 'km/h', km: u.speed === 'mph' ? 'mi' : 'km', rpm: 'rpm', pct: '%', kw: 'kW', nm: u.torque === 'lbft' ? 'lb-ft' : 'Nm', deg: '°', g: 'G' }[kind] || '';
}
/** Decimals for a kind in a unit. */
function decimals(kind, v, u) {
    if (kind === 'press') return u.press === 'bar' ? (Math.abs(v) < 10 ? 2 : 0) : u.press === 'psi' && Math.abs(v) < 30 ? 1 : 0;
    if (kind === 'g') return 2;
    if (kind === 'kw' || kind === 'deg') return Math.abs(v) < 10 ? 1 : 0;
    return 0;
}

/**
 * A reading's view now: { key, title, short, icon, value (converted, null none), text, unit, frac (0..1 on its
 * range), warnAt (0..1 where it turns too hot, 2 none), level: 'ok' | 'warn' | 'cold' | 'none' }. warn: thresholds set by the user ({ key: number } in °C /
 * bar), else the reading's own.
 */
function view(key, d, u, warn) {
    const r = READINGS[key];
    if (!r) return { key, title: key, short: key.toUpperCase(), icon: 13, value: null, text: '--', unit: '', frac: 0, warnAt: 2, level: 'none' };
    const raw = d[key], v = convert(r.kind, raw, u);
    const hi = warn && isNum(warn[key + 'High']) ? warn[key + 'High'] : r.warnHigh, lo = warn && isNum(warn[key + 'Low']) ? warn[key + 'Low'] : r.warnLow;
    const level = !isNum(raw) ? 'none' : isNum(hi) && raw >= hi ? 'warn' : isNum(lo) && raw <= lo ? 'warn' : isNum(r.cold) && raw < r.cold ? 'cold' : 'ok';
    const text = isNum(v) ? (r.kind === 'kw' && v > 0.05 ? '+' : '') + v.toFixed(decimals(r.kind, v, u)) : '--';
    const lo2 = convert(r.kind, r.min, u), hi2 = convert(r.kind, r.max, u);
    const warnAt = isNum(hi) ? Math.max(0, Math.min(2, (convert(r.kind, hi, u) - lo2) / (hi2 - lo2))) : 2;
    return { key, title: r.title, short: r.short, icon: r.icon || 0, value: isNum(v) ? v : null, text, unit: unitText(r.kind, u), frac: isNum(v) ? Math.max(0, Math.min(1, (v - lo2) / (hi2 - lo2))) : 0, warnAt, level };
}

module.exports = { READINGS, view, convert, unitText };
