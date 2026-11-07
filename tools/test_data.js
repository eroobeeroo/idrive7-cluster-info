'use strict';
/**
 * test_data.js - shared/data.js's decoding of what the car sends: the drive mode from BMW's FES mode table (by
 * name or number, the longest name first, invalid values ignored).
 *   node tools/test_data.js
 */
const assert = require('assert');
const path = require('path');
require('./scene');   // maps ./kit/ to the kit's runtime
const { modeOf, rangesOf } = require(path.join(__dirname, '..', 'shared', 'data'));

let ok = 0;
const check = (name, fn) => { fn(); ok++; console.log('ok   ' + name); };
check('vehicle ICE: a petrol or diesel car\'s own modes, never a hybrid\'s, no XtraBoost', () => {
    const f = (v) => ({ actualValueModeDrivingExperience: v });
    assert.strictEqual(modeOf(f('SPORT_EXPERT'), true), 'SPORT+');
    assert.strictEqual(modeOf(f('COMFORT_PLUS'), true), 'COMFORT+');
    assert.strictEqual(modeOf(f('ECO_PRO_EFFICIENT'), true), 'ECO PRO');
    assert.strictEqual(modeOf(f('ADAPTIVE'), true), 'ADAPTIVE');
    assert.strictEqual(modeOf({ actualValueModeDrivingExperience: 'SPORT_DYNAMIC', boostState: 'XTRABOOST_ACTIVE' }, true), 'SPORT');
    ['PHEV_ELECTRIC_INDIVIDUAL', 'PHEV_HYBRID_ECO', 'PHEV_SPORT_PLUS'].forEach((m) => assert(!/ELECTRIC|HYBRID|XTRABOOST/.test(String(modeOf(f(m), true))), m));
    assert.strictEqual(modeOf(f('PHEV_SPORT_PLUS')), 'XTRABOOST');     // (and still as a hybrid's)
});

check('names: each PHEV mode as the stock cluster names it', () => {
    const want = { PHEV_SPORT_STANDARD: 'SPORT', PHEV_SPORT_INDIVIDUAL: 'SPORT INDIVIDUAL', PHEV_HYBRID_STANDARD: 'HYBRID', PHEV_HYBRID_ECO: 'HYBRID ECO PRO',
        PHEV_HYBRID_COMFORT: 'HYBRID COMFORT', PHEV_ELECTRIC_STANDARD: 'ELECTRIC', PHEV_ELECTRIC_INDIVIDUAL: 'ELECTRIC INDIVIDUAL', PHEV_BATTERY_CONTROL: 'BATTERY CONTROL', ADAPTIVE: 'ADAPTIVE', PHEV_SPORT_PLUS: 'XTRABOOST' };
    Object.keys(want).forEach((k) => assert.strictEqual(modeOf({ statusFesMode: k }), want[k], k));
});
check('names in a struct among other strings; the longest wins', () => {
    assert.strictEqual(modeOf({ a: { mode: 'FES_PHEV_HYBRID_COMFORT' }, b: 'COMFORT' }), 'HYBRID COMFORT');
    assert.strictEqual(modeOf({ x: 'ELECTRIC_DRIVE_NOT_AVAILABLE', mode: 'PHEV_HYBRID_STANDARD' }), 'HYBRID');
});
check('numbers in a field named like a mode', () => {
    assert.strictEqual(modeOf({ statusMode: 0x15 }), 'ELECTRIC INDIVIDUAL');
    assert.strictEqual(modeOf({ statusMode: 0x11, qualifier: 2 }), 'HYBRID');
    assert.strictEqual(modeOf({ counter: 0x15 }), null);
});
check('invalid and initialising values: no mode', () => {
    assert.strictEqual(modeOf({ m: 'INITIALIZATION' }), null);
    assert.strictEqual(modeOf({ m: 'SIGNAL_INVALID' }), null);
    assert.strictEqual(modeOf({ m: 0x3F }), null);
});
check('XtraBoost added when a string says it is active', () => {
    assert.strictEqual(modeOf({ m: 'PHEV_SPORT_STANDARD', boost: 'XTRABOOST_ACTIVE' }), 'SPORT XTRABOOST');
    assert.strictEqual(modeOf({ m: 'PHEV_SPORT_STANDARD', boost: 'XTRABOOST_NOT_ACTIVE' }), 'SPORT');
});
check('ranges by field name: electric, total, fuel, the tank level; invalid values left out', () => {
    assert.deepStrictEqual(rangesOf({ rangeElectric: 29, rangeTotal: 540, rangeFuel: 511, fuelTankLevel: 42 }), { carErange: 29, carTrange: 540, carFrange: 511, fuelLevel: 42 });
    assert.deepStrictEqual(rangesOf({ s: { reichweiteHV: 18, reichweite: 400 } }), { carErange: 18, carFrange: 400 });
    assert.deepStrictEqual(rangesOf({ rangeEv: 65535, counter: 3 }), {});
});
console.log(ok + ' passed');
