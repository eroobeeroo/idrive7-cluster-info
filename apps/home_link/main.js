'use strict';
/**
 * Home Link - the car's readings and comings and goings in Apple Home, through a bridge at home (Homebridge with
 * the homebridge-x5-link plugin, on any computer on the home Wi-Fi).
 *
 * While the head unit is on and joined to the home Wi-Fi (mgu-uplink), every few seconds this app sends the
 * bridge the battery's charge, fuel level and ranges, the outside, oil and coolant temperatures, speed, gear and
 * engine state, and how long the head unit has been up; the bridge turns them into HomeKit sensors and works out
 * arrived (it had been away and comes into Wi-Fi range already driving), started (the car came on at home) and
 * leaving (it drove out of range). link.js: finding the bridge without typing, pairing, signing.
 *
 * The battery's charge: from eDrive Live when it shares, else a few seconds of reads from the battery unit when
 * the car reaches the bridge and every 5 minutes while it stays in reach (Settings > Battery readings: off
 * leaves the battery unit alone; each read puts "Diagnostic mode active" on the cluster for a moment).
 *
 * Nothing reaches the car from outside: the head unit lets nothing connect in. Commands from Apple Home to the
 * car are not part of this version.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const { startData } = require('./data');
const L = require('./link');
const attribution = require('./attribution');

/* The free / open-source notice on the app's own screen (attribution.js), dim normally, red if the build was
 * altered. Drawn below the title (Home Link's status lines run to the bottom edge). */
function creditFooter(cv, t) {
    const v = attribution.verify();
    const red = '#ff5a5a';
    const head = v.ok ? attribution.INFO.notice : 'MODIFIED BUILD (' + v.reason + ') - this is free: ' + attribution.INFO.notice;
    cv.text(head, 48, 118, 17, v.ok ? t.dim : red, { font: 'bold', literal: true });
    cv.text(attribution.INFO.url + (v.ok ? '   ·   official build, key ' + (v.fingerprint || '?') : ''), 48, 140, 15, v.ok ? t.dim : red, { font: 'label', literal: true });
}

const W = 1600, H = 520;
const SEND_MS = 5000;              // a report every 5 s while the bridge answers
const FAILS_TO_LOSE = 3;           // reports in a row without an answer: the bridge is looked for again
const SCAN_EVERY_MS = 60000;       // looking for it at most once a minute
const READ_WINDOW_MS = 6000;       // the battery unit read for this long ...
const READ_EVERY_MS = 300000;      // ... on reaching the bridge and every 5 min while in reach
const READ_CHARGING_MS = 120000;   // ... every 2 min while charging (the car stays on while it charges)
const isNum = (v) => typeof v === 'number' && isFinite(v);
const r1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : undefined);

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const dir = ctx.dataDir || '.';
        const st = L.loadState(dir);
        L.saveState(st);
        // (never the pairing code: it is the key reports are signed with, and logs get shared)
        log.info('home link: car ' + L.carId(st.code));

        // the battery unit only in a read window (data.js reads only while "shown")
        let readUntil = 0, lastWindow = 0;
        const D = startData(ctx, { shown: () => settings.get('batteryReads') !== 'off' && Date.now() < readUntil });
        const openWindow = () => { if (settings.get('batteryReads') !== 'off') { readUntil = Date.now() + READ_WINDOW_MS; lastWindow = Date.now(); } };

        // the lease mgu-uplink gives this app (its data folder), or the one for every process
        const LEASES = [path.join(dir, 'uplink.json'), '/run/mgu-uplink/lease.json'];
        const link = { state: 'starting', bridge: null, lastOk: 0, fails: 0, lastScan: 0, scanning: false, lastStatus: null, sent: 0, error: '', leaseKey: null };

        // charging, held between battery reads (link.js chargeTracker)
        const chgT = L.chargeTracker(), chg = chgT.state;
        const chargingNow = (d) => chgT.update(d);

        function payload() {
            const d = D.data(), c = chargingNow(d);
            const gear = d.stage === 'P' || d.stage === 'R' || d.stage === 'N' ? d.stage : d.gear === -1 ? 'R' : isNum(d.gear) && d.gear > 0 ? 'D' + d.gear : d.stage || null;
            return {
                v: 1, car: L.carId(st.code), seq: L.nextSeq(st), t: Date.now(), uptime: Math.round(process.uptime()),
                app: (ctx.spec && ctx.spec.version) || '',
                data: {
                    soc: r1(d.soc), kw: r1(d.kw), erangeKm: r1(d.erange), frangeKm: r1(d.frange), fuelPct: r1(d.fuelPct), fuelL: r1(d.fuelLevel),
                    outsideC: r1(d.outside), oilC: r1(d.oil), coolantC: r1(d.coolant), battC: r1(d.battTemp),
                    speedKmh: r1(d.speed), gear, engineOn: typeof d.engineOn === 'boolean' ? d.engineOn : undefined,
                    driveMode: d.driveMode || undefined, demo: d.demo ? true : undefined,
                    charging: c.on, chargeKw: c.on ? r1(c.kw) : undefined,
                },
            };
        }

        async function find(lease, key) {
            link.scanning = true; link.lastScan = Date.now(); link.state = 'searching';
            const list = L.hosts(lease, 1024);
            // logged on the first look at a network only: away from home it rescans every minute
            const quiet = !!(link.missed && link.missed[key]);
            if (!quiet) log.info('home link: looking for the bridge on ' + key + ' (' + list.length + ' addresses, port ' + L.PORT + ')');
            const t0 = Date.now();
            const f = await L.scan(list, L.PORT);
            link.scanning = false;
            if (!f) {
                link.state = 'not found';
                if (!quiet) log.info('home link: no bridge on ' + key + ' (' + Math.round((Date.now() - t0) / 1000) + ' s; looking again each minute, quietly)');
                link.missed = link.missed || {}; link.missed[key] = true;
                return;
            }
            if (link.missed) delete link.missed[key];
            link.bridge = { host: f.host, port: f.port, name: f.hello.name || 'Homebridge' };
            st.bridges[key] = link.bridge; L.saveState(st);
            link.fails = 0;
            log.info('home link: bridge ' + link.bridge.name + ' at ' + f.host + ':' + f.port + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)');
        }

        let busy = false;
        async function tick() {
            if (busy) return;
            busy = true;
            try {
                const lease = L.readLease(LEASES);
                if (!lease) { link.state = 'offline'; link.bridge = null; link.leaseKey = null; return; }
                const key = L.netKey(lease);
                if (key !== link.leaseKey) { link.leaseKey = key; link.bridge = st.bridges[key] || null; link.fails = 0; }
                if (!link.bridge) {
                    if (!link.scanning && Date.now() - link.lastScan > SCAN_EVERY_MS) await find(lease, key);
                    if (!link.bridge) return;
                }
                // reaching the bridge after a while away: the battery read then, and every 5 min while in reach
                if (Date.now() - link.lastOk > 60000 || Date.now() - lastWindow > (chg.on ? READ_CHARGING_MS : READ_EVERY_MS)) openWindow();
                let r;
                try { r = await L.report(link.bridge, st, payload()); } catch (e) { r = null; link.error = String(e && e.code || e); }
                L.saveState(st);
                if (!r) {
                    link.fails++;
                    link.state = 'no answer';
                    if (link.fails >= FAILS_TO_LOSE) {
                        log.info('home link: the bridge at ' + link.bridge.host + ' stopped answering; looking again');
                        delete st.bridges[key]; L.saveState(st);
                        link.bridge = null; link.lastScan = 0;
                    }
                    return;
                }
                link.fails = 0; link.lastStatus = r.status;
                if (r.status === 200) { link.state = 'sending'; link.lastOk = Date.now(); link.sent++; link.error = ''; }
                else if (r.status === 409 && r.json && isNum(r.json.last)) { st.seq = Math.max(st.seq, r.json.last); link.state = 'catching up'; }
                else if (r.status === 401) { link.state = 'not paired'; link.error = (r.json && r.json.error) || 'the code in Homebridge is not this one'; }
                else { link.state = 'refused ' + r.status; link.error = (r.json && r.json.error) || ''; }
            } catch (e) {
                link.error = String(e && e.message || e);
                log.warn('home link: ' + link.error);
            } finally { busy = false; }
        }
        setInterval(tick, SEND_MS);
        setTimeout(tick, 4000);

        ui.onClick('BTN_FIND', () => { delete st.bridges[link.leaseKey]; link.bridge = null; link.lastScan = 0; L.saveState(st); setImmediate(tick); return render(); });
        ui.onClick('BTN_CODE', () => {
            // a new code: the bridge must be given it again
            if (link.newCodeAsk && Date.now() - link.newCodeAsk < 5000) {
                st.code = L.newCode(); st.seq = Math.max(st.seq, Date.now()); L.saveState(st); link.newCodeAsk = 0;
                log.info('home link: new pairing code');
            } else link.newCodeAsk = Date.now();
            return render();
        });

        const STATES = {
            starting: 'Starting', offline: 'Not on Wi-Fi: the head unit has not joined a network', searching: 'Looking for the bridge on this Wi-Fi...',
            'not found': 'No bridge found on this Wi-Fi (is Homebridge running with the X5 Link plugin, and the firewall rule added?)',
            'no answer': 'The bridge did not answer', 'not paired': 'Bridge found: enter the pairing code in its X5 Link settings',
            sending: 'Sending to Apple Home', 'catching up': 'Catching up with the bridge',
        };
        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            const d = D.data(), b = link.bridge, ago = link.lastOk ? Math.round((Date.now() - link.lastOk) / 1000) : null;
            const miles = settings.get('speedUnit') !== 'kmh';
            const dist = (km) => (isNum(km) ? Math.round(miles ? km / 1.609344 : km) + (miles ? ' mi' : ' km') : '--');
            cv.text('Home Link ' + ((ctx.spec && ctx.spec.version) || ''), 48, 76, 40, t.text, { font: 'bold', literal: true });
            cv.text('Pairing code', 1060, 60, 20, t.dim, { font: 'bold', literal: true });
            cv.text(L.showCode(st.code), 1060, 112, 44, t.text, { font: 'bold', literal: true });
            cv.text(link.newCodeAsk && Date.now() - link.newCodeAsk < 5000 ? 'Press New code again to replace it' : 'Enter it once in Homebridge > X5 Link', 1060, 146, 18, t.dim, { font: 'label', literal: true });
            const lines = [
                ['Status', STATES[link.state] || link.state],
                ['Bridge', b ? b.name + ' at ' + b.host + ':' + b.port + (ago !== null ? '   ·   last sent ' + ago + ' s ago   ·   ' + link.sent + ' sent' : '') : link.scanning ? 'looking...' : 'none yet'],
                ['Wi-Fi', link.leaseKey || 'not joined'],
                ['Sending', 'charge ' + (isNum(d.soc) ? Math.round(d.soc) + '%' : '--') + '   ·   fuel ' + (isNum(d.fuelPct) ? Math.round(d.fuelPct) + '%' : '--')
                    + '   ·   electric ' + dist(d.erange) + '   ·   fuel range ' + dist(d.frange) + '   ·   outside ' + (isNum(d.outside) ? Math.round(miles ? d.outside * 9 / 5 + 32 : d.outside) + (miles ? '°F' : '°C') : '--')],
                ['Charging', chg.on ? 'yes' + (isNum(chg.kw) ? ', ' + chg.kw.toFixed(1) + ' kW' : '') : 'no'],
                ['Last error', link.error || 'none'],
            ];
            lines.forEach(([k, v], i) => {
                cv.text(k, 48, 200 + i * 60, 22, t.dim, { font: 'bold', literal: true });
                cv.text(String(v).slice(0, 110), 260, 200 + i * 60, 21, t.text, { font: 'label', literal: true });
            });
            creditFooter(cv, t);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 1, render);
        Promise.resolve().then(render).catch((e) => log.warn('first render: ' + (e && e.stack || e)));
    },
});
