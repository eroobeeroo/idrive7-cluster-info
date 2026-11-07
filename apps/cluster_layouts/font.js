'use strict';
/**
 * font.js - the glyph atlas the cluster's shaders read: one row of cells, one glyph each, as a signed
 * distance field in one byte a pixel (0.5 at the outline, more inside). A distance field scales cleanly,
 * so one small atlas draws a 40 px numeral and a 200 px gear alike. It is the only picture a layout sends
 * to the cluster, once (CELL_W x CELL_H a glyph, 32 to a row: about 200 KB).
 *
 * Baked from Barlow Semi Condensed (SIL OFL 1.1: NOTICE) by tools/bake_font.py into font_<family>.wad and font_baked.js,
 * with upper and lower case. Without those files it is made at start from the kit's own font as before (drawn
 * large, then a Euclidean distance transform), upper case only.
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require('./kit/canvas');

/* the baked atlases (font_bold / font_light), when present */
const BAKED = {};
let bakedMeta = {};
try { bakedMeta = require('./font_baked'); } catch (e) { /* not baked */ }
['bold', 'light'].forEach((f) => {
    try {
        const meta = bakedMeta[f];
        const px = fs.readFileSync(path.join(__dirname, 'font_' + f + '.wad'));
        if (px.length === meta.cellW * meta.cols * meta.cellH * meta.rows) BAKED[f] = { meta, px };
    } catch (e) { /* not baked: the kit's font */ }
});
const KIT_CHARS = '0123456789-°PRNDSMOILCATEHKXFUGBVYWQJZ/ .:%+,\'!|()';
const CHARS = BAKED.bold ? BAKED.bold.meta.chars : KIT_CHARS;
const CELL_W = BAKED.bold ? BAKED.bold.meta.cellW : 48, CELL_H = 64;     // a cell, in atlas pixels
const UP = 4;                       // drawn at 4x, then reduced
const COLS = 32;                    // cells a row
const SPREAD = 8;                   // the distance shown, in atlas pixels each side of the outline
const SIZE = CELL_H * 0.98;          // the font size a glyph is drawn at, in atlas pixels
/* digits and their signs from the kit's numeric face, letters from its bold one (the numeric face has none) */
/* the kit's faces for digits and signs, and for letters, per family: 'bold' (strong numerals, bold capitals) or
 * 'light' (thin numerals, regular capitals) */
const FAMILIES = { bold: { digits: 'num', letters: 'bold' }, light: { digits: 'light', letters: 'label' } };
const fontOf = (ch, fam) => { const f = FAMILIES[fam] || FAMILIES.bold; return /[0-9\-°.:\/ %+,]/.test(ch) && !(fam === 'light' && /[,]/.test(ch)) ? f.digits : f.letters; };

/** Squared distance transform of one line (Felzenszwalb & Huttenlocher). f: 0 on a feature, big off it. */
function edt1(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
/** Squared distance from each pixel to the nearest pixel where inside(i) is true, w x h. */
function edt(w, h, inside) {
    const INF = 1e20, g = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = inside(i) ? 0 : INF;
    const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = g[y * w + x];
        edt1(f, h, d, v, z);
        for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = g[y * w + x];
        edt1(f, w, d, v, z);
        for (let x = 0; x < w; x++) g[y * w + x] = d[x];
    }
    return g;
}

/** One glyph's cell as a distance field: CELL_W x CELL_H bytes. */
function cell(ch, fam) {
    const W = CELL_W * UP, H = CELL_H * UP;
    const cv = new Canvas(W, H);
    // the glyph's body fills the cell's height: cap height ~0.72 of the font size, baseline near the bottom
    cv.text(ch, W / 2, H * 0.86, SIZE * UP, '#ffffff', { font: fontOf(ch, fam), align: 'center', literal: true });
    const a = cv.d, n = W * H, ins = (i) => a[i * 4 + 3] >= 128;
    const toIn = edt(W, H, ins), toOut = edt(W, H, (i) => !ins(i));
    const out = Buffer.alloc(CELL_W * CELL_H);
    for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
            const i = (y * UP + UP / 2) * W + x * UP + UP / 2;
            // signed distance in atlas pixels: + inside, - outside
            const sd = (ins(i) ? Math.sqrt(toOut[i]) - 0.5 : -(Math.sqrt(toIn[i]) - 0.5)) / UP;
            out[y * CELL_W + x] = Math.max(0, Math.min(255, Math.round((0.5 + sd / (2 * SPREAD)) * 255)));
        }
    }
    void n;
    return out;
}

const built = {};
/** The atlas of a family ('bold' default, 'light'): { w, h, px (Buffer, one byte a pixel), cells, cols, rows, aspect, code(ch), adv }. */
function atlas(fam) {
    fam = FAMILIES[fam] ? fam : 'bold';
    if (built[fam]) return built[fam];
    const b = BAKED[fam];
    if (b) {
        const m = b.meta;
        built[fam] = { w: m.cellW * m.cols, h: m.cellH * m.rows, px: b.px, cells: m.chars.length, cols: m.cols, rows: m.rows,
            aspect: m.cellW / m.cellH, code: codeOf, adv: m.adv, fam, baked: m.font };
        return built[fam];
    }
    // COLS cells a row (a texture is at most 2048 wide), as many rows as needed
    const rows = Math.ceil(CHARS.length / COLS), w = CELL_W * COLS, h = CELL_H * rows, px = Buffer.alloc(w * h);
    CHARS.split('').forEach((ch, k) => {
        const c = ch === ' ' ? Buffer.alloc(CELL_W * CELL_H) : cell(ch, fam), ox = (k % COLS) * CELL_W, oy = Math.floor(k / COLS) * CELL_H;
        for (let y = 0; y < CELL_H; y++) c.copy(px, (oy + y) * w + ox, y * CELL_W, (y + 1) * CELL_W);
    });
    // each glyph's advance, in glyph heights (the cell's height), from the font's own metrics
    const probe = new Canvas(1, 1);
    const adv = CHARS.split('').map((ch) => probe.textWidth(ch, SIZE * UP, { font: fontOf(ch, fam), literal: true }) / (CELL_H * UP));
    built[fam] = { w, h, px, cells: CHARS.length, cols: COLS, rows, aspect: CELL_W / CELL_H, code: codeOf, adv, fam };
    return built[fam];
}
/** A digit's advance in glyph heights (the dials' numerals; digits all have one width). */
function digitAdvance(fam) { return atlas(fam).adv[0]; }
/**
 * A line of text as the text shader takes it: up to 32 glyph codes (-1 none) and the centre of each glyph
 * in glyph heights from the layer's left, placed by each glyph's own advance. boxW: the layer's width in
 * glyph heights; align 0 left, 0.5 centre, 1 right; tracking: extra space between glyphs (glyph heights).
 */
function line(s, boxW, align, tracking, fam) {
    const a = atlas(fam), chars = Array.from(String(s)).slice(0, 32);
    // a space at least a third of a glyph height: the unit's fonts report next to nothing for it, which ran
    // 'F 0   R 100' together on the car
    const codes = chars.map(codeOf), advs = codes.map((c, i) => (c < 0 ? 0.3 : chars[i] === ' ' ? Math.max(a.adv[c], 0.32) : a.adv[c]));
    // a line too long for its box: first no tracking, then the glyphs set closer (to 85% of their advance at
    // most), so it fits instead of being cut at the box's edge
    const gaps = Math.max(0, chars.length - 1), sum = advs.reduce((x, v) => x + v, 0);
    let tr = tracking || 0, k = 1;
    if (sum + tr * gaps > boxW) tr = Math.max(0, (boxW - sum) / Math.max(1, gaps));
    if (sum > boxW && sum > 0) k = Math.max(0.85, boxW / sum);
    const total = sum * k + tr * gaps;
    let pen = (boxW - total) * (align === undefined ? 0.5 : align);
    const centres = advs.map((v) => { const c = pen + v * k / 2; pen += v * k + tr; return Math.round(c * 1000) / 1000; });
    while (codes.length < 32) { codes.push(-1); centres.push(-100); }
    return { codes, centres };
}
/** A character's cell, -1 for one the atlas has not got (drawn as nothing). Lower case as itself when baked,
 * else as upper case. */
function codeOf(ch) { const c = String(ch), i = CHARS.indexOf(c); return i >= 0 ? i : CHARS.indexOf(c.toUpperCase()); }
/** Up to 32 codes for a string (the text shader's u_text), padded with -1. */
function codes(s) {
    const out = [];
    for (const ch of Array.from(String(s)).slice(0, 32)) out.push(codeOf(ch));
    while (out.length < 32) out.push(-1);
    return out;
}

module.exports = { atlas, codes, codeOf, line, digitAdvance, CHARS, CELL_W, CELL_H, SPREAD, FAMILIES };
