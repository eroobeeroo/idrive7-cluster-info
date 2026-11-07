'use strict';
/**
 * themes.js - colour helpers. Each layout has its own palettes, one per look (comfort, sport, efficient:
 * layout_*.js palette(look)); the cluster gets the colours as uniforms, so a change sends a few numbers.
 */
/** '#rrggbb' -> [r, g, b] in 0..1. */
function rgb(hex) {
    const s = String(hex).replace('#', '');
    return [0, 2, 4].map((i) => Math.round(parseInt(s.slice(i, i + 2), 16) / 255 * 1000) / 1000);
}
const LOOKS = ['comfort', 'sport', 'efficient'];
/** The look now: the setting, or with Auto the selector's programme (S or M: sport). */
/** Auto colours: sport in a sport mode or with the selector in S / M, efficient in ECO PRO or driving on
 * electricity alone, comfort otherwise. */
function lookNow(setting, d) {
    if (LOOKS.indexOf(setting) >= 0) return setting;
    if (!d) return 'comfort';
    if (/SPORT|XTRABOOST/.test(d.driveMode || '') || d.mode === 'S' || d.mode === 'M') return 'sport';
    if (/ECO|ELECTRIC/.test(d.driveMode || '')) return 'efficient';
    return 'comfort';
}
module.exports = { rgb, LOOKS, lookNow };
