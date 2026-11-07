'use strict';
/**
 * homebridge-x5-link - your car in Apple Home, from the Home Link app on its head unit.
 *
 * The app finds this plugin on the home Wi-Fi (it tries every address on port 8582 for GET /x5link/hello) and
 * sends a report every few seconds while the car is on and in Wi-Fi range (POST /x5link/state), signed with the
 * pairing code the app shows (HMAC-SHA256 of the body) and numbered (seq, always rising, so a report can't be
 * replayed). This plugin turns the reports into HomeKit sensors and keeps their last values while the car is
 * away or off:
 *
 *   X5 Charge          the high-voltage battery's charge (a humidity sensor reads it as %, and a battery service)
 *   X5 Fuel            the tank's level, %
 *   X5 Electric Range  miles or km (a light sensor: the Home app shows the number in lux)
 *   X5 Fuel Range      the same
 *   X5 Outside         the outside temperature
 *   X5 Connected       occupancy: detected while the car is on and reporting
 *   X5 Arrived         motion for a minute when the car comes into range already driving after being away
 *   X5 Started         motion for a minute when the car comes on at home (the head unit just started)
 *   X5 Leaving         motion for a minute when the car drives out of range
 *   X5 Charging        occupancy: detected while the car says it is charging (its head unit stays on while it charges)
 *   X5 Charge Power    the power going into the battery, kW (a light sensor: shown in lux)
 *   X5 Charge Done     motion for a minute when charging stops, or the car goes to sleep charged (90% or more)
 *
 * No dependencies: Node's own http and crypto, and Homebridge's API.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PLUGIN_NAME = 'homebridge-x5-link';
const PLATFORM_NAME = 'X5Link';
const VERSION = require('./package.json').version;
const PORT = 8582;
const ONLINE_MS = 30000;          // no report for this long: the car is off or out of range
const AWAY_MS = 10 * 60000;       // silent this long, then reporting again: a new visit (arrived or started)
const STARTED_UPTIME_S = 180;     // the head unit up less than this at a new visit: the car came on at home
const LEAVING_KMH = 3;            // the last report this fast before going quiet: it drove away
const PULSE_MS = 60000;           // how long Arrived / Started / Leaving show motion
const MAX_BODY = 16384;

const normCode = (c) => String(c || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
const sign = (body, code) => crypto.createHmac('sha256', normCode(code)).update(body).digest('hex');
const carId = (code) => crypto.createHash('sha256').update('x5-link car ' + normCode(code)).digest('hex').slice(0, 12);
const isNum = (v) => typeof v === 'number' && isFinite(v);
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/*
 * The sensors: key, the name shown, and how a report sets it. Each is its own accessory so the Home app shows it
 * as its own tile and automations can use it.
 */
const SENSORS = [
    { key: 'charge', name: 'Charge', kind: 'percent', from: (d) => d.soc, battery: true },
    { key: 'fuel', name: 'Fuel', kind: 'percent', from: (d) => d.fuelPct },
    { key: 'erange', name: 'Electric Range', kind: 'distance', from: (d) => d.erangeKm },
    { key: 'frange', name: 'Fuel Range', kind: 'distance', from: (d) => d.frangeKm },
    { key: 'outside', name: 'Outside', kind: 'temperature', from: (d) => d.outsideC },
    { key: 'connected', name: 'Connected', kind: 'occupancy' },
    { key: 'arrived', name: 'Arrived', kind: 'motion' },
    { key: 'started', name: 'Started', kind: 'motion' },
    { key: 'leaving', name: 'Leaving', kind: 'motion' },
    { key: 'charging', name: 'Charging', kind: 'occupancy' },
    { key: 'chargekw', name: 'Charge Power', kind: 'power', from: (d) => (d.charging ? d.chargeKw : 0) },
    { key: 'chargedone', name: 'Charge Done', kind: 'motion' },
];

class X5LinkPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config || {};
        this.api = api;
        this.hap = api.hap;
        this.cached = new Map();
        this.acc = {};
        this.prefix = (this.config.prefix === undefined ? 'X5' : String(this.config.prefix)).trim();
        this.miles = this.config.units !== 'km';
        this.port = PORT;   // (the car looks for the bridge on this port)
        this.code = normCode(this.config.pairingCode);
        this.file = path.join(api.user.storagePath(), 'x5-link.json');
        this.state = this.load();
        this.pulses = {};
        if (!this.code) this.log.warn('No pairing code yet: open the Home Link app in the car, and enter the code it shows in this plugin\'s settings.');
        else if (this.code.length !== 12) this.log.warn('The pairing code should be 12 characters (it is ' + this.code.length + '): check it against the Home Link app.');
        api.on('didFinishLaunching', () => this.launch());
        api.on('shutdown', () => { this.save(); if (this.server) this.server.close(); if (this.timer) clearInterval(this.timer); });
    }

    /** Homebridge gives back the accessories it kept from the last run. */
    configureAccessory(accessory) { this.cached.set(accessory.UUID, accessory); }

    load() {
        try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Object.assign({ values: {}, lastSeq: 0, lastAt: 0, lastSpeed: 0 }, s); } catch (e) { return { values: {}, lastSeq: 0, lastAt: 0, lastSpeed: 0 }; }
    }
    save() {
        try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.state)); fs.renameSync(this.file + '.tmp', this.file); } catch (e) { this.log.warn('could not save ' + this.file + ': ' + e.message); }
    }

    launch() {
        const { Service } = this.hap;
        const keep = new Set();
        for (const s of SENSORS) {
            const uuid = this.hap.uuid.generate('x5-link:' + s.key);
            keep.add(uuid);
            const name = (this.prefix ? this.prefix + ' ' : '') + s.name;
            let a = this.cached.get(uuid);
            if (!a) {
                a = new this.api.platformAccessory(name, uuid);
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [a]);
            }
            a.getService(Service.AccessoryInformation)
                .setCharacteristic(this.hap.Characteristic.Manufacturer, 'X5 Link')
                .setCharacteristic(this.hap.Characteristic.Model, 'Home Link ' + s.name)
                .setCharacteristic(this.hap.Characteristic.SerialNumber, 'x5-' + s.key)
                .setCharacteristic(this.hap.Characteristic.FirmwareRevision, VERSION);
            const type = { percent: Service.HumiditySensor, distance: Service.LightSensor, power: Service.LightSensor, temperature: Service.TemperatureSensor, occupancy: Service.OccupancySensor, motion: Service.MotionSensor }[s.kind];
            const svc = a.getService(type) || a.addService(type, name);
            if (s.battery) {
                const BatteryService = Service.Battery || Service.BatteryService;
                a.getService(BatteryService) || a.addService(BatteryService, name + ' Battery');
            }
            this.acc[s.key] = { spec: s, accessory: a, service: svc };
        }
        // accessories of an older version that are no longer made
        const gone = [...this.cached.values()].filter((a) => !keep.has(a.UUID));
        if (gone.length) this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, gone);
        // the last values, until the car reports again
        this.show(this.state.values || {});
        this.setFlag('connected', false);
        this.setFlag('charging', this.state.values && this.state.values.charging === true && Date.now() - (this.state.lastAt || 0) < ONLINE_MS);
        ['arrived', 'started', 'leaving', 'chargedone'].forEach((k) => this.setFlag(k, false));
        this.timer = setInterval(() => this.watch(), 5000);
        this.listen();
    }

    /** Sets the value sensors from a report's data (or the kept values). */
    show(d) {
        const C = this.hap.Characteristic;
        for (const s of SENSORS) {
            if (!s.from) continue;
            const v = s.from(d);
            if (!isNum(v)) continue;
            const svc = this.acc[s.key].service;
            if (s.kind === 'percent') svc.updateCharacteristic(C.CurrentRelativeHumidity, Math.max(0, Math.min(100, Math.round(v))));
            if (s.kind === 'distance') svc.updateCharacteristic(C.CurrentAmbientLightLevel, Math.max(0.0001, Math.round(this.miles ? v / 1.609344 : v)));
            if (s.kind === 'power') svc.updateCharacteristic(C.CurrentAmbientLightLevel, Math.max(0.0001, Math.round(v * 10) / 10));
            if (s.kind === 'temperature') svc.updateCharacteristic(C.CurrentTemperature, Math.max(-50, Math.min(100, Math.round(v * 10) / 10)));
            if (s.battery) {
                const b = this.acc[s.key].accessory.getService(this.hap.Service.Battery || this.hap.Service.BatteryService);
                b.updateCharacteristic(C.BatteryLevel, Math.max(0, Math.min(100, Math.round(v))));
                b.updateCharacteristic(C.StatusLowBattery, v < 15 ? C.StatusLowBattery.BATTERY_LEVEL_LOW : C.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                // charging: as the car says (held between its battery reads)
                const charging = d.charging === true;
                b.updateCharacteristic(C.ChargingState, charging ? C.ChargingState.CHARGING : C.ChargingState.NOT_CHARGING);
            }
        }
    }
    setFlag(key, on) {
        const C = this.hap.Characteristic, svc = this.acc[key].service;
        if (this.acc[key].spec.kind === 'occupancy') svc.updateCharacteristic(C.OccupancyDetected, on ? C.OccupancyDetected.OCCUPANCY_DETECTED : C.OccupancyDetected.OCCUPANCY_NOT_DETECTED);
        else svc.updateCharacteristic(C.MotionDetected, !!on);
    }
    pulse(key, why) {
        this.log.info(this.acc[key].spec.name + ': ' + why);
        this.setFlag(key, true);
        clearTimeout(this.pulses[key]);
        this.pulses[key] = setTimeout(() => this.setFlag(key, false), PULSE_MS);
    }

    /** Every 5 s: the car gone quiet is off or out of range; driving when it went quiet, it left. */
    watch() {
        if (!this.online) return;
        if (Date.now() - this.state.lastAt < ONLINE_MS) return;
        this.online = false;
        this.setFlag('connected', false);
        if (this.state.lastSpeed > LEAVING_KMH) this.pulse('leaving', 'drove out of Wi-Fi range at ' + Math.round(this.state.lastSpeed) + ' km/h');
        else this.log.info('the car went quiet (switched off or out of range while standing)');
        // quiet while charging: the car went to sleep; charged if it had reached 90%
        const v = this.state.values || {};
        if (v.charging === true) {
            this.state.values = Object.assign({}, v, { charging: false });
            this.setFlag('charging', false);
            this.show(this.state.values);
            if (isNum(v.soc) && v.soc >= 90) this.pulse('chargedone', 'the car went to sleep charged (' + Math.round(v.soc) + '%)');
        }
        this.save();
    }

    /** A report taken: the sensors set, and a new visit told apart as arrived or started. */
    take(p) {
        const now = Date.now(), d = p.data || {};
        const silent = now - (this.state.lastAt || 0);
        if (!this.online) {
            this.online = true;
            this.setFlag('connected', true);
            // (a car charging when it reports again was standing on its charger: neither arrived nor started)
            if (silent >= AWAY_MS && d.charging === true) this.log.info('the car reports again while charging');
            else if (silent >= AWAY_MS) {
                if (isNum(p.uptime) && p.uptime < STARTED_UPTIME_S) this.pulse('started', 'the car came on at home');
                else this.pulse('arrived', 'came into Wi-Fi range' + (isNum(d.speedKmh) ? ' at ' + Math.round(d.speedKmh) + ' km/h' : ''));
            } else this.log.info('the car is back after ' + Math.round(silent / 1000) + ' s');
        }
        // charging on and off as the car says; stopping while it still reports: charge done
        const was = this.state.values && this.state.values.charging === true;
        if (typeof d.charging === 'boolean') {
            this.setFlag('charging', d.charging);
            if (was && !d.charging && (!isNum(d.speedKmh) || d.speedKmh < 1)) this.pulse('chargedone', 'charging stopped' + (isNum(d.soc) ? ' at ' + Math.round(d.soc) + '%' : ''));
            else if (!was && d.charging) this.log.info('charging' + (isNum(d.chargeKw) ? ' at ' + d.chargeKw + ' kW' : ''));
        }
        this.state.lastSeq = p.seq;
        this.state.lastAt = now;
        this.state.lastSpeed = isNum(d.speedKmh) ? d.speedKmh : 0;
        const keep = {};
        for (const k of Object.keys(d)) if (isNum(d[k]) || typeof d[k] === 'string' || typeof d[k] === 'boolean') keep[k] = d[k];
        this.state.values = Object.assign({}, this.state.values, keep);
        this.state.app = p.app;
        this.show(d);
        if (!this.savedAt || now - this.savedAt > 60000) { this.savedAt = now; this.save(); }
    }

    listen() {
        const reply = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
        this.server = http.createServer((req, res) => {
            const url = String(req.url || '').split('?')[0];
            if (req.method === 'GET' && url === '/x5link/hello') {
                return reply(res, 200, { service: 'x5-link', name: this.config.name || 'Homebridge', version: VERSION, paired: !!this.code });
            }
            if (req.method !== 'POST' || url !== '/x5link/state') return reply(res, 404, { error: 'not found' });
            let body = '', big = false;
            req.setEncoding('utf8');
            req.on('data', (c) => { body += c; if (body.length > MAX_BODY) { big = true; req.destroy(); } });
            req.on('end', () => {
                if (big) return undefined;
                if (!this.code) return reply(res, 401, { error: 'no pairing code in the plugin\'s settings yet' });
                const sig = req.headers['x-x5-signature'] || '';
                if (!safeEqual(sig, sign(body, this.code))) {
                    if (!this.badLogged || Date.now() - this.badLogged > 60000) { this.badLogged = Date.now(); this.log.warn('a report with the wrong signature from ' + req.socket.remoteAddress + ': is the pairing code the one the Home Link app shows?'); }
                    return reply(res, 401, { error: 'the pairing code in Homebridge is not this car\'s' });
                }
                let p;
                try { p = JSON.parse(body); } catch (e) { return reply(res, 400, { error: 'not JSON' }); }
                if (!p || p.car !== carId(this.code) || !isNum(p.seq)) return reply(res, 400, { error: 'not a report' });
                if (p.seq <= (this.state.lastSeq || 0)) return reply(res, 409, { error: 'old report', last: this.state.lastSeq });
                this.take(p);
                return reply(res, 200, { ok: true });
            });
            return undefined;
        });
        this.server.on('error', (e) => this.log.error('could not listen on port ' + this.port + ': ' + e.message + (e.code === 'EADDRINUSE' ? ' (another program uses it)' : '')));
        this.server.listen(this.port, () => this.log.info('listening for the car on port ' + this.port + (this.code ? '' : ' (no pairing code yet)')));
    }
}

module.exports = (api) => { api.registerPlatform(PLATFORM_NAME, X5LinkPlatform); };
module.exports.X5LinkPlatform = X5LinkPlatform;
module.exports.sign = sign;
module.exports.carId = carId;
