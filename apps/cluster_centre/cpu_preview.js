'use strict';
/**
 * cpu_preview.js - draws a page's pieces on the head unit's own canvas (kit/canvas.js), for the app's
 * screen: the same pieces the cluster draws with its shaders, drawn here more simply (flat cards, plain
 * text, bars and arcs without glow, dots for icons, the trend lines flat), so a page can be checked before it
 * goes to the cluster.
 */
const { Canvas } = require('./kit/canvas');
const { rgb } = require('./themes');

const isNum = (v) => typeof v === 'number' && isFinite(v);
const hex = (c) => (Array.isArray(c) ? c[0] : c);
const alphaOf = (c) => (Array.isArray(c) && isNum(c[1]) ? c[1] : 1);
const withA = (h, a) => { const v = rgb(h); return [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255), Math.round(a * 255)]; };

/** The pieces drawn into a w x h canvas as they are now: returns the canvas. */
function drawPieces(pieces, t, d, w, h, group) {
    const cv = new Canvas(w, h).clear('#000000');
    pieces.forEach((s) => {
        if (s.group && s.group !== group) return;
        const c = s.colors ? s.colors(t, d) || {} : {};
        if (s.kind === 'bg') cv.gradientRect(s.x, s.y, s.w, s.h, [hex(c.top), hex(c.bottom)]);
        else if (s.kind === 'icon') cv.circle(s.x + s.w / 2, s.y + s.h / 2, s.w * 0.32, hex(c.color));
        else if (s.kind === 'leds') {
            const n = (s.params.u_count || [15])[0], v = s.value ? Number(s.value(d)) || 0 : 0, cell = s.w / n;
            for (let i = 0; i < n; i++) { const f = (i + 0.5) / n; cv.circle(s.x + (i + 0.5) * cell, s.y + s.h / 2, Math.min(cell * 0.32, s.h * 0.3), f <= v ? hex(f < 0.5 ? c.green : f < 0.8 ? c.yellow : c.red) : hex(c.off)); }
        } else if (s.kind === 'car') {
            cv.roundRect(s.x + s.w * 0.26, s.y + s.h * 0.04, s.w * 0.48, s.h * 0.92, s.w * 0.12, hex(c.body));
            [0.2, 0.8].forEach((f) => cv.fillRect(s.x + s.w * 0.2, s.y + s.h * f - 5, s.w * 0.6, 10, hex(c.accent)));
        } else if (s.kind === 'spark') {
            // the trend line itself lives on the cluster: a flat line here
            cv.fillRect(s.x, s.y + s.h * 0.6, s.w, 2, hex(c.line));
        } else if (s.kind === 'flat') cv.fillRect(s.x, s.y, s.w, s.h, withA(hex(c.color), alphaOf(c.color)));
        else if (s.kind === 'panel') {
            const r = (s.params && s.params.u_box && s.params.u_box[0]) || 0, bw = (s.params && s.params.u_box && s.params.u_box[1]) || 0;
            cv.card(s.x, s.y, s.w, s.h, r, [hex(c.top), hex(c.bottom)]);
            if (bw > 0) cv.strokeRoundRect(s.x, s.y, s.w, s.h, r, bw, hex(c.border));
        } else if (s.kind === 'text') {
            const txt = typeof s.text === 'function' ? String(s.text(d, t)) : String(s.text);
            const a = alphaOf(c.color);
            if (!txt || a <= 0) return;
            const size = s.h * 0.98, sp = (s.tracking || 0) * s.h;
            const tw = cv.textWidth(txt, size, { font: 'bold', literal: true, spacing: sp });
            const align = s.align === undefined ? 0.5 : s.align;
            cv.text(txt, s.x + (s.w - tw) * align, s.y + s.h * 0.86, size, withA(hex(c.color), a), { font: 'bold', literal: true, spacing: sp });
        } else if (s.kind === 'band') {
            const v = Math.max(0, Math.min(1, s.value ? Number(s.value(d)) || 0 : 0)), g = s.params.u_geo, sp = s.params.u_span;
            const red = s.params.u_red ? s.params.u_red[0] : 2;
            if (g[2] <= 0) {
                const x0 = s.x + g[0], len = s.w - 2 * g[0], th = g[3], y0 = s.y + g[1] - th / 2, n = sp[2] || 0;
                if (!n) {
                    // a smooth bar: the track, then the fill (from the right when u_span.x < 0)
                    cv.roundRect(x0, y0, len, th, th / 2, hex(c.track));
                    if (v > 0) cv.roundRect(sp[0] < 0 ? x0 + len * (1 - v) : x0, y0, Math.max(th, len * v), th, th / 2, hex(c.fill1));
                    return;
                }
                for (let i = 0; i < n; i++) {
                    const a = i / n, b = (i + 1) / n, gap = sp[2] ? (len / n) * sp[3] / 2 : 0;
                    const lit = (sp[0] < 0 ? 1 - b : a) < v;
                    cv.fillRect(x0 + a * len + gap, y0, (b - a) * len - 2 * gap, th, lit ? (a >= red ? hex(c.redc) : hex(c.fill1)) : hex(c.track));
                }
            } else {
                const cx = s.x + g[0], cy = s.y + g[1], R = g[2], T = g[3], a0 = sp[0], a1 = sp[1];
                cv.arc(cx, cy, R - T / 2, R + T / 2, Math.min(a0, a1), Math.max(a0, a1), hex(c.track));
                if (v > 0) { const am = a0 + (a1 - a0) * v; cv.arc(cx, cy, R - T / 2, R + T / 2, Math.min(a0, am), Math.max(a0, am), hex(c.fill1)); }
            }
        }
    });
    return cv;
}

module.exports = { drawPieces };
