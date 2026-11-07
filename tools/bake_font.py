#!/usr/bin/env python3
"""
bake_font.py - the cluster's glyph atlases, made once from real font files and committed (shared/font_<family>.wad,
the distance field's bytes, and shared/font_baked.js, their metrics; .wad so the app build packages them), so the apps no longer enlarge the kit's small baked bitmaps (64 px at most, drawn at ~250 px: the
letters came out soft and odd).

Font: Barlow Semi Condensed (SIL Open Font License 1.1, shared/NOTICE), a DIN-like face of the kind
instrument clusters use, with upper and lower case. Families:
  bold   SemiBold (figures and text the layouts call bold)
  light  Regular

Each cell: the glyph drawn at 4x, centred, its baseline at BASE of the cell's height (room below it for the
descenders of g j p q y, which 0.86 cut off), as a signed distance field
(0.5 at the outline, SPREAD atlas pixels each side), exactly as shared/font.js made it before. The advance of each
glyph is the font's own, in glyph heights (the cell's height).

    python3 tools/bake_font.py <folder with the BarlowSemiCondensed-*.ttf files>
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(HERE, '..', 'shared')
# the glyphs: what the layouts write, now with lower case
CHARS = ("0123456789-°PRNDSMOILCATEHKXFUGBVYWQJZ/ .:%+,'!|()"
         "abcdefghijklmnopqrstuvwxyz~<>=#&*?_")
CELL_W, CELL_H = 56, 64      # a cell (0.875 glyph heights wide: room for m and W)
UP = 4
COLS = 32
SPREAD = 8
SIZE = CELL_H * 0.92         # the font size a glyph is drawn at, in atlas pixels
BASE = 0.79                  # the baseline, of the cell's height
FAMILIES = {'bold': 'BarlowSemiCondensed-SemiBold.ttf', 'light': 'BarlowSemiCondensed-Regular.ttf'}


def cell(font, ch):
    W, H = CELL_W * UP, CELL_H * UP
    im = Image.new('L', (W, H), 0)
    if ch != ' ':
        ImageDraw.Draw(im).text((W / 2, H * BASE), ch, font=font, fill=255, anchor='ms')
    ins = np.asarray(im) >= 128
    to_out = ndimage.distance_transform_edt(ins)        # inside: distance to the nearest outside pixel
    to_in = ndimage.distance_transform_edt(~ins)        # outside: distance to the nearest inside pixel
    sd = np.where(ins, to_out - 0.5, -(to_in - 0.5)) / UP
    sd = sd[UP // 2::UP, UP // 2::UP]                   # one sample a cell pixel, at its centre
    return np.clip(np.round((0.5 + sd / (2 * SPREAD)) * 255), 0, 255).astype(np.uint8)


def bake(src, fam, ttf):
    font = ImageFont.truetype(os.path.join(src, ttf), int(round(SIZE * UP)))
    rows = -(-len(CHARS) // COLS)
    atlas = np.zeros((CELL_H * rows, CELL_W * COLS), np.uint8)
    adv = []
    for k, ch in enumerate(CHARS):
        oy, ox = (k // COLS) * CELL_H, (k % COLS) * CELL_W
        atlas[oy:oy + CELL_H, ox:ox + CELL_W] = cell(font, ch)
        adv.append(round(font.getlength(ch) / (CELL_H * UP), 4))
    with open(os.path.join(SHARED, 'font_' + fam + '.wad'), 'wb') as f:
        f.write(atlas.tobytes())
    print(fam, ttf, atlas.shape[1], 'x', atlas.shape[0], len(CHARS), 'glyphs')
    return {'font': ttf, 'chars': CHARS, 'cellW': CELL_W, 'cellH': CELL_H, 'cols': COLS, 'rows': rows, 'spread': SPREAD, 'adv': adv}


if __name__ == '__main__':
    src = sys.argv[1]
    meta = {fam: bake(src, fam, ttf) for fam, ttf in FAMILIES.items()}
    with open(os.path.join(SHARED, 'font_baked.js'), 'w') as f:
        f.write("'use strict';\n/* The baked glyph atlases' metrics (tools/bake_font.py; Barlow Semi Condensed, SIL OFL 1.1: NOTICE). */\n"
                'module.exports = ' + json.dumps(meta, ensure_ascii=False) + ';\n')
    lic = os.path.join(src, 'OFL.txt')
    with open(lic) as a, open(os.path.join(SHARED, 'NOTICE'), 'w') as b:
        b.write('The cluster glyph atlases (font_bold.wad, font_light.wad) are made from Barlow Semi Condensed,\n'
                'Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow),\n'
                'used under the SIL Open Font License 1.1, below.\n\n' + a.read())
