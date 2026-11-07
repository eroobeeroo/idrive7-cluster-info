'use strict';
/**
 * sync_shared.js - copies shared/*.js (the renderer side both apps use: engine, shaders, glyph atlas,
 * render client, providers, signal finder) into each app's folder. The build ships only an app's own
 * top-level .js files, so each app carries its copy; edit shared/, then run this. test_shared.js fails while a
 * copy differs.
 *   node tools/sync_shared.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..'), SHARED = path.join(ROOT, 'shared'), APPS = path.join(ROOT, 'apps');
const files = () => fs.readdirSync(SHARED).filter((f) => f.endsWith('.js') || /^font_\w+\.wad$/.test(f) || f === 'NOTICE');
/** The shared files an app takes: its app.json "shared" list, else all of them. */
const filesFor = (a) => { let j = {}; try { j = JSON.parse(fs.readFileSync(path.join(APPS, a, 'app.json'), 'utf8')); } catch (e) { /* none */ } return Array.isArray(j.shared) ? files().filter((f) => j.shared.indexOf(f) >= 0) : files(); };
const apps = () => fs.readdirSync(APPS).filter((a) => fs.existsSync(path.join(APPS, a, 'app.json')));
/** [{ app, file, same }] for every shared file in every app. */
function compare() {
    const out = [];
    apps().forEach((a) => filesFor(a).forEach((f) => {
        const dst = path.join(APPS, a, f);
        out.push({ app: a, file: f, same: fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(path.join(SHARED, f))) });
    }));
    return out;
}
if (require.main === module) {
    apps().forEach((a) => filesFor(a).forEach((f) => fs.copyFileSync(path.join(SHARED, f), path.join(APPS, a, f))));
    console.log('shared: ' + apps().map((a) => a + ' ' + filesFor(a).length).join(', '));
}
module.exports = { compare };
