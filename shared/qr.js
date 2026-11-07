'use strict';
/**
 * qr.js - QR codes (ISO/IEC 18004, byte mode), for getting logs off the head unit by photographing its screen:
 * the apps can't reach a phone over the network (the unit's firewall lets nothing connect in, and an app's
 * traffic out only through the uids the uplink allows), but a camera can read a QR code.
 *
 *   encode(bytes, { ecl: 'L' | 'M' | 'Q' | 'H', minVersion, maxVersion }) -> { size, version, get(x, y) }
 *
 * Written for this repo after the method in Project Nayuki's QR Code generator (MIT): Reed-Solomon over
 * GF(2^8), block interleaving, the function patterns, the eight masks and the standard penalty.
 */

const ECL = { L: { ord: 0, fmt: 1 }, M: { ord: 1, fmt: 0 }, Q: { ord: 2, fmt: 3 }, H: { ord: 3, fmt: 2 } };
const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const n = Math.floor(ver / 7) + 2;
        r -= (25 * n - 10) * n - 55;
        if (ver >= 7) r -= 36;
    }
    return r;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];
/** The most bytes a version holds in byte mode at an error correction level. */
function capacity(ver, ecl) {
    const bits = dataCodewords(ver, ECL[ecl].ord) * 8 - 4 - (ver <= 9 ? 8 : 16);
    return Math.floor(bits / 8);
}

/* ---- GF(2^8) and Reed-Solomon ---- */
function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11D);
        z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
}
function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < r.length; j++) {
            r[j] = mul(r[j], root);
            if (j + 1 < r.length) r[j] ^= r[j + 1];
        }
        root = mul(root, 0x02);
    }
    return r;
}
function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
        const f = b ^ r.shift();
        r.push(0);
        div.forEach((c, i) => { r[i] ^= mul(c, f); });
    }
    return r;
}

/**
 * The QR code for bytes (an array or Uint8Array of 0..255). Throws when they don't fit maxVersion.
 * Returns { version, size, get(x, y) -> true for a dark module }.
 */
function encode(bytes, opts) {
    const o = opts || {}, ecl = ECL[o.ecl || 'M'];
    const minV = o.minVersion || 1, maxV = o.maxVersion || 40;
    let ver = minV;
    for (; ver <= maxV; ver++) if (bytes.length <= capacity(ver, o.ecl || 'M')) break;
    if (ver > maxV) throw new Error('qr: ' + bytes.length + ' bytes do not fit version ' + maxV);
    const e = ecl.ord, size = ver * 4 + 17;

    /* the data codewords: mode, count, bytes, terminator, padding */
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const capBits = dataCodewords(ver, e) * 8;
    put(0, Math.min(4, capBits - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    /* error correction, then the blocks interleaved */
    const nBlocks = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks);
    const div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < nShort) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) words.push(b[i]); });

    /* the function patterns */
    const mods = [], fn = [];
    for (let y = 0; y < size; y++) { mods.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const setF = (x, y, dark) => { mods[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
            if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
        }
    });
    const align = [];
    if (ver > 1) {
        const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
        align.push(6);
        for (let pos = size - 7; align.length < n; pos -= step) align.splice(1, 0, pos);
    }
    align.forEach((ay, i) => align.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = (mask) => {
        const d = (ecl.fmt << 3) | mask;
        let rem = d;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const b = ((d << 10) | rem) ^ 0x5412, bit = (i) => ((b >>> i) & 1) !== 0;
        for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
        setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
        for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
        setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        const b = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
            setF(a, c, dark); setF(c, a, dark);
        }
    }

    /* the codewords in the zigzag */
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
            const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
            if (!fn[y][x] && i < words.length * 8) { mods[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
        }
    }

    /* the mask with the lowest penalty */
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
        (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mods[y][x] = !mods[y][x]; };
    const penalty = () => {
        let p = 0, dark = 0;
        const runs = (get) => {
            for (let a = 0; a < size; a++) {
                let run = 1;
                for (let b = 1; b <= size; b++) {
                    if (b < size && get(a, b) === get(a, b - 1)) run++;
                    else { if (run >= 5) p += run - 2; run = 1; }
                }
            }
        };
        runs((a, b) => mods[a][b]); runs((a, b) => mods[b][a]);
        for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
            const c = mods[y][x];
            if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) p += 3;
        }
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mods[y][x]) dark++;
        p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
        return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        const p = penalty();
        if (p < bestP) { bestP = p; best = m; }
        applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { version: ver, size, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mods[y][x] };
}

module.exports = { encode, capacity };
