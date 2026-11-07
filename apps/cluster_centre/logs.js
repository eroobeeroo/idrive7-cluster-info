'use strict';
/**
 * logs.js - what's needed to find a problem on the car, gathered into one text, and ways to get it out:
 *   - QR codes on the app's screen (qr.js): photograph them and send the photos; tools/decode_logs.py puts
 *     the text back together. No network needed: the unit's firewall lets nothing connect in, and an app's
 *     traffic out only through the uids the uplink allows, so a phone can't fetch from an app.
 *   - a file on any USB stick plugged into the car (/media/<label>, as the unit mounts sticks) and in the app's
 *     data folder.
 *
 * A code's text: "CLG1 <bundle id> <n>/<count> <base64 of a slice of the zlib-deflated bundle>".
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { encode } = require('./qr');

const RENDER_LOG = '/var/opt/cluster-render/log/cluster-render.log';
/* where the unit mounts USB sticks (udisks: /media/<label>); nothing else is written to */
const MEDIA_ROOTS = ['/media', '/run/media'];
/* per code: version 15 at level M holds 412 bytes; the header takes ~20 */
const CHUNK = 380;

/** The last `lines` lines of a file (and its rotated .1 when the file is short), or why not. */
function tail(file, lines) {
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
    let text = read(file);
    if (text === null) {
        try { fs.accessSync(file); } catch (e) { return '(' + file + ': ' + (e.code || e.message) + ')'; }
        return '(' + file + ': not readable)';
    }
    let ls = text.split('\n');
    if (ls.length < lines) { const old = read(file + '.1'); if (old) ls = old.split('\n').concat(ls); }
    return ls.slice(-lines).join('\n');
}

/** Another app's log beside this one (oap_<uid>/data/<id>.log), when this app can read it. */
function siblingLog(dataDir, id, lines) {
    try {
        const root = path.join(dataDir, '..', '..');
        for (const d of fs.readdirSync(root)) {
            const f = path.join(root, d, 'data', id + '.log');
            if (fs.existsSync(f)) return tail(f, lines);
        }
    } catch (e) { /* not listable */ }
    return '(' + id + '.log not found beside this app)';
}

/** The bundle as text: a header, then each [title, body] section. */
function bundle(head, sections) {
    return ['=== ' + head + ' ===', 'at ' + new Date().toISOString()].concat(...sections.map(([t, b]) => ['', '--- ' + t + ' ---', String(b == null ? '' : b)])).join('\n') + '\n';
}

/** Writes the text to the app's data folder and every writable USB stick: [{ file } | { dir, error }]. */
function save(text, dataDir, name) {
    const out = [], file = name || 'cluster-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    const tryDir = (dir) => {
        // (the unit's node throws EEXIST for a folder that is there, even with recursive)
        try { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; } fs.writeFileSync(path.join(dir, file), text); out.push({ file: path.join(dir, file) }); } catch (e) { out.push({ dir, error: e.code || e.message }); }
    };
    if (dataDir) {
        tryDir(path.join(dataDir, 'exports'));
        // keep the newest five
        try {
            const d = path.join(dataDir, 'exports');
            fs.readdirSync(d).filter((f) => /^cluster-logs-/.test(f)).sort().slice(0, -5).forEach((f) => fs.unlinkSync(path.join(d, f)));
        } catch (e) { /* nothing to tidy */ }
    }
    MEDIA_ROOTS.forEach((root) => {
        let names = [];
        try { names = fs.readdirSync(root); } catch (e) { return; }
        names.forEach((n) => {
            const p = path.join(root, n);
            let st;
            try { st = fs.statSync(p); } catch (e) { return; }
            if (!st.isDirectory()) return;
            // /run/media/<user>/<label>: one level more
            let inner = [];
            try { inner = root === '/run/media' ? fs.readdirSync(p).map((x) => path.join(p, x)) : [p]; } catch (e) { inner = [p]; }
            inner.forEach((d) => tryDir(path.join(d, 'cluster-logs')));
        });
    });
    return out;
}

/** The QR codes for a text: { id, codes: [{ size, get(x, y) }] }. */
function codes(text) {
    const z = zlib.deflateSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64');
    const id = Date.now().toString(36).slice(-5), n = Math.max(1, Math.ceil(z.length / CHUNK));
    const list = [];
    for (let i = 0; i < n; i++) {
        const payload = 'CLG1 ' + id + ' ' + (i + 1) + '/' + n + ' ' + z.slice(i * CHUNK, (i + 1) * CHUNK);
        list.push(encode(Buffer.from(payload, 'ascii'), { ecl: 'M', maxVersion: 15 }));
    }
    return { id, codes: list, bytes: z.length };
}

/** Draws a code at x, y, `px` pixels a module, with a white quiet zone of 4 modules, on a canvas or recorder
 * (fillRect): each row's dark runs as one rectangle. */
function draw(cv, q, x, y, px) {
    const quiet = 4 * px, full = (q.size + 8) * px;
    cv.fillRect(x, y, full, full, '#ffffff');
    for (let r = 0; r < q.size; r++) {
        let start = -1;
        for (let c = 0; c <= q.size; c++) {
            const dark = c < q.size && q.get(c, r);
            if (dark && start < 0) start = c;
            if (!dark && start >= 0) { cv.fillRect(x + quiet + start * px, y + quiet + r * px, (c - start) * px, px, '#000000'); start = -1; }
        }
    }
    return full;
}

module.exports = { tail, siblingLog, bundle, save, codes, draw, RENDER_LOG, CHUNK };
