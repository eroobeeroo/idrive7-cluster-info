'use strict';
/*
 * test_home_link.js - Home Link (apps/home_link/link.js, the car's side) against the Homebridge plugin
 * (homebridge/homebridge-x5-link), over real HTTP on this machine, with Homebridge's accessory API stood in for
 * (the hap-nodejs services and characteristics the plugin uses, with HomeKit's own constants). Checks: the car
 * finds the bridge by scanning, a report sets the sensors, a wrong code and a replayed report are refused, a new
 * visit is told apart as arrived or started, driving out of range is leaving, and the last values survive a
 * restart of Homebridge.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require(path.join(__dirname, '..', 'apps', 'home_link', 'link'));
const plugin = require(path.join(__dirname, '..', 'homebridge', 'homebridge-x5-link'));

/* ---------- a stand-in for Homebridge's API ---------- */
function makeApi(storage, reuse) {
    if (reuse) { const a = makeApi(storage); a.hap = reuse.hap; a.platformAccessory = reuse.platformAccessory; return a; }
    const C = {};
    const ch = (name, consts) => { C[name] = { name }; Object.assign(C[name], consts || {}); return C[name]; };
    ch('Manufacturer'); ch('Model'); ch('SerialNumber'); ch('FirmwareRevision'); ch('Name');
    ch('CurrentRelativeHumidity'); ch('CurrentAmbientLightLevel'); ch('CurrentTemperature'); ch('MotionDetected');
    ch('OccupancyDetected', { OCCUPANCY_NOT_DETECTED: 0, OCCUPANCY_DETECTED: 1 });
    ch('BatteryLevel'); ch('StatusLowBattery', { BATTERY_LEVEL_NORMAL: 0, BATTERY_LEVEL_LOW: 1 }); ch('ChargingState', { NOT_CHARGING: 0, CHARGING: 1, NOT_CHARGEABLE: 2 });
    class Svc {
        constructor(name) { this.displayName = name; this.values = {}; }
        setCharacteristic(c, v) { assert(c && c.name, 'unknown characteristic'); this.values[c.name] = v; return this; }
        updateCharacteristic(c, v) { return this.setCharacteristic(c, v); }
    }
    const S = {};
    ['AccessoryInformation', 'HumiditySensor', 'LightSensor', 'TemperatureSensor', 'OccupancySensor', 'MotionSensor', 'Battery'].forEach((n) => {
        S[n] = class extends Svc {}; Object.defineProperty(S[n], 'name', { value: n });
    });
    class PlatformAccessory {
        constructor(name, uuid) { this.displayName = name; this.UUID = uuid; this.services = [new S.AccessoryInformation(name)]; }
        getService(T) { return this.services.find((s) => s instanceof T); }
        addService(T, name) { assert(!this.getService(T), 'a service added twice'); const s = new T(name); this.services.push(s); return s; }
    }
    const handlers = {}, registered = new Map();
    return {
        hap: { Service: S, Characteristic: C, uuid: { generate: (s) => require('crypto').createHash('md5').update(s).digest('hex') } },
        platformAccessory: PlatformAccessory,
        user: { storagePath: () => storage },
        on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
        emit: (ev) => (handlers[ev] || []).forEach((f) => f()),
        registerPlatform: (name, cls) => { this.platform = { name, cls }; },
        registerPlatformAccessories: (pl, pf, list) => { assert.strictEqual(pl, 'homebridge-x5-link'); assert.strictEqual(pf, 'X5Link'); list.forEach((a) => registered.set(a.UUID, a)); },
        unregisterPlatformAccessories: (pl, pf, list) => list.forEach((a) => registered.delete(a.UUID)),
        registered,
    };
}
const log = Object.assign(() => {}, { info() {}, warn() {}, error() {}, debug() {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log('ok   ' + name); };

(async () => {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
    const carDir = fs.mkdtempSync(path.join(os.tmpdir(), 'car-'));
    const st = L.loadState(carDir);
    L.saveState(st);

    // registering: the plugin's entry names its platform
    let registeredAs = null;
    plugin({ registerPlatform: (n) => { registeredAs = n; } });
    assert.strictEqual(registeredAs, 'X5Link');

    let api = makeApi(storage);
    let pf = new plugin.X5LinkPlatform(log, { platform: 'X5Link', name: 'Test bridge', pairingCode: L.showCode(st.code).toLowerCase(), units: 'mi' }, api);
    api.emit('didFinishLaunching');
    await sleep(200);
    const svc = (k) => pf.acc[k].service.values;

    await check('pairing code: 12 characters, shown in groups, read back however typed', async () => {
        assert.strictEqual(L.normCode(st.code).length, 12);
        assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(L.showCode(st.code)));
        assert.strictEqual(L.normCode(' ' + L.showCode(st.code).toLowerCase() + ' '), L.normCode(st.code));
        assert.strictEqual(L.loadState(carDir).code, st.code, 'the code is kept across starts');
    });

    await check('addresses to try: the whole /24, not the unit itself; a /22 nearest first, capped', async () => {
        const h = L.hosts({ ip: '192.168.1.37', prefix: 24 });
        assert.strictEqual(h.length, 253); assert(h.indexOf('192.168.1.37') < 0 && h[0] === '192.168.1.1' && h.indexOf('192.168.1.255') < 0);
        const b = L.hosts({ ip: '10.0.5.9', prefix: 22 }, 400);
        assert.strictEqual(b.length, 400); assert(b[0].startsWith('10.0.5.') && b[300].startsWith('10.0.6.'));
    });

    let bridge;
    await check('the car finds the bridge by scanning the network (port 8582, its hello)', async () => {
        const t0 = Date.now();
        const f = await L.scan(L.hosts({ ip: '127.0.0.5', prefix: 24 }), L.PORT);
        assert(f, 'no bridge found');
        assert.strictEqual(f.hello.service, 'x5-link'); assert.strictEqual(f.hello.name, 'Test bridge'); assert.strictEqual(f.hello.paired, true);
        bridge = { host: f.host, port: f.port };
        assert(Date.now() - t0 < 10000);
    });

    const report = (data, uptime, code) => {
        const s = code ? Object.assign({}, st, { code }) : st;
        return L.report(bridge, s, { v: 1, car: L.carId(s.code), seq: L.nextSeq(st), t: Date.now(), uptime: uptime || 900, data });
    };

    await check('a report driving in after a long absence: sensors set, Connected, Arrived', async () => {
        const r = await report({ soc: 64.2, kw: 3.1, erangeKm: 29, frangeKm: 520, fuelPct: 55.1, outsideC: 8.5, speedKmh: 12 }, 1200);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(svc('charge').CurrentRelativeHumidity, 64);
        assert.strictEqual(pf.acc.charge.accessory.getService(api.hap.Service.Battery).values.BatteryLevel, 64);
        assert.strictEqual(svc('fuel').CurrentRelativeHumidity, 55);
        assert.strictEqual(svc('erange').CurrentAmbientLightLevel, 18);      // 29 km in miles
        assert.strictEqual(svc('frange').CurrentAmbientLightLevel, 323);
        assert.strictEqual(svc('outside').CurrentTemperature, 8.5);
        assert.strictEqual(svc('connected').OccupancyDetected, 1);
        assert.strictEqual(svc('arrived').MotionDetected, true);
        assert.strictEqual(svc('started').MotionDetected, false);
    });

    await check('a replayed report and a wrong code are refused, and change nothing', async () => {
        const body = JSON.stringify({ v: 1, car: L.carId(st.code), seq: st.seq, t: Date.now(), uptime: 5, data: { soc: 1 } });
        const r1 = await L.request(bridge.host, bridge.port, 'POST', '/x5link/state', body, { 'X-X5-Signature': L.sign(body, st.code) });
        assert.strictEqual(r1.status, 409); assert.strictEqual(r1.json.last, st.seq);
        const r2 = await report({ soc: 2 }, 900, L.newCode());
        assert.strictEqual(r2.status, 401);
        const tampered = body.replace('"soc":1', '"soc":3').replace('"seq":' + st.seq, '"seq":' + (st.seq + 10));
        const r3 = await L.request(bridge.host, bridge.port, 'POST', '/x5link/state', tampered, { 'X-X5-Signature': L.sign(body, st.code) });
        assert.strictEqual(r3.status, 401);
        assert.strictEqual(svc('charge').CurrentRelativeHumidity, 64);
    });

    await check('driving out of range: Leaving; standing and going quiet: no Leaving', async () => {
        await report({ speedKmh: 35 });
        pf.state.lastAt = Date.now() - 31000;
        pf.watch();
        assert.strictEqual(svc('leaving').MotionDetected, true);
        assert.strictEqual(svc('connected').OccupancyDetected, 0);
        pf.setFlag('leaving', false);
        await report({ speedKmh: 0 });
        pf.state.lastAt = Date.now() - 31000;
        pf.watch();
        assert.strictEqual(svc('leaving').MotionDetected, false);
    });

    await check('the car coming on at home after being off a while: Started, not Arrived', async () => {
        pf.setFlag('arrived', false);
        pf.state.lastAt = Date.now() - 11 * 60000;
        const r = await report({ speedKmh: 0, soc: 70 }, 40);
        assert.strictEqual(r.status, 200);
        assert.strictEqual(svc('started').MotionDetected, true);
        assert.strictEqual(svc('arrived').MotionDetected, false);
    });

    await check('charging: on with its power; stopping while reporting is Charge Done', async () => {
        pf.setFlag('started', false); pf.setFlag('chargedone', false);
        let r = await report({ speedKmh: 0, soc: 71, charging: true, chargeKw: 7.2 });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(svc('charging').OccupancyDetected, 1);
        assert.strictEqual(svc('chargekw').CurrentAmbientLightLevel, 7.2);
        assert.strictEqual(pf.acc.charge.accessory.getService(api.hap.Service.Battery).values.ChargingState, 1);
        r = await report({ speedKmh: 0, soc: 80, charging: false });
        assert.strictEqual(svc('charging').OccupancyDetected, 0);
        assert.strictEqual(svc('chargedone').MotionDetected, true);
        assert.strictEqual(svc('chargekw').CurrentAmbientLightLevel, 0.0001);
    });

    await check('the car asleep charged (90%+) is Charge Done; reporting again while charging is not Started', async () => {
        pf.setFlag('chargedone', false);
        await report({ speedKmh: 0, soc: 95, charging: true, chargeKw: 3.1 });
        pf.state.lastAt = Date.now() - 31000;
        pf.watch();
        assert.strictEqual(svc('chargedone').MotionDetected, true);
        assert.strictEqual(svc('charging').OccupancyDetected, 0);
        assert.strictEqual(svc('leaving').MotionDetected, false);
        pf.setFlag('started', false); pf.setFlag('arrived', false);
        pf.state.lastAt = Date.now() - 11 * 60000;
        await report({ speedKmh: 0, soc: 96, charging: true, chargeKw: 1.2 }, 30);
        assert.strictEqual(svc('started').MotionDetected, false);
        assert.strictEqual(svc('arrived').MotionDetected, false);
        assert.strictEqual(svc('charging').OccupancyDetected, 1);
        await report({ speedKmh: 0, soc: 70, charging: false });
    });

    await check('Homebridge restarted: the last values come back before the car reports', async () => {
        api.emit('shutdown');
        await sleep(100);
        const api2 = makeApi(storage, api);
        // Homebridge hands back the accessories it kept
        api.registered.forEach((a) => api2.registered.set(a.UUID, a));
        const pf2 = new plugin.X5LinkPlatform(log, { pairingCode: st.code }, api2);
        api2.registered.forEach((a) => pf2.configureAccessory(a));
        api2.emit('didFinishLaunching');
        await sleep(100);
        assert.strictEqual(pf2.acc.charge.service.values.CurrentRelativeHumidity, 70);
        assert.strictEqual(pf2.acc.frange.service.values.CurrentAmbientLightLevel, 323);
        assert.strictEqual(pf2.acc.connected.service.values.OccupancyDetected, 0);
        assert.strictEqual(api2.registered.size, 12, 'the same twelve accessories, none added twice');
        // a report with a seq at or below the kept one is refused after the restart too
        const body = JSON.stringify({ v: 1, car: L.carId(st.code), seq: st.seq, t: 0, uptime: 1, data: {} });
        api2.emit('shutdown'); pf = pf2; api = api2;
        await sleep(50);
        pf2.listen(); await sleep(100);
        const r = await L.request(bridge.host, bridge.port, 'POST', '/x5link/state', body, { 'X-X5-Signature': L.sign(body, st.code) });
        assert.strictEqual(r.status, 409);
        pf2.server.close();
    });

    await check('the car\'s charging state: held between reads, from power or a rising charge, off when it moves', async () => {
        const t = L.chargeTracker();
        assert.strictEqual(t.update({ speed: 0, soc: 50 }).on, false);
        assert.strictEqual(t.update({ speed: 0, soc: 50, kw: -7.1 }).on, true);
        assert.strictEqual(t.state.kw, 7.1);
        assert.strictEqual(t.update({ speed: 0, soc: 50 }).on, true, 'held while no fresh power reading');
        assert.strictEqual(t.update({ speed: 0, soc: 52, kw: 0.1 }).on, false, 'power stopped');
        assert.strictEqual(t.update({ speed: 0, soc: 53 }).on, true, 'the charge rose a point while standing');
        assert.strictEqual(t.update({ speed: 12, soc: 53 }).on, false, 'moving');
        assert.strictEqual(t.update({ speed: 0, soc: 53.5 }).on, false);
        assert.strictEqual(t.update({ speed: 0, soc: 52, engineOn: true, kw: -3 }).on, false, 'the engine charging the battery is not plugged-in charging');
    });

    await check('no bridge on the network: the scan ends with nothing', async () => {
        const f = await L.scan(['127.0.0.9', '127.0.0.10'], 8583);
        assert.strictEqual(f, null);
    });

    fs.rmSync(storage, { recursive: true, force: true });
    fs.rmSync(carDir, { recursive: true, force: true });
    console.log(ok + ' passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
