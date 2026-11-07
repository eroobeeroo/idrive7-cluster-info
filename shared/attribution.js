'use strict';
/**
 * attribution.js - the credit shown in every app and woven into the cluster render path (engine.js draws the
 * mark on every layout and page). It says the apps are free and open source, links the repo, and tells anyone
 * who paid to get a refund.
 *
 * It is signed. shared/attribution_sig.js (committed) holds the author's PUBLIC key, a signature over the credit
 * text below, and the key's fingerprint. The matching PRIVATE key lives only in secret/ (git-ignored, never
 * pushed), so the text here cannot be changed and re-signed by anyone else: verify() then fails and the apps
 * show a "modified build" mark instead of the normal one. This is open source, so a re-packager can of course
 * delete the check in their own fork - but they cannot pass that fork off as an official, validly signed build,
 * and users can tell from the fingerprint. tools/sign_attribution.js re-signs after an intended change.
 *
 * Node 8 (the unit's): crypto.createVerify('RSA-SHA256') with a PEM public key - long supported.
 */
const crypto = require('crypto');

// the credit, verbatim; signed as the lines joined by "\n" (keep this and tools/sign_attribution.js in step)
const INFO = {
    app: 'BMW iDrive cluster apps',
    author: 'eroobeeroo',
    repo: 'github.com/eroobeeroo/idrive7-cluster-info',
    url: 'https://github.com/eroobeeroo/idrive7-cluster-info',
    notice: 'Free and open source. If you paid for this, ask for a refund.',
};
const FIELDS = ['app', 'author', 'repo', 'url', 'notice'];
/** The exact bytes that are signed. */
function canonical() { return FIELDS.map((k) => INFO[k]).join('\n'); }

let sig = null;
try { sig = require('./attribution_sig'); } catch (e) { sig = null; }

let cached = null;
/** Whether the credit matches the author's signature. { ok, fingerprint?, reason? } - worked out once. */
function verify() {
    if (cached) return cached;
    if (!sig || !sig.pub || !sig.sig) { cached = { ok: false, reason: 'unsigned build' }; return cached; }
    try {
        const v = crypto.createVerify('RSA-SHA256');
        v.update(canonical(), 'utf8');
        v.end();
        const ok = v.verify(sig.pub, Buffer.from(sig.sig, 'base64'));
        cached = ok ? { ok: true, fingerprint: sig.fp } : { ok: false, reason: 'signature does not match the credit' };
    } catch (e) {
        cached = { ok: false, reason: String((e && e.message) || e) };
    }
    return cached;
}

/** One line for the cluster watermark: the normal mark, or a warning when the build has been altered. */
function mark() {
    return verify().ok ? 'FREE  ' + INFO.repo : 'MODIFIED BUILD - get it free at ' + INFO.repo;
}
/** A short mark (<= 32 glyphs) for the narrow map slot: the repo without the host, or a short warning. */
function markShort() {
    return verify().ok ? 'FREE  ' + INFO.repo.replace(/^github\.com\//, '') : 'MODIFIED BUILD - this is free';
}
/** The lines for an app's own page (info screen). */
function lines() {
    const v = verify();
    const out = [INFO.notice, INFO.url];
    if (!v.ok) out.unshift('MODIFIED BUILD - not an official ' + INFO.author + ' release (' + v.reason + ')');
    else out.push('Official build  ·  key ' + (v.fingerprint || '?'));
    return out;
}

module.exports = { INFO, canonical, verify, mark, markShort, lines };
