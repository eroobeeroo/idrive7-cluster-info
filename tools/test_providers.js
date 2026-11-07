'use strict';
/* wanted.json is Cluster Info's: these apps write it only when no other app has one, and remove theirs as soon
 * as they stop wanting (a leftover of ours in the sticky folder stopped eDrive Live sharing with Cluster Info). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startProviders } = require(path.join(__dirname, '..', 'shared', 'providers'));

const log = { info() {}, warn() {} };
let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
const W = path.join(dir, 'wanted.json');
const realUid = process.getuid;

check('wants: writes wanted.json; release removes it', () => {
    const p = startProviders(log, { dir, scanMs: 60000 });
    p.want({ power: true });
    assert(fs.existsSync(W) && JSON.parse(fs.readFileSync(W, 'utf8')).power === true);
    p.release();
    assert(!fs.existsSync(W));
    p.stop();
});

check('another app\'s wanted.json (Cluster Info\'s) is left alone', () => {
    fs.writeFileSync(W, JSON.stringify({ t: 1, from: 'cluster info' }));
    process.getuid = () => realUid() + 1;   // this app runs as another uid than the file's owner
    try {
        const p = startProviders(log, { dir, scanMs: 60000 });
        p.want({ power: true });
        p.release();
        p.stop();
        assert.strictEqual(JSON.parse(fs.readFileSync(W, 'utf8')).from, 'cluster info');
    } finally { process.getuid = realUid; }
    fs.unlinkSync(W);
});

check('a leftover of ours is removed at start', () => {
    fs.writeFileSync(W, JSON.stringify({ t: 1 }));
    const p = startProviders(log, { dir, scanMs: 60000 });
    assert(!fs.existsSync(W));
    p.stop();
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(ok + ' passed');
