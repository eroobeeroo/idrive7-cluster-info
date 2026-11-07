'use strict';
/**
 * test_built.js - each app built as the Store builds it (kit/tools/build.py) and started on the kit's stubbed
 * head unit (kit/tools/hu-stub.js), whose screen is the car's: a recorder for the GPU draw engine, not a plain
 * canvas. Fails when the app's screen does not draw (Cluster Centre's preview once called a canvas-only method
 * there and its screen stayed blank on the car).
 *   node tools/test_built.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.env.CLUSTER_INFO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
process.env.CLUSTER_PRESENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
const failures = [];
process.on('unhandledRejection', (e) => failures.push(String(e && e.stack || e)));
process.on('uncaughtException', (e) => failures.push(String(e && e.stack || e)));

(async () => {
    for (const id of ['cluster_layouts', 'cluster_centre', 'home_link']) {
        execFileSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), id], { cwd: ROOT, stdio: 'pipe' });
        const { headUnit } = require(path.join(ROOT, 'kit', 'tools', 'hu-stub.js'));
        let images = 0;
        const quiet = { info() {}, warn: (m) => { if (/render:/.test(m)) failures.push(id + ': ' + m); }, error: (m) => failures.push(id + ': ' + m), debug() {} };
        const hu = headUnit(path.join(ROOT, 'dist', id), { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), id + '-')), fresh: true, log: quiet, image: () => { images++; } });
        const origLog = console.log, origWarn = console.warn;
        console.log = () => {}; console.warn = (m) => { if (/render:/.test(String(m))) failures.push(id + ': ' + m); };
        await hu.start();
        await new Promise((r) => setTimeout(r, 800));
        if (hu.loopFn) await hu.loopFn('MAIN');
        // every page behind Signals draws too (the raw values, the cluster's report, the signal lists)
        for (let i = 0; i < 4 && hu.handlers.BTN_SIGNALS; i++) { const before = images; await hu.handlers.BTN_SIGNALS(); if (hu.loopFn) await hu.loopFn('MAIN'); assert(images > before, id + ': Signals page ' + (i + 1) + ' drew nothing'); }
        // Logs: the QR pages draw, then back to the status
        for (let i = 0; i < 5 && hu.handlers.BTN_LOGS; i++) { const before = images; await hu.handlers.BTN_LOGS(); if (hu.loopFn) await hu.loopFn('MAIN'); assert(images > before, id + ': Logs page ' + (i + 1) + ' drew nothing'); }
        // Home Link: online through the uplink (package.json mguInternet), its buttons draw
        if (id === 'home_link') {
            const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', id, 'source', 'package.json'), 'utf8'));
            assert.strictEqual(pkg.mguInternet, true, 'home_link: not marked for the internet');
            for (const b of ['BTN_FIND', 'BTN_CODE']) { const before = images; await hu.handlers[b](); if (hu.loopFn) await hu.loopFn('MAIN'); assert(images > before, id + ': ' + b + ' drew nothing'); }
        }
        if (hu.handlers.BTN_NEXT) { await hu.handlers.BTN_NEXT(); if (hu.loopFn) await hu.loopFn('MAIN'); }
        console.log = origLog; console.warn = origWarn;
        assert(images > 0, id + ': its screen drew nothing');
        console.log('ok   ' + id + ': built, started on the stubbed head unit, its screen drew (' + images + ' frames)');
    }
    assert.strictEqual(failures.length, 0, failures.join('\n'));
    console.log('3 passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
