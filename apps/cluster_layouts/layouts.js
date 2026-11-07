'use strict';
/**
 * layouts.js - the layouts this app offers, by id. A layout is one file, layout_<id>.js, next to this one
 * (the build ships only top-level .js files); list it here and in app.json's "layout" setting (README.md).
 */
const LAYOUTS = [require('./layout_analog_sport'), require('./layout_digital_round'), require('./layout_modern_wide'), require('./layout_digital_dash'), require('./layout_freedom'), require('./layout_retro'), require('./layout_track')];
/* with Settings > Frame behind the gear box on: the bezel behind the KOMBI's gear bracket (layout_common.boxBezel),
 * just above the backgrounds. Off (the default, from the car: the frame read as a stray grey box) the box sits on
 * the layout's own black background and its black window disappears into it */
const { boxBezel, MAP } = require('./layout_common');
LAYOUTS.forEach((L) => {
    const own = L.pieces;
    L.pieces = (o) => {
        const list = (own(o) || []).slice();
        if (!o || o.boxBezel !== true) return list;
        let i = 0;
        while (i < list.length && /^bg/.test(list[i].key)) i++;
        const b = boxBezel();
        // with the map: from the map's right edge (the map's own picture runs under the bracket's left end)
        if (o && o.centre === 'map') { const r = b.x + b.w; b.x = MAP.x + MAP.w; b.w = r - b.x; }
        list.splice(i, 0, b);
        return list;
    };
});
const byId = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[0];
module.exports = { LAYOUTS, byId };
