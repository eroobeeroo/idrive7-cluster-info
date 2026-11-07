'use strict';
/**
 * link.js - Home Link's connection to the bridge at home (the Homebridge plugin homebridge-x5-link), with no
 * typing on the head unit:
 *
 *   finding it   the head unit's Wi-Fi lease (mgu-uplink writes it for apps allowed online) gives this
 *                network; every address on it is tried on the bridge's port (outgoing connections only: the
 *                head unit lets nothing connect in), and the one answering /x5link/hello as an X5 Link bridge
 *                is kept for this network, until it stops answering
 *   pairing      a 12-character code made once on the unit and shown on the app's page; typed once into the
 *                plugin's settings; every report is signed with it (HMAC-SHA256 of the body) and numbered
 *                (seq, always rising), so nothing else on the network can pass for the car or replay it
 *   reporting    POST /x5link/state, JSON; the reply may ask for a higher seq (409) or say the code is wrong
 *
 * Node 8 (the unit's): callbacks and promises, no newer syntax.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const PORT = 8582;
const SERVICE = 'x5-link';
/* Crockford-style base32 without I, L, O, U: nothing to misread off a screen */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

/** A new pairing code: 12 characters (60 bits). */
function newCode() {
    const b = crypto.randomBytes(12);
    let s = '';
    for (let i = 0; i < 12; i++) s += ALPHABET[b[i] % 32];
    return s;
}
/** The code as typed or shown ('abcd-efgh-jkmn' -> 'ABCDEFGHJKMN'): upper case, no dashes or spaces; O read as 0,
 * I and L as 1 (what a person might type for them). */
const normCode = (c) => String(c || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
/** 'ABCD-EFGH-JKMN'. */
const showCode = (c) => normCode(c).replace(/(.{4})(?=.)/g, '$1-');
/** The signature of a body: hex HMAC-SHA256 with the normalised code. */
const sign = (body, code) => crypto.createHmac('sha256', normCode(code)).update(body).digest('hex');
/** The car's id for the bridge: from the code, so it changes with a new code and names nothing about the car. */
const carId = (code) => crypto.createHash('sha256').update('x5-link car ' + normCode(code)).digest('hex').slice(0, 12);

/* ---------- what the unit keeps: the code, the last seq, the bridge for each network ---------- */
function loadState(dir) {
    const file = path.join(dir, 'home_link.json');
    let s = {};
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { /* first start */ }
    if (!s.code || normCode(s.code).length !== 12) s.code = newCode();
    if (typeof s.seq !== 'number' || !isFinite(s.seq)) s.seq = 0;
    if (!s.bridges || typeof s.bridges !== 'object') s.bridges = {};
    s.file = file;
    return s;
}
function saveState(s) {
    const out = { code: s.code, seq: s.seq, bridges: s.bridges };
    try { fs.writeFileSync(s.file + '.tmp', JSON.stringify(out)); fs.renameSync(s.file + '.tmp', s.file); } catch (e) { /* read-only: kept in memory */ }
}
/** The next seq: rising, and at least the time in ms (so a lost state file still starts above what the bridge saw,
 * as long as the clock is right). */
function nextSeq(s) { s.seq = Math.max(s.seq + 1, Date.now()); return s.seq; }

/* ---------- the network ---------- */
/** The head unit's lease ({ interface, ip, prefix, router }) from mgu-uplink, or null while it has none. */
function readLease(dirs) {
    for (const f of dirs) {
        try {
            const j = JSON.parse(fs.readFileSync(f, 'utf8'));
            if (j && typeof j.ip === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(j.ip)) return { ip: j.ip, prefix: Number(j.prefix) || 24, router: j.router || '', interface: j.interface || '' };
        } catch (e) { /* not there */ }
    }
    return null;
}
const toInt = (ip) => ip.split('.').reduce((a, b) => a * 256 + Number(b), 0);
const toIp = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.');
/** A network's key: its address and prefix (and the router: the same addresses at another place differ). */
function netKey(lease) {
    const p = Math.max(8, Math.min(30, lease.prefix)), mask = p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0;
    return toIp((toInt(lease.ip) & mask) >>> 0) + '/' + p + ' via ' + lease.router;
}
/**
 * The addresses to try, nearest first: the /24 the unit is in (all of a /24 or smaller network), then, on a bigger
 * network, the /24s around it, up to `max` addresses in all. The unit's own address and the network's first and
 * last are left out.
 */
function hosts(lease, max) {
    max = max || 1024;
    const p = Math.max(8, Math.min(30, lease.prefix)), self = toInt(lease.ip);
    const mask = (0xFFFFFFFF << (32 - p)) >>> 0, lo = (self & mask) >>> 0, hi = (lo + (2 ** (32 - p)) - 1) >>> 0;
    const out = [], add = (n) => { if (n > lo && n < hi && n !== self && out.length < max) out.push(toIp(n)); };
    if (p >= 24) { for (let n = lo + 1; n < hi; n++) add(n); return out; }
    const base = (self & 0xFFFFFF00) >>> 0;
    for (let k = 0; out.length < max && k < 2 ** (24 - p); k++) {
        // this /24, then one above, one below, two above, ...
        const step = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2);
        const b = base + step * 256;
        if (b < lo || b > hi) continue;
        for (let i = 1; i < 255; i++) add(b + i);
    }
    return out;
}

/** An HTTP request: resolves { status, json } (json null when the body isn't JSON), rejects on no answer. */
function request(host, port, method, p, body, headers, timeoutMs) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
        if (body !== undefined) h['Content-Length'] = Buffer.byteLength(body);
        const req = http.request({ host, port, method, path: p, headers: h, agent: false }, (res) => {
            let txt = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { if (txt.length < 65536) txt += c; });
            res.on('end', () => { let j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json: j }); });
        });
        req.setTimeout(timeoutMs || 3000, () => req.abort());
        req.on('error', reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}
/** True when host:port takes a TCP connection within timeoutMs (the quick first test of a scan). */
function opens(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const s = net.connect({ host, port });
        let done = false;
        const end = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
        s.setTimeout(timeoutMs, () => end(false));
        s.on('connect', () => end(true));
        s.on('error', () => end(false));
    });
}
/** The bridge's hello at host:port: { name, version, paired } when it is an X5 Link bridge, else null. */
function hello(host, port, timeoutMs) {
    return request(host, port, 'GET', '/x5link/hello', undefined, {}, timeoutMs || 2500)
        .then((r) => (r.status === 200 && r.json && r.json.service === SERVICE ? r.json : null), () => null);
}
/**
 * Finds the bridge: every address in `list` is tried on `port`, `parallel` at a time (TCP first, then the hello).
 * Resolves { host, port, hello } for the first that answers as a bridge, or null.
 */
function scan(list, port, opts) {
    opts = opts || {};
    const parallel = opts.parallel || 48, connectMs = opts.connectMs || 450;
    return new Promise((resolve) => {
        let i = 0, running = 0, found = null;
        const next = () => {
            if (found) return;
            if (i >= list.length && running === 0) return resolve(null);
            while (running < parallel && i < list.length) {
                const host = list[i++];
                running++;
                opens(host, port, connectMs)
                    .then((ok) => (ok && !found ? hello(host, port) : null))
                    .then((h) => {
                        running--;
                        if (h && !found) { found = { host, port, hello: h }; return resolve(found); }
                        next();
                    });
            }
        };
        next();
    });
}
/** Sends a report: resolves { status, json }. */
function report(bridge, state, payload) {
    const body = JSON.stringify(payload);
    return request(bridge.host, bridge.port, 'POST', '/x5link/state', body, { 'X-X5-Signature': sign(body, state.code), 'X-X5-Car': carId(state.code) }, 4000);
}

/*
 * Charging, held between reads (the battery's power is fresh only just after one): on when power goes into the
 * battery (below -0.5 kW) or, with no fresh power reading, its charge rises a point or more while the car stands; off when power stops
 * (above -0.3 kW) or the car moves or its engine runs. state.kw: the last power measured while on (kW, positive).
 */
function chargeTracker() {
    const isNum = (v) => typeof v === 'number' && isFinite(v);
    const state = { on: false, kw: null, socAt: null };
    function update(d) {
        const still = !isNum(d.speed) || d.speed < 1;
        if (!still || d.engineOn === true) { state.on = false; state.kw = null; state.socAt = isNum(d.soc) ? d.soc : null; return state; }
        if (isNum(d.kw)) {
            if (d.kw < -0.5) { state.on = true; state.kw = -d.kw; } else if (d.kw > -0.3) { state.on = false; state.kw = null; }
        }
        if (isNum(d.soc)) {
            // (a fresh power reading decides; a rising charge only counts without one)
            if (!isNum(d.kw) && isNum(state.socAt) && d.soc >= state.socAt + 1) state.on = true;
            if (!isNum(state.socAt) || d.soc < state.socAt || d.soc >= state.socAt + 1) state.socAt = d.soc;
        }
        return state;
    }
    return { state, update };
}

module.exports = { chargeTracker, PORT, SERVICE, ALPHABET, newCode, normCode, showCode, sign, carId, loadState, saveState, nextSeq, readLease, netKey, hosts, scan, hello, report, request };
