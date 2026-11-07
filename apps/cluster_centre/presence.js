'use strict';
/**
 * presence.js - which of these apps is on the cluster now, so they don't both draw: a layout covers the whole
 * panel (Cluster Centre's pages under it would be hidden, yet take dozens of the renderer's 96 layers and
 * leave the layout's last pieces refused). Each app touches a file in /dev/shm while it shows; the other
 * checks it.
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.CLUSTER_PRESENCE_DIR || '/dev/shm/cluster-layouts';
const FRESH_MS = 3000;
let last = 0;

/** Says `name` is showing now (written at most once a second). */
function mark(name) {
    const now = Date.now();
    if (now - last < 1000) return;
    last = now;
    try { try { fs.mkdirSync(DIR); } catch (e) { if (e.code !== 'EEXIST') throw e; } fs.writeFileSync(path.join(DIR, name + '.json'), JSON.stringify({ at: now })); } catch (e) { /* tmpfs not there: nothing shared */ }
}
/** True while `name` has said it is showing in the last FRESH_MS (the file read at most twice a second). */
const seen = new Map();
function active(name) {
    const now = Date.now(), c = seen.get(name);
    if (!c || now - c.read > 500) {
        let at = 0;
        try { at = JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8')).at || 0; } catch (e) { /* not there */ }
        seen.set(name, { read: now, at });
    }
    return now - seen.get(name).at < FRESH_MS;
}

module.exports = { mark, active, DIR };
