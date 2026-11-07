'use strict';
/**
 * test_logs.js - the Logs path end to end: a bundle the size the car makes, its QR codes drawn three to a page
 * as the app draws them, the page slightly blurred and shrunk like a photo of the screen, then
 * tools/decode_logs.py (OpenCV) reading the codes and putting the text back together.
 *   node tools/test_logs.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { KIT } = require('./scene');
const logs = require(path.join(__dirname, '..', 'shared', 'logs'));
const { Canvas } = require(path.join(KIT, 'canvas'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-'));
let text = logs.bundle('Cluster Layouts test', [['renderer', 'target panel: slot 0x203 scene 0x1000400 1920x720: shown\nslot 0x100 status 2: 0x10004f0 class 0 map 1\n'.repeat(12)],
    ['log', Array.from({ length: 80 }, (_, i) => '2026-11-05T03:' + String(i % 60).padStart(2, '0') + ' I cluster-demo: target map: take-over ' + i + ' unmapping 0x' + ((i * 2654435761) >>> 0).toString(16) + ' rows ' + ((i * 40503 * 7919) >>> 0).toString(36) + ' ' + Math.sin(i).toFixed(9)).join('\n')]]);
const c = logs.codes(text);
console.log('     ' + text.length + ' chars -> ' + c.bytes + ' bytes compressed -> ' + c.codes.length + ' codes (version ' + c.codes[0].version + ')');
const files = [];
for (let p = 0; p * 3 < c.codes.length; p++) {
    const cv = new Canvas(1600, 520).clear('#101418');
    c.codes.slice(p * 3, p * 3 + 3).forEach((q, i) => logs.draw(cv, q, 40 + i * 520, 84, Math.max(3, Math.floor(420 / (q.size + 8)))));
    const f = path.join(dir, 'page' + p + '.png');
    fs.writeFileSync(f, cv.png());
    files.push(f);
}
// a photo: shrunk to 70 % and back, slightly blurred (the decoder works on what a phone camera would give)
execFileSync('python3', ['-c', `
import cv2, sys
for f in sys.argv[1:]:
    im = cv2.imread(f); h, w = im.shape[:2]
    im = cv2.resize(cv2.resize(im, (int(w*0.7), int(h*0.7)), interpolation=cv2.INTER_AREA), (w*2, h*2), interpolation=cv2.INTER_LINEAR)
    cv2.imwrite(f, cv2.GaussianBlur(im, (3, 3), 0))
`].concat(files));
const out = path.join(dir, 'back.txt');
execFileSync('python3', [path.join(__dirname, 'decode_logs.py')].concat(files, ['-o', out]), { stdio: 'pipe' });
assert.strictEqual(fs.readFileSync(out, 'utf8'), text);
console.log('ok   ' + files.length + ' photographed pages read back to the same text');
const saved = logs.save('hello', dir, 'x.txt');
assert(saved.some((r) => r.file && fs.readFileSync(r.file, 'utf8') === 'hello'));
console.log('ok   saved to the data folder (and any writable USB stick)');
console.log('2 passed');
