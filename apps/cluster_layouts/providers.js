'use strict';
/**
 * providers.js - readings other apps share in /dev/shm/cluster-info (the folder Cluster Info reads, its
 * providers.js has the format): eDrive Live's battery charge and power, and any app's ranges. A file older
 * than STALE_MS counts as gone. While the layout shows, want() asks for them as Cluster Info does.
 *
 *   power.kw                 the high-voltage battery's power (kW, - charging)
 *   values.soc.pct           the battery's charge (%)
 *   values.erange.km         the electric range (km)
 *   values.frange.km         the fuel range (km)
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.CLUSTER_INFO_DIR || '/dev/shm/cluster-info';
const STALE_MS = 3000;

function startProviders(log, opts) {
    opts = opts || {};
    const dir = opts.dir || DIR;
    let entries = {};
    function scan() {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (e) { entries = {}; return; }
        const next = {};
        names.forEach((n) => {
            if (!/\.json$/.test(n) || n === 'wanted.json') return;
            try {
                const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
                if (j && typeof j.t === 'number' && Date.now() - j.t < STALE_MS) next[n.replace(/\.json$/, '')] = j;
            } catch (e) { /* half written: the next scan */ }
        });
        const before = Object.keys(entries).sort().join(','), after = Object.keys(next).sort().join(',');
        if (before !== after) log.info('providers: ' + (after || 'none'));
        entries = next;
    }
    const first = (fn) => { for (const id of Object.keys(entries).sort()) { const v = fn(entries[id]); if (typeof v === 'number' && isFinite(v)) return v; } return undefined; };
    /*
     * wanted.json is Cluster Info's: it writes it while its panel is up, and eDrive Live shares only while it is
     * fresh. The folder is sticky (each app may replace or remove only its own files), so a wanted.json of ours
     * left behind is one Cluster Info can no longer refresh: eDrive Live then stops sharing with it. So this app
     * writes one only when none is there or it is ours, removes it as soon as it stops wanting, and removes a
     * leftover of its own at start.
     */
    const WANTED = path.join(dir, 'wanted.json');
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    const ours = () => { try { return fs.statSync(WANTED).uid === uid; } catch (e) { return null; } };   // null: none
    let wantedT = 0, holding = false;
    /** Ask the providers to read fast and share, at most once a second (see above). */
    function want(what) {
        if (Date.now() - wantedT < 1000) return;
        wantedT = Date.now();
        try {
            try { fs.mkdirSync(dir); fs.chmodSync(dir, 0o1777); } catch (e) { if (e.code !== 'EEXIST') throw e; }
            if (ours() === false) { holding = false; return; }   // another app's (Cluster Info's): it asks already
            const tmp = WANTED + '.' + process.pid + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(Object.assign({ t: Date.now() }, what)), { mode: 0o644 });
            fs.renameSync(tmp, WANTED);
            holding = true;
        } catch (e) { if (!want.warned) { want.warned = true; log.warn('providers: ' + e.message); } }
    }
    /** Stops asking: removes this app's wanted.json, so Cluster Info can write its own. */
    function release() {
        if (!holding && ours() !== true) return;
        holding = false;
        try { if (ours() === true) fs.unlinkSync(WANTED); } catch (e) { /* gone */ }
    }
    release();   // a leftover from before (an older version of this app, or one stopped mid-way)
    process.once('exit', release);
    const timer = setInterval(scan, opts.scanMs || 500);
    scan();
    return {
        /** { kw, soc, erange, frange, battery (°C) } (each undefined when no app shares it). */
        readings: () => ({
            kw: first((e) => e.power && !e.power.old && e.power.kw),
            soc: first((e) => e.values && e.values.soc && e.values.soc.pct),
            erange: first((e) => e.values && e.values.erange && e.values.erange.km),
            frange: first((e) => e.values && e.values.frange && e.values.frange.km),
            battery: first((e) => e.values && e.values.battery && e.values.battery.c),
        }),
        want,
        release,
        list: () => Object.keys(entries).map((id) => entries[id].app || id),
        stop: () => { clearInterval(timer); release(); },
    };
}
module.exports = { startProviders, DIR };
