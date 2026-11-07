'use strict';
/**
 * clock.js - the local time. The unit's apps run on UTC (no time zone is set for them), so the zone comes from
 * the Time zone setting: a standard offset and the daylight-saving rule of its region, worked out here (no
 * time-zone database needed).
 *   us: from the second Sunday of March 2:00 to the first Sunday of November 2:00, local time
 *   eu: from the last Sunday of March 1:00 UTC to the last Sunday of October 1:00 UTC
 */
const ZONES = {
    eastern: { off: -5, dst: 'us' }, central: { off: -6, dst: 'us' }, mountain: { off: -7, dst: 'us' },
    arizona: { off: -7, dst: null }, pacific: { off: -8, dst: 'us' }, alaska: { off: -9, dst: 'us' }, hawaii: { off: -10, dst: null },
    atlantic: { off: -4, dst: 'us' }, utc: { off: 0, dst: null }, uk: { off: 0, dst: 'eu' }, cet: { off: 1, dst: 'eu' }, eet: { off: 2, dst: 'eu' },
};
let zone = ZONES.eastern;

/** The day of month of the n-th (1..) or last (n = -1) Sunday of a month (0-based), in UTC. */
function sunday(y, m, n) {
    if (n > 0) { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; }
    const lastDay = new Date(Date.UTC(y, m + 1, 0)), d = lastDay.getUTCDate();
    return d - lastDay.getUTCDay();
}
/** True when daylight saving is in force at ms (UTC) for z. */
function inDst(z, ms) {
    if (!z.dst) return false;
    const y = new Date(ms).getUTCFullYear();
    if (z.dst === 'eu') return ms >= Date.UTC(y, 2, sunday(y, 2, -1), 1) && ms < Date.UTC(y, 9, sunday(y, 9, -1), 1);
    // us: 2:00 local standard time on, 2:00 local daylight time off
    const on = Date.UTC(y, 2, sunday(y, 2, 2), 2) - z.off * 3600000, off = Date.UTC(y, 10, sunday(y, 10, 1), 2) - (z.off + 1) * 3600000;
    return ms >= on && ms < off;
}
/** Sets the zone by its setting id ('eastern', 'cet', ...; 'utc+5.5' an offset with no daylight saving). */
function setZone(id) {
    const m = /^utc([+-]\d+(?:\.\d+)?)$/.exec(String(id || ''));
    zone = m ? { off: Number(m[1]), dst: null } : ZONES[id] || ZONES.eastern;
}
/** The local time as { h, m } (ms: a UTC time, default now). */
function local(ms) {
    const t = ms === undefined ? Date.now() : ms;
    const d = new Date(t + (zone.off + (inDst(zone, t) ? 1 : 0)) * 3600000);
    return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
let twelve = true;
/** 12-hour (true, the default) or 24-hour clock. */
function setTwelve(on) { twelve = on !== false; }
/** '7:05' (12-hour, no AM/PM: there's no room for it) or '19:05' (24-hour). */
function hm(ms) {
    const t = local(ms), mm = ('0' + t.m).slice(-2);
    return (twelve ? (t.h % 12) || 12 : t.h) + ':' + mm;
}

module.exports = { ZONES, setZone, setTwelve, local, hm, inDst };
