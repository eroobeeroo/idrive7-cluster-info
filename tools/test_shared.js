'use strict';
// every app carries the same copy of shared/ (tools/sync_shared.js)
const assert = require('assert');
const bad = require('./sync_shared').compare().filter((c) => !c.same);
assert.deepStrictEqual(bad, [], 'run node tools/sync_shared.js: ' + bad.map((c) => c.app + '/' + c.file).join(', '));
console.log('ok   every app has the current shared files');
