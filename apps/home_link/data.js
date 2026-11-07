'use strict';
/**
 * data.js - every reading both apps show (Cluster Centre's pages, Cluster Layouts' digital layout), in one object (data()), in base units: speeds km/h,
 * temperatures °C, pressures bar, torque Nm, power kW.
 *
 *   car signals (kit/car.js): speed, rpm, gear, stage, oil, coolant, torque, g (long / lat)
 *   MDrive.dataDisplayGearbox: the S / M programme
 *   EnvironmentalInformation.ExteriorTemperature: outside
 *   BasicDataSet.basicDataSet: gearbox oil, the xDrive split (rear %, when the car fills it)
 *   Efficiencytainment2.statusBatteryTemperature: the battery's temperature (avg / min / max)
 *   KombiIF.statusDisplayElectricalPowerDistribution: the car's power distribution figures
 *   the engine unit over UDS (config.dme, as M Vitals reads it): intake air, fuel pressures (high, low), boost
 *     target and actual, ignition timing; the gearbox unit: its oil temperature; the transfer case (config.xdrive):
 *     front axle torque, for the split when the car's own signal has none
 *   eDrive Live, through the shared folder: battery charge and power
 *
 * The diagnostic reads are the slow part: only the values the page on screen needs are read, about twice a
 * second (want(keys)); the rest every 10 s; none while nothing is shown or nothing wants them (the car shows
 * "Diagnostic mode active" while they run).
 */
const Car = require('./kit/car');
const { Diag } = require('./kit/diag');
const { DidReader } = require('./kit/dids');
const { startProviders } = require('./providers');

const isNum = (v) => typeof v === 'number' && isFinite(v);
const PROGRAMS = { S_MINUS_PROGRAMM: 'S', M_MINUS_PROGRAMM: 'M', 1: 'S', 2: 'M' };
const DME_KEYS = ['iat', 'hpfp', 'lpfp', 'timing', 'boostCtl', 'egs', 'lmv'];
const SPLIT_OK = (q) => q === undefined || q === null || q === 2 || q === 10 || q === 'SIGNALWERT_IST_GUELTIG' || q === 'SIGNALWERT_IST_GUELTIG__REKALIBRIERUNGSBEDARF';

/*
 * The driving mode, as the car's FES service sends it: BMW's FES mode table (TAB_FES_MODUS_ARG in the G05's
 * body unit, BDC_G05), by name or number, shown as the stock cluster names them. A plug-in hybrid's modes
 * (PHEV_...) carry the eDrive mode in the name: HYBRID, ELECTRIC, BATTERY CONTROL.
 */
const FES_MODES = [
    [0x01, 'SPORT_DYNAMIC', 'SPORT'], [0x02, 'SPORT_EXPERT', 'SPORT+'], [0x03, 'SPORT_INDIVIDUAL', 'SPORT INDIVIDUAL'],
    [0x04, 'COMFORT', 'COMFORT'], [0x05, 'COMFORT_PLUS', 'COMFORT+'], [0x06, 'COMFORT_INDIVIDUAL', 'COMFORT INDIVIDUAL'],
    [0x07, 'ECO_PRO_EFFICIENT', 'ECO PRO'], [0x08, 'ECO_PRO_PLUS', 'ECO PRO+'], [0x09, 'ECO_PRO_INDIVIDUAL', 'ECO PRO INDIVIDUAL'],
    [0x0A, 'ADAPTIVE', 'ADAPTIVE'], [0x0B, 'OFFROAD_ICE', 'OFFROAD SNOW'], [0x0C, 'OFFROAD_SMOOTH', 'OFFROAD GRAVEL'],
    [0x0D, 'OFFROAD_GRIP', 'OFFROAD SAND'], [0x0E, 'OFFROAD_ROUGH', 'OFFROAD ROCK'],
    [0x0F, 'PHEV_SPORT_STANDARD', 'SPORT'], [0x10, 'PHEV_SPORT_INDIVIDUAL', 'SPORT INDIVIDUAL'],
    [0x11, 'PHEV_HYBRID_STANDARD', 'HYBRID'], [0x12, 'PHEV_HYBRID_ECO', 'HYBRID ECO PRO'], [0x13, 'PHEV_HYBRID_COMFORT', 'HYBRID COMFORT'],
    [0x14, 'PHEV_ELECTRIC_STANDARD', 'ELECTRIC'], [0x15, 'PHEV_ELECTRIC_INDIVIDUAL', 'ELECTRIC INDIVIDUAL'],
    [0x16, 'PHEV_BATTERY_CONTROL', 'BATTERY CONTROL'],
    // by name only (number not known): a plug-in hybrid's Sport Plus is its XtraBoost
    [-1, 'SPORT_PLUS', 'SPORT+'], [-1, 'PHEV_SPORT_PLUS', 'XTRABOOST'],
];
const norm = (str) => String(str).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Every leaf of a value: { key (its field name), v }. */
function leaves(v, out, key) {
    out = out || [];
    if (v && typeof v === 'object') Object.keys(v).forEach((k) => leaves(v[k], out, k));
    else out.push({ key: key || '', v });
    return out;
}
/**
 * The mode a value names: an enum name from the table (the longest that matches, so PHEV_ELECTRIC_INDIVIDUAL
 * before ELECTRIC), else a number from it in a field named like a mode; null for none or an invalid value.
 * XtraBoost (a boost state some modes allow) is added when a string says it is active.
 * ice: a petrol or diesel car (Settings > Vehicle): its own modes only (Sport, Sport+, Comfort, Eco Pro,
 * Adaptive, the off-road ones), never a plug-in hybrid's names, and no XtraBoost.
 */
function modeOf(v, ice) {
    const ls = leaves(v);
    const TABLE = ice ? FES_MODES.filter((m) => !/^PHEV_/.test(m[1])) : FES_MODES;
    let best = null;
    ls.filter((l) => typeof l.v === 'string').forEach((l) => {
        const s = norm(l.v);
        if (/INVALID|UNGUELTIG|NOT_|_NOT|UNAVAILABLE|INITIALI/.test(s)) return;
        TABLE.forEach((m) => {
            const hit = s === m[1] || s.endsWith('_' + m[1]) || s.startsWith(m[1] + '_') || s.indexOf('_' + m[1] + '_') >= 0;
            if (hit && (!best || m[1].length > best[1].length)) best = m;
        });
    });
    if (!best) {
        const n = ls.find((l) => typeof l.v === 'number' && /mode|modus|switch|fes|programm|state|status|value/i.test(l.key) && TABLE.some((m) => m[0] === l.v));
        if (n) best = TABLE.find((m) => m[0] === n.v);
    }
    if (!best) return null;
    const boost = !ice && ls.some((l) => typeof l.v === 'string' && /XTRA_?BOOST|EXTRA_?BOOST/.test(norm(l.v)) && !/NOT|INACTIVE|OFF|INVALID/.test(norm(l.v)));
    return boost && !/XTRABOOST/.test(best[2]) ? best[2] + ' XTRABOOST' : best[2];
}

/**
 * The ranges in a value of KombiIF.statusRangeTankStatus, by field name (they differ by car): range /
 * Reichweite with electric (elec, ev, hv, bev, batt) -> carErange, total -> carTrange, else carFrange; a fuel
 * level -> fuelLevel. Kilometres; 0xFFFE and up are invalid. Returns { name: number }.
 */
function rangesOf(v) {
    const out = {};
    leaves(v).forEach((l) => {
        const n = l.v, key = String(l.key).toLowerCase();
        if (typeof n !== 'number' || !isFinite(n) || n < 0 || n >= 0xFFFE) return;
        if (/range|reichweite/.test(key)) {
            if (/elec|(^|[^a-z])ev|hv|bev|batt|edrive/.test(key)) out.carErange = n;
            else if (/total|gesamt|overall|sum/.test(key)) out.carTrange = n;
            else out.carFrange = n;
        } else if (/level|fill|inhalt|volume|liter/.test(key) && /fuel|tank|kraftstoff/.test(key)) {
            // the tank's own level (litres), not its left/right halves (a saddle tank's; 0 and 77 on a G05 PHEV
            // with 38 L in its 69 L tank)
            const half = /left|right|links|rechts/.test(key);
            if (!half) { out.fuelLevel = n; out.fuelWhole = true; } else if (!out.fuelWhole && out.fuelLevel === undefined) out.fuelLevel = n;
        }
    });
    delete out.fuelWhole;
    return out;
}

/** Find objects holding `key` anywhere in a signal's value. */
function entries(v, key, out) {
    out = out || [];
    if (v && typeof v === 'object') { if (key in v) out.push(v); else Object.keys(v).forEach((k) => entries(v[k], key, out)); }
    return out;
}

function startData(ctx, opts) {
    const { log } = ctx;
    const cfg = ctx.spec.config || {}, S = cfg.scaling || {};
    const sc = (k, raw) => {
        const c = S[k];
        if (!c || raw === undefined || raw === null || raw === c.invalid || typeof raw !== 'number' || (c.invalidFrom != null && raw >= c.invalidFrom)) return null;
        if (c.signed16 && raw > 32767) raw -= 65536;
        return raw * c.factor + (c.offset || 0);
    };
    /** The first number in a value whose field name matches re (else the first number at all). */
    const numberIn = (v, re) => { const ls = leaves(v).filter((l) => typeof l.v === 'number'); const m = ls.find((l) => re.test(l.key)) || ls[0]; return m ? m.v : undefined; };
    const car = new Car(ctx, ['rpm', 'speed', 'temps', 'gear', 'torque', 'accel']);
    car.onSample(() => fresh_());
    const x = { at: {} };          // readings that are not the kit's: value and when it came
    /* fresh: whoever shows the data hears of each new reading at once (the engine draws it then, not at its
     * next tick) */
    const freshFns = [];
    /** Settings > Vehicle: 'ice' for a petrol or diesel car (no high-voltage battery), else a plug-in hybrid. */
    /*
     * The vehicle (Settings > Vehicle): a plug-in hybrid, a petrol or diesel car, or Auto (the default): found
     * from the car itself, as other apps identify a car before they assume anything about it: a plug-in hybrid's
     * drive mode names (PHEV_...) or an answer from its high-voltage battery unit say plug-in hybrid; that unit
     * not answering (with the diagnostic link up) says petrol or diesel. Until then: a plug-in hybrid.
     */
    const setting = (k) => (ctx.settings && ctx.settings.get ? ctx.settings.get(k) : undefined);
    const detected = { vehicle: null, why: 'not yet known' };
    let dmeAnswered = false;
    const detect = (v, why) => { if (detected.vehicle !== v) { detected.vehicle = v; detected.why = why; log.info('vehicle: ' + v + ' (' + why + ')'); } };
    const vehicleNow = () => (setting('vehicle') === 'ice' || setting('vehicle') === 'phev' ? setting('vehicle') : detected.vehicle || 'phev');
    const ice = () => vehicleNow() === 'ice';
    /** Settings > Battery readings: 'off' leaves the high-voltage battery unit alone (charge and power from
     * eDrive Live or the car only). */
    const batteryReads = () => setting('batteryReads') !== 'off';
    const fresh_ = () => { for (const f of freshFns) { try { f(); } catch (e) { /* the listener's own */ } } };
    const put = (k, v) => { if (isNum(v)) { const ch = x[k] !== v; x[k] = v; x.at[k] = Date.now(); if (ch) fresh_(); } };
    const fresh = (k, ms) => isNum(x[k]) && Date.now() - x.at[k] < (ms || 30000);
    const status = {};
    const watch = (iface, handlers, what, o) => ctx.signals.watch(iface, '1', handlers, log, o)
        .then((s) => { status[what] = s.error ? 'error: ' + s.error : 'subscribed'; });

    watch('de.bmw.infotainment.misc.MDrive', {
        dataDisplayGearbox: (v) => { const raw = v && typeof v === 'object' ? (v.dataDisplayGearbox !== undefined ? v.dataDisplayGearbox : Object.keys(v).map((k) => v[k])[0]) : v; x.mode = PROGRAMS[raw] || null; },
    }, 'drive programme');
    // the driving experience switch and, on a plug-in hybrid, the eDrive mode
    // (each signal's raw value is kept for the Signals screen; only its first 20 distinct values go to the log,
    // since the boost pressure in it changes all the time while driving)
    const raw = {}, rawLogged = {};
    const fes = (name) => (v) => {
        const j = JSON.stringify(v);
        if (raw[name] !== j) {
            raw[name] = j;
            const n = rawLogged[name] = (rawLogged[name] || 0) + 1;
            if (n <= 20) log.info('raw ' + name + ': ' + j.slice(0, 400) + (n === 20 ? '  (further changes not logged)' : ''));
        }
        if (!/Switch/.test(name)) return;
        // a plug-in hybrid's mode names identify one
        if (setting('vehicle') !== 'ice' && /PHEV_/.test(JSON.stringify(v))) detect('phev', 'its drive modes are a plug-in hybrid\'s');
        const m = modeOf(v, ice());
        // the HMI's switch field is the one the stock cluster names; the other only while that one says nothing
        const fromHmi = /HMI/.test(name);
        if (m && (fromHmi || x.driveModeFrom !== 'statusFESVehicleDynamicSwitchHMI' || Date.now() - (x.at.driveMode || 0) > 60000)) { x.driveMode = m; x.at.driveMode = Date.now(); x.driveModeFrom = name; }
    };
    watch('de.bmw.infotainment.drivingexcitement.FES', {
        statusFESVehicleDynamicSwitchHMI: fes('statusFESVehicleDynamicSwitchHMI'),
        // the sport display's boost (tenths of a bar over atmosphere; 254 and up: none): boost without diagnostics
        statusSwitchDriveDynamicSport2: (v) => {
            fes('statusSwitchDriveDynamicSport2')(v);
            const b = v && typeof v === 'object' ? v.displayBoostPressure : undefined;
            if (isNum(b) && b >= 0 && b < 254) put('boostCar', b / 10);
        },
    }, 'driving mode');
    watch('de.bmw.infrastructure.EnvironmentalInformation', { ExteriorTemperature: (v) => put('outside', sc('ambient', v && v.temperatureExterior)) }, 'outside temperature');
    watch('de.bmw.infrastructure.analytics.BasicDataSet', {
        basicDataSet: (v) => {
            const g = sc('gearboxTemp', v.valueTemperatureTransmissionOil);
            if (isNum(g) && g > -40 && g < 160) put('gearbox', g);
            const q = v.qualifierValueDistributionLongitudinalTorqueRearAxisFrontAxis, split = SPLIT_OK(q) ? sc('torqueSplitRear', v.valueDistributionLongitudinalTorqueRearAxisFrontAxis) : null;
            if (isNum(split) && split > 0 && split <= 100) put('splitRear', split);
        },
    }, 'basic data set');
    watch('de.bmw.infotainment.drivingexcitement.Efficiencytainment2', {
        statusBatteryTemperature: (v) => {
            const e = entries(v, 'actualValueTemperatureHighVoltageStorage')[0];
            const bt = (raw) => { const t = sc('batteryTemp', raw); return isNum(t) && t > -30 && t < 70 ? t : null; };
            if (e) { put('battTemp', bt(e.actualValueTemperatureHighVoltageStorage)); put('battMin', bt(e.actualValueTemperatureHighVoltageStorageMinimum)); put('battMax', bt(e.actualValueTemperatureHighVoltageStorageMaximum)); }
        },
    }, 'battery temperature', { pollMs: 30000 });
    /* the car's ranges (KombiIF.statusRangeTankStatus, as installed apps declare it): the fields' names
     * differ by car, so numbers are picked by their names - range / Reichweite, electric (elec, ev, hv, bev)
     * or fuel (fuel, tank, kraftstoff, combustion), and the tank's level; kilometres, invalid at 0xFFFF and up */
    const pickRanges = (v) => { const r = rangesOf(v); Object.keys(r).forEach((k) => put(k, r[k])); };
    // steering angle and yaw rate (as installed apps declare them; scaling in config.scaling, raw values shown)
    watch('de.bmw.chassis.SteeringAngle', {
        ActualSteeringAngleDriver: (v) => { fes('ActualSteeringAngleDriver')(v); const a = sc('steer', numberIn(v, /angle|winkel/i)); if (isNum(a) && Math.abs(a) < 900) put('steer', a); },
    }, 'steering angle');
    watch('de.bmw.infotainment.vehicle.CDS2', {
        statusYawVelocityVehicle: (v) => { fes('statusYawVelocityVehicle')(v); const y = sc('yaw', numberIn(v, /yaw|gier|velocity/i)); if (isNum(y) && Math.abs(y) < 160) put('yaw', y); },
    }, 'yaw rate');
    // the engine's state (running, stopped, and why when the car says): strings shown as the car sends them
    watch('de.bmw.infotainment.vehicle.CDS', {
        statusEngineStatus: (v) => {
            fes('statusEngineStatus')(v);
            const ss = leaves(v).filter((l) => typeof l.v === 'string').map((l) => norm(l.v));
            const run = ss.find((t) => /RUNNING|STARTED|LAEUFT|ENGINE_ON|COMBUSTION_ON/.test(t) && !/NOT_/.test(t));
            const stop = ss.find((t) => /STOP|OFF|NOT_RUNNING|STILLSTAND/.test(t));
            if (run) { x.engineState = 'on'; x.at.engineState = Date.now(); } else if (stop) { x.engineState = 'off'; x.at.engineState = Date.now(); }
            const why = ss.find((t) => /REASON|GRUND|REQUEST|DEMAND|ANFORDERUNG/.test(t));
            if (why) x.startWhy = why.replace(/_/g, ' ');
        },
    }, 'engine status');
    // a range the car's vehicle information service sends (as installed apps declare it)
    watch('de.bmw.infrastructure.VehicleInformation', {
        Range: (v) => { fes('Range')(v); pickRanges(v); },
    }, 'range');
    watch('de.bmw.infotainment.KombiIF', {
        statusRangeTankStatus: (v) => { fes('statusRangeTankStatus')(v); pickRanges(v); },
        // the cluster's own electric range (in this car's catalog), in the unit the cluster shows: miles on a car
        // set to miles (read as km it came out 1.6 times too low), so by the app's speed unit; kept here in km.
        // (Its displayRangeMaximum is the scale's end, not a range.)
        displayRangeElectricVehicle: (v) => {
            fes('displayRangeElectricVehicle')(v);
            const n = numberIn(v, /^displayRangeElectricVehicle$/);
            const miles = !(ctx.settings && ctx.settings.get && ctx.settings.get('speedUnit') === 'kmh');
            if (isNum(n) && n >= 0 && n < 0xFFFE) put('carErange', miles ? n * 1.609344 : n);
        },
        statusDisplayElectricalPowerDistribution: (v) => {
            const e = entries(v, 'displayRepartitionDriveElectricPower')[0];
            if (!e || e.displayRepartitionDriveElectricPower === 255) return;
            ['Drive', 'AirConditioning', 'ElectricSeatHeater'].forEach((k, i) => {
                const raw = e['displayRepartition' + k + (k === 'ElectricSeatHeater' ? '' : 'ElectricPower')];
                if (isNum(raw) && raw !== 255) put(['pdDrive', 'pdClimate', 'pdSeats'][i], raw);
            });
        },
    }, 'power distribution', { pollMs: 15000 });

    /* ---------- the engine unit, the gearbox unit and the transfer case over UDS ---------- */
    const bat = Object.assign({ hvV: [], hvI: [], soc: [] }, cfg.battery || {});
    const dme = Object.assign({ ecu: 18 }, cfg.dme || {}), xcfg = Object.assign({ front: [], gearRatios: [] }, cfg.xdrive || {});
    const link = new Diag(ctx.signals, log);
    link.quiet = true;
    link.init();
    const rd = new DidReader(link, { ecu: dme.ecu });
    const fail = {}, tried = {};
    let baro = 101.3, baroT = 0, wanted = [], wantedT = 0, timer = null;
    async function readOne(k) {
        if (k === 'boostCtl') {
            if (Date.now() - baroT > 60000) { baroT = Date.now(); const b = await rd.value('baro', dme.baro); if (b !== null) baro = b; }
            const tg = await rd.value('boostTarget', dme.boostTarget);
            if (tg === null) return null;
            const ac = await rd.value('boostActual', dme.boostActual);
            put('boostTarget', (tg - baro) / 100);
            if (ac !== null) put('boostActual', (ac - baro) / 100);
            return tg;
        }
        if (k === 'lmv') { const v = await rd.value('lmvFront', xcfg.front); if (v !== null) put('lmvFront', v); return v; }
        // the high-voltage battery (SME, ecu 7): its power from voltage x current, and its charge (eDrive Live's
        // reads, confirmed on the X5 45e), so the apps don't depend on it sharing
        if ((k === 'hv' || k === 'hvSoc') && (ice() || !batteryReads())) return null;   // a petrol or diesel car has no HV battery
        if (k === 'hv') {
            // the current every turn; the voltage (it moves slowly) every 2 s
            if (!isNum(hvVolt) || Date.now() - hvVoltT > 2000) { const v = await rd.value('hvV', bat.hvV); if (v !== null) { hvVolt = v; hvVoltT = Date.now(); } }
            if (!isNum(hvVolt)) return null;
            const a = await rd.value('hvI', bat.hvI);
            if (a !== null) put('hvKw', (bat.powerSign || -1) * hvVolt * a / 1000);
            return a;
        }
        if (k === 'hvSoc') { const v = await rd.value('hvSoc', bat.soc); if (v !== null) put('hvSoc', v); return v; }
        const v = await rd.value(k, dme[k]);
        if (v !== null) put(k === 'egs' ? 'gearbox' : k, v);
        return v;
    }
    let slowAt = 0, hvVolt = null, hvVoltT = 0, queue = [];
    /*
     * One turn: the battery's current first (its power is the most watched reading: ~4 times a second), then
     * one other reading, round-robin: what the layout wants, every DME reading every 10 s, the charge every 10 s.
     * Only while shown: each read puts "Diagnostic mode active" on the cluster.
     */
    let lastPollErr = '';
    async function poll() {
        const on = !opts || !opts.shown || opts.shown();
        const now = Date.now(), wantedNow = on && now - wantedT < 3000;
        const usable = (k) => (k === 'lmv' ? xcfg.front.length : k === 'boostCtl' ? (dme.boostTarget || []).length
            : k === 'hv' ? !ice() && batteryReads() && bat.hvV.length && bat.hvI.length : k === 'hvSoc' ? !ice() && batteryReads() && bat.soc.length : (dme[k] || []).length);
        const ready = (k) => !((fail[k] || 0) >= 3 && Date.now() - (tried[k] || 0) < 30000);
        if (!queue.length && on) {
            queue = wantedNow ? wanted.filter((k) => DME_KEYS.indexOf(k) >= 0) : [];
            if (wantedNow && now - slowAt > 10000) { slowAt = now; DME_KEYS.forEach((k) => { if (k !== 'lmv' && queue.indexOf(k) < 0) queue.push(k); }); }
            if (now - (tried.hvSoc || 0) > 10000) queue.push('hvSoc');
            queue = queue.filter(usable);
        }
        const turn = on ? ['hv'].filter(usable).concat(queue.length ? [queue.shift()] : []) : [];
        try {
            if (link.available) {
                for (const k of turn) {
                    if (!ready(k)) continue;
                    tried[k] = Date.now();
                    const v = await readOne(k);
                    fail[k] = v === null ? (fail[k] || 0) + 1 : 0;
                    // Auto: the battery unit answering says plug-in hybrid; never answering, while the engine unit
                    // does on the same link (so not a link problem), a petrol or diesel car
                    if (v !== null && k !== 'hv' && k !== 'hvSoc') dmeAnswered = true;
                    if (k === 'hvSoc' && setting('vehicle') !== 'ice' && setting('vehicle') !== 'phev') {
                        if (v !== null) detect('phev', 'its high-voltage battery unit answers');
                        else if (fail[k] >= 3 && dmeAnswered && detected.vehicle !== 'phev') detect('ice', 'no high-voltage battery unit answers (the engine unit does)');
                    }
                }
            }
        } catch (e) { const m = String(e); if (m !== lastPollErr) { lastPollErr = m; log.warn('diagnostic poll: ' + m); } }   // (once per distinct error)
        timer = setTimeout(poll, turn.length ? 120 : 2000);
    }
    timer = setTimeout(poll, 1500);

    /* ---------- eDrive Live's charge and power, asked for while shown ---------- */
    const providers = startProviders(log);
    // while shown, ask eDrive Live to share; otherwise let go at once (providers.js: Cluster Info's file)
    setInterval(() => { if (opts && opts.shown && opts.shown()) providers.want({ power: true, values: ['soc', 'battery', 'oil'] }); else providers.release(); }, 1000);

    /** The xDrive split: { rear %, from } from the car's own signal, else the transfer case's front torque
     * against the gearbox output (engine torque x the gear's ratio), else none. */
    /*
     * The xDrive split: { rear %, frontNm, from }. From the car's own split signal when it has one; else the
     * transfer case's front torque over UDS: clutch open (5 Nm or less) is all rear; engaged, the front axle's
     * torque in Nm. (A percentage from it needs the whole drive torque, and on a plug-in hybrid the electric
     * motor's share isn't read: the engine-only estimate gave false splits.) The front torque is smoothed, and
     * the last reading held for HOLD_MS through a late read, so it doesn't flicker to '--'.
     */
    const HOLD_MS = 6000;
    let lastSplit = null, frontAvg = null;
    function split(d) {
        if (d.demo) return { rear: d.splitRear, from: 'demo' };
        let now = null;
        if (fresh('splitRear', 10000)) now = { rear: x.splitRear, from: 'car' };
        else if (fresh('lmvFront', 4000)) {
            frontAvg = frontAvg === null ? x.lmvFront : frontAvg + (x.lmvFront - frontAvg) * 0.35;
            now = frontAvg <= 5 ? { rear: 100, frontNm: 0, from: 'transfer case: clutch open' }
                : { rear: null, frontNm: Math.round(frontAvg), from: 'transfer case: front torque' };
        }
        if (now) { lastSplit = { v: now, t: Date.now() }; return now; }
        if (lastSplit && Date.now() - lastSplit.t < HOLD_MS) return lastSplit.v;
        frontAvg = null;
        return { rear: null, from: null };
    }

    return {
        car,
        /** Everything now, in base units. */
        data() {
            const d = car.data(), p = providers.readings();
            // ranges: an app that shares them first (eDrive Live), else the car's own signal
            // the battery: eDrive Live's when it shares, else this app's own reads of the battery unit
            const o = Object.assign({}, d, { mode: x.mode, soc: isNum(p.soc) ? p.soc : fresh('hvSoc', 30000) ? x.hvSoc : undefined,
                kw: isNum(p.kw) ? p.kw : fresh('hvKw', 2000) ? x.hvKw : undefined, driveMode: x.driveMode,
                erange: isNum(p.erange) ? p.erange : fresh('carErange', 120000) ? x.carErange : undefined,
                frange: isNum(p.frange) ? p.frange : fresh('carFrange', 120000) ? x.carFrange : undefined,
                trange: fresh('carTrange', 120000) ? x.carTrange : undefined, fuelLevel: fresh('fuelLevel', 120000) ? x.fuelLevel : undefined });
            ['steer', 'yaw', 'outside', 'gearbox', 'battTemp', 'battMin', 'battMax', 'pdDrive', 'pdClimate', 'pdSeats', 'iat', 'hpfp', 'lpfp', 'timing', 'boostTarget', 'boostActual']
                .forEach((k) => { if (!d.demo && fresh(k, 60000)) o[k] = x[k]; });
            // boost: the engine unit's (fast, while a layout wants it), else the car's sport display signal
            if (!isNum(o.boostActual) && !d.demo && fresh('boostCar', 5000)) o.boostActual = x.boostCar;
            if (d.demo) Object.assign(o, demo(d));
            if (isNum(o.iat) && isNum(o.outside)) o.iatRise = o.iat - o.outside;
            if (isNum(o.battTemp) === false && p.battery !== undefined) o.battTemp = p.battery;
            const sp = split(o);
            o.splitRear = sp.rear; o.splitFrom = sp.from; o.splitFront = isNum(sp.rear) ? 100 - sp.rear : undefined; o.splitFrontNm = sp.frontNm;
            o.engineOn = isNum(o.rpm) ? o.rpm > 300 : undefined;
            // no electric range from the car or an app yet: an estimate from the charge and the range a full battery
            // gives (Settings > Electric range when full, miles), shown with '~'
            if (!isNum(o.erange) && isNum(o.soc) && !ice()) {
                const full = Number(ctx.settings && ctx.settings.get && ctx.settings.get('eFull')) || Number(cfg.eFullMiles) || 31;
                o.erange = Math.max(0, o.soc) / 100 * full * 1.609344; o.erangeEst = true;
            }
            // the tank's fill, 0..100 %: its litres over its size (config.tankLitres: 69 for an X5 45e)
            const tank = Number(setting('tankLitres')) || Number(cfg.tankLitres) || 69;   // Settings > Fuel tank size
            o.fuelPct = isNum(o.fuelLevel) ? Math.max(0, Math.min(100, o.fuelLevel / tank * 100)) : undefined;
            if (o.engineOn === undefined && Date.now() - (x.at.engineState || 0) < 60000) o.engineOn = x.engineState === 'on';
            if (x.startWhy) o.startWhy = x.startWhy;
            return o;
        },
        /** The page on screen needs these (data keys): read them fast. */
        want(keys) { wanted = keys.map((k) => (k === 'boostTarget' || k === 'boostActual' ? 'boostCtl' : k === 'gearbox' ? 'egs' : k === 'splitRear' ? 'lmv' : k)); wantedT = Date.now(); },
        status: () => Object.assign({ diag: link.available ? 'up' : 'down', providers: providers.list().join(', ') || 'none', raw }, status),
        /** The vehicle in use: { vehicle 'phev' | 'ice', how: 'set' | 'found' | 'assumed', why }. */
        vehicle: () => ({ vehicle: vehicleNow(), how: setting('vehicle') === 'ice' || setting('vehicle') === 'phev' ? 'set' : detected.vehicle ? 'found' : 'assumed', why: detected.why }),
        /** fn() on each new reading (the car's speed and rpm samples, every changed reading). */
        onFresh(fn) { freshFns.push(fn); },
        stop() { clearTimeout(timer); providers.stop(); },
    };
}

/** Demo values for the readings the kit's simulator has none of. */
function demo(d) {
    const t = Date.now() / 1000, rpm = d.rpm || 1500;
    return {
        outside: 9, gearbox: 72 + 4 * Math.sin(t / 50), iat: 34 + 6 * Math.sin(t / 20), hpfp: 50 + rpm / 40, lpfp: 5.2 + 0.2 * Math.sin(t),
        timing: 18 - rpm / 800, boostTarget: Math.max(0, (rpm - 1500) / 4000), boostActual: Math.max(0, (rpm - 1600) / 4100),
        battTemp: 27, battMin: 25, battMax: 29, soc: 64, kw: -12 + 25 * Math.sin(t / 7), pdDrive: 60, pdClimate: 25, pdSeats: 15,
        splitRear: 62 + 25 * Math.sin(t / 3), erange: 29, frange: 520, fuelLevel: 38,
    };
}

module.exports = { startData, DME_KEYS, entries, modeOf, rangesOf, FES_MODES };
