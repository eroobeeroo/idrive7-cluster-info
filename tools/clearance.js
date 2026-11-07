'use strict';
/**
 * clearance.js - what a layout's pieces must keep clear of on the glass (see the test in test_engine.js), and a
 * report of every clash: node tools/clearance.js
 */
require('./scene');
const path = require('path');
const C0 = require(path.join(__dirname, '..', 'apps', 'cluster_layouts', 'layout_common'));
function clashes(p) {
    const C = C0, out = [];
    const isBg = /^bg|^boxBezel$/.test(p.key) || (p.kind === 'flat' && /bg/.test(String(p.colour || p.key)));
    if (isBg) return out;
    // a band along an arc (u_geo: centre in the layer, radius, thickness): the points of its ink, every 3 degrees
    const g = p.kind === 'band' && p.params && p.params.u_geo, sp = p.params && p.params.u_span;
    if (g && g[2] > 0 && sp) {
        const pts = [];
        const a0 = Math.min(sp[0], sp[1]), a1 = Math.max(sp[0], sp[1]);
        for (let a = a0; a <= a1; a += 3) for (const rr of [g[2] - g[3] / 2, g[2] + g[3] / 2]) {
            const t = a * Math.PI / 180; pts.push([p.x + g[0] + rr * Math.sin(t), p.y + g[1] - rr * Math.cos(t)]);
        }
        const inB = (b) => pts.some(([x, y]) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h);
        if (inB(C.NOTCH)) out.push('under the cowl');
        if (inB(C.GEARBOX_HOLE)) out.push('in the gear box');
        if (inB(C.EDRIVE_HOLE)) out.push('under the eDrive box');
        if (inB(C.TELLTALES)) out.push('over the warning lights');
        if (pts.some(([x, y]) => C.inCorner(x, y))) out.push('in a corner');
        return out;
    }
    const round = p.kind === 'dial';
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, r = Math.min(p.w, p.h) / 2;
    const hit = (b) => (round
        ? (() => { const nx = Math.max(b.x, Math.min(cx, b.x + b.w)), ny = Math.max(b.y, Math.min(cy, b.y + b.h)); return (nx - cx) ** 2 + (ny - cy) ** 2 < (r - 6) ** 2; })()
        : p.x < b.x + b.w && p.x + p.w > b.x && p.y < b.y + b.h && p.y + p.h > b.y);
    if (hit(C.NOTCH)) out.push('under the cowl');
    if (hit(C.GEARBOX_HOLE)) out.push('in the gear box');
    if (hit(C.EDRIVE_HOLE)) out.push('under the eDrive box');
    if (hit(C.TELLTALES)) out.push('over the warning lights');
    const pts = round ? [[cx - r * 0.7, cy - r * 0.7], [cx + r * 0.7, cy - r * 0.7], [cx, cy - r]] : [[p.x, p.y], [p.x + p.w, p.y]];
    if (pts.some(([x, y]) => C.inCorner(x, y))) out.push('in a corner');
    return out;
}
module.exports = { clashes };

if (require.main === module) {
    const { LAYOUTS } = require(path.join(__dirname, '..', 'apps', 'cluster_layouts', 'layouts'));
    let n = 0;
    LAYOUTS.forEach((L) => ['info', 'map', 'stock'].forEach((centre) => ['phev', 'ice'].forEach((vehicle) => {
        L.pieces({ speedUnit: 'mph', tempUnit: 'f', centre, redline: 7000, rpmMax: 8000, vehicle }).forEach((p) => {
            const c = clashes(p);
            if (c.length) { n++; console.log(L.id + ' ' + centre + ' ' + vehicle + ': ' + p.key + ' (' + p.kind + ' ' + [p.x, p.y, p.w, p.h].map(Math.round).join(',') + ') ' + c.join(', ')); }
        });
    })));
    console.log(n ? n + ' clashes' : 'all clear');
}
