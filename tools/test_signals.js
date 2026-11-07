'use strict';
/**
 * test_signals.js - every app's declared signals and their flags (r: read, needs a getter; s: subscribe,
 * needs a notifier) as apps already installed on these cars declare them (tools/known_signals.json). A flag
 * the car's catalog has not got makes the head unit's app manager refuse the install (generateSomeipInterfaces).
 *   node tools/test_signals.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const known = JSON.parse(fs.readFileSync(path.join(__dirname, 'known_signals.json'), 'utf8')).signals;
const bad = [];
fs.readdirSync(path.join(ROOT, 'apps')).forEach((a) => {
    const f = path.join(ROOT, 'apps', a, 'app.json');
    if (!fs.existsSync(f)) return;
    const sig = JSON.parse(fs.readFileSync(f, 'utf8')).signals || {};
    Object.keys(sig).forEach((iface) => Object.keys(sig[iface]).forEach((k) => {
        if (k[0] === '_') return;
        const ok = known[iface] && known[iface][k];
        if (!ok) bad.push(a + ': ' + iface + ' ' + k + ' is in no installed app (check it in the car\'s catalog)');
        else if (ok.indexOf(sig[iface][k]) < 0) bad.push(a + ': ' + iface + ' ' + k + ' "' + sig[iface][k] + '", installed apps use ' + JSON.stringify(ok));
    }));
});
assert.deepStrictEqual(bad, []);
console.log('ok   every declared signal and flag is one installed apps use');
