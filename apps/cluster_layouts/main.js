'use strict';
/**
 * Cluster Layouts - your own layout on the whole instrument cluster, drawn by the cluster itself.
 *
 * The layout (layout_*.js) is a set of shader layers on the cluster render service's `panel` target; the
 * KOMBI's GPU draws them (engine.js, shaders.js). While driving, the head unit sends only needle and band
 * values, a text's glyph codes when it changes and colours when they change. The stock warning lights stay
 * on top.
 *
 * Readings (data.js, shared with Cluster Centre): speed, engine speed, gear, oil and coolant, torque and g
 * from the car (kit/car.js); the selector's S / M programme, outside, gearbox oil, the xDrive split, the
 * battery's temperature and the power distribution from the car's services; intake air, boost and fuel
 * pressures from the engine unit over UDS (only while a layout that shows them is up); the battery's charge
 * and power from eDrive Live; ranges from any app that shares them, until the car's own range signals are
 * added (the page lists the ones this car has: signal_finder.js).
 *
 * Safe by default: off until "Show on the cluster" is turned on; hidden (the stock cluster back) whenever the
 * car's data is not live, and whenever this app or the render service stops.
 */
const clock = require('./clock');
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const { startCluster, STALE_MS } = require('./engine');
const { byId } = require('./layouts');
const { lookNow } = require('./themes');
const { startData } = require('./data');
const presence = require('./presence');
const { findSignals } = require('./signal_finder');
const logs = require('./logs');
const attribution = require('./attribution');
const path = require('path');

const W = 1600, H = 520;
const isNum = (v) => typeof v === 'number' && isFinite(v);
const SIGNALS_PER_PAGE = 7;

/* The free / open-source notice on the app's own screen (attribution.js): the repo and the refund line, dim when
 * the build is the author's, a warning in red when it was altered. Drawn on every app that carries the cluster
 * mark, so the notice is visible in the menu as well as on the glass. */
function creditFooter(cv, t) {
    const v = attribution.verify();
    const red = '#ff5a5a';
    const head = v.ok ? attribution.INFO.notice : 'MODIFIED BUILD (' + v.reason + ') - this is free: ' + attribution.INFO.notice;
    cv.text(head, 48, 486, 17, v.ok ? t.dim : red, { font: 'bold', literal: true });
    cv.text(attribution.INFO.url + (v.ok ? '   ·   official build, key ' + (v.fingerprint || '?') : ''), 48, 506, 15, v.ok ? t.dim : red, { font: 'label', literal: true });
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        // the clock's zone and format (clock.js: the unit runs its apps on UTC)
        const clockNow = () => { clock.setZone(settings.get('timeZone')); clock.setTwelve(settings.get('clock') !== '24'); };
        clockNow();
        settings.onChange((k) => { if (k === 'timeZone' || k === 'clock') clockNow(); });
        const showing = () => settings.get('show') === 'on';
        // every reading (data.js, shared with Cluster Centre): the car's signals, the engine unit over UDS for
        // what a layout needs (layout.needs), eDrive Live's charge and power while shown
        const D = startData(ctx, { shown: showing });
        const car = D.car;
        const data = () => D.data();
        const options = () => ({
            speedUnit: settings.get('speedUnit'), tempUnit: settings.get('tempUnit'), centre: settings.get('centre'),
            redline: Number(settings.get('redline')) || 7000, rpmMax: Number(settings.get('rpmMax')) || 8000,
            boxClear: settings.get('boxClear') === 'on',
            cluster: settings.get('cluster') === 'm' ? 'm' : 'standard',   // an M car's KOMBI: its two boxes in the middle (layouts.js)
            boxBezel: settings.get('boxBezel') === 'on',   // (off: the box sits on the plain background)
            vehicle: D.vehicle().vehicle,      // set, or found from the car (Auto)
        });
        /** Live: demo data on, or the car's signals answer (a parked car sends nothing new for minutes, so a
         * provider that is there counts), or a value came in the last STALE_MS. */
        const live = () => {
            if (car.data().demo) return true;
            return car.subs.some((s) => s.available) || (car.lastCar > 0 && Date.now() - car.lastCar < STALE_MS);
        };
        let layout = byId(settings.get('layout'));
        /* the colours now: the layout's palette for the look, with pure black behind everything unless the
         * Background setting says tinted. The KOMBI leaves a black box where its own gear readout sits while a
         * layout covers the panel; on black (backgrounds and dial faces) it doesn't show. */
        const BLACK = { bg: '#000000', bgTop: '#000000', bgBottom: '#000000', face0: '#000000', face1: '#000000' };
        const themeNow = () => {
            const t = layout.palette(look());
            return settings.get('background') === 'tinted' ? t : Object.assign({}, t, BLACK);
        };
        const look = () => lookNow(settings.get('look'), data());
        /* the renderer target: the panel (slot 0x203), or as an experiment the KOMBI's other free full-cluster
         * slots (cluster-render 0.3.108+): in 0x203 the HMI's own cluster screen goes down and the KOMBI shows its
         * fallback gear box; another slot may keep it up. A change starts a fresh connection. */
        const SLOTS = { '0x203': 'panel', '0x201': 'panel201', '0x202': 'panel202' };
        const start = () => startCluster({
            client: new ClusterRender('cluster_layouts'),
            layout: () => layout,
            options, log, live, data,
            theme: () => themeNow(),
            enabled: showing,
            sweep: () => settings.get('sweep') !== 'off',
            target: SLOTS[settings.get('clusterSlot')] || 'panel',
            onFresh: D.onFresh,
        });
        let cluster = start();
        let lastVehicle = null, lastModeGear = null;
        // the engine-unit readings the layout shows, read fast while it shows
        setInterval(() => {
            if (showing()) D.want((layout.needs || []).concat(require('./layout_common').focus.needs(options())));
            if (cluster.status().shown) presence.mark('layouts');   // Cluster Centre steps aside while a layout shows
            // the vehicle found (Settings > Vehicle: Auto): the layout redrawn for it once known
            const v = D.vehicle().vehicle;
            if (v !== lastVehicle) { if (lastVehicle) cluster.rebuild(); lastVehicle = v; }
            // drive mode and gear changes in the log (timestamped), beside the cluster's target changes: what the
            // KOMBI does to the layout on a mode change (the stock cluster back for a few seconds) shows in one log
            const dn = data(), mg = (dn.driveMode || '-') + ' / ' + (dn.gear == null ? '-' : dn.gear);
            if (mg !== lastModeGear) {
                if (lastModeGear !== null && !dn.demo) log.info('drive mode / gear: ' + lastModeGear + ' -> ' + mg + '   (cluster: ' + JSON.stringify(cluster.status()) + ')');
                lastModeGear = mg;
            }
        }, 500);
        settings.onChange((k) => {
            if (k === 'clusterSlot') { cluster.stop(); cluster = start(); return; }
            if (k === 'look' || k === 'background') return cluster.recolour();
            if (k === 'layout') layout = byId(settings.get('layout'));
            if (['layout', 'centre', 'speedUnit', 'tempUnit', 'redline', 'rpmMax', 'boxClear', 'boxBezel', 'cluster', 'vehicle', 'tankLitres', 'batteryReads'].indexOf(k) >= 0) cluster.rebuild();
        });

        /* ---------- the car's range and charge signals, from its own catalog ---------- */
        const found = findSignals();
        if (found.error) log.warn('signals: ' + found.error);
        else {
            log.info('signals for ranges, fuel and charge: ' + found.list.length);
            found.list.slice(0, 60).forEach((s) => log.info('  ' + s.iface + ' ' + s.field + (s.get ? ' get' : '') + (s.notify ? ' notify' : '') + ' {' + s.members.slice(0, 12).join(', ') + '}'));
        }
        let page = 0;   // 0: status; 1...: the signal list, SIGNALS_PER_PAGE a page
        // 0: status; 1: the raw drive-mode and range values; 2: what the cluster has up; 3...: the signal list
        const pages = () => 3 + Math.ceil(found.list.length / SIGNALS_PER_PAGE);

        ui.onClick('BTN_SHOW', () => { settings.set('show', showing() ? 'off' : 'on'); return render(); });
        ui.onClick('BTN_SIGNALS', () => { logView = null; page = (page + 1) % Math.max(1, pages()); return render(); });

        /* ---------- Logs: what's needed to find a problem, as QR codes to photograph and as a file on a USB stick ---------- */
        let logView = null;   // { codes, page, saved, bytes }
        const PER_PAGE = 3;
        /** A finder result as lines: 'Iface.field [get notify] { members }'. */
        const sigList = (f, max) => (f.error ? f.error : f.list.slice(0, max).map((x) => x.iface.replace(/^de\.bmw\./, '') + '.' + x.field + (x.get ? ' get' : '') + (x.notify ? ' notify' : '') + ' {' + x.members.slice(0, 10).join(', ') + '}').join('\n') + (f.list.length > max ? '\n(' + (f.list.length - max) + ' more)' : ''));
        /** The renderer's status with this app's own effect layers (one line each, ~60) counted, for the codes. */
        const squeeze = (txt, full) => {
            if (full) return txt;
            let ours = 0;
            const kept = String(txt).split('\n').filter((l) => (/^layer \d+ effect of cluster_layouts on panel/.test(l) ? (ours++, false) : true));
            return kept.join('\n') + (ours ? '\n(' + ours + ' effect layers of cluster_layouts, one line each in the full logs)' : '');
        };
        function logBundle(full) {
            const n = (short, long) => (full ? long : short);
            const d = data(), o = options(), snap = {};
            Object.keys(d).forEach((k) => { const v = d[k]; if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') snap[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v; });
            return logs.bundle('Cluster Layouts ' + ((ctx.spec && ctx.spec.version) || ''), [
                ['settings', JSON.stringify({ layout: settings.get('layout'), centre: o.centre, look: settings.get('look'), background: settings.get('background'), show: settings.get('show') })],
                ['engine', JSON.stringify(cluster.status())],
                ['cluster renderer status', squeeze(cluster.rendererStatus() || '(no answer yet: Cluster renderer 0.3.107 or later answers)', full)],
                ['data now', JSON.stringify(snap)],
                ['raw signals', JSON.stringify(D.status().raw || {})],
                ['vehicle', (() => { const v = D.vehicle(); return v.vehicle + ' (' + v.how + ': ' + v.why + ')'; })()],
                ['data status', JSON.stringify(Object.assign({}, D.status(), { raw: undefined }))],
                // the car's own names for these (its service catalog): what to declare for the electric range
                // and the local time
                ['range and charge signals', sigList(found, n(40, 400))],
                ['time and date signals', sigList(findSignals({ match: /time|date|uhrzeit|datum|zone|clock/i }), n(25, 300))],
                ['cluster-render log', logs.tail(logs.RENDER_LOG, n(50, 1500))],
                ['this app\'s log', logs.tail(path.join(ctx.dataDir || '.', 'cluster_layouts.log'), n(30, 400))],
                ['Cluster Centre log', logs.siblingLog(ctx.dataDir || '.', 'cluster_centre', n(20, 300))],
            ]);
        }
        ui.onClick('BTN_LOGS', () => {
            page = 0;
            if (!logView) {
                const saved = logs.save(logBundle(true), ctx.dataDir);
                saved.forEach((r) => log.info('logs: ' + (r.file ? 'saved ' + r.file : r.dir + ': ' + r.error)));
                const c = logs.codes(logBundle(false));
                logView = { codes: c.codes, page: 0, saved, bytes: c.bytes };
            } else {
                logView.page++;
                if (logView.page * PER_PAGE >= logView.codes.length) logView = null;
            }
            return render();
        });

        const rawOf = (name) => { const r = D.status().raw || {}; return r[name] ? r[name].slice(0, 70) : 'nothing yet'; };
        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            if (logView) {
                const n = logView.codes.length, pages = Math.ceil(n / PER_PAGE), first = logView.page * PER_PAGE;
                const usb = logView.saved.filter((r) => r.file && !/exports/.test(r.file));
                cv.text('Logs: photograph each code (page ' + (logView.page + 1) + ' of ' + pages + ', codes ' + (first + 1) + '-' + Math.min(n, first + PER_PAGE) + ' of ' + n + '), then press Logs for the next', 40, 34, 20, t.text, { font: 'bold', literal: true });
                cv.text(usb.length ? 'The full logs are also on the USB stick: ' + usb[0].file : 'Plug in a USB stick and press Logs again from the start for the full logs as a file', 40, 62, 16, t.dim, { font: 'label', literal: true });
                logView.codes.slice(first, first + PER_PAGE).forEach((q, i) => {
                    const px = Math.max(3, Math.floor(420 / (q.size + 8)));
                    logs.draw(cv, q, 40 + i * 520, 84, px);
                    cv.text(String(first + i + 1) + ' / ' + n, 40 + i * 520 + 180, 84 + (q.size + 8) * px + 22, 18, t.text, { font: 'bold', literal: true });
                });
                return ui.image('MAIN_GFX', cv);
            }
            if (page === 1) {
                cv.text('What the car sends for the drive mode and the ranges (photograph this in each mode)', 48, 70, 24, t.text, { font: 'bold', literal: true });
                const raw = D.status().raw || {}, d = data();
                let y = 120;
                ['statusFESVehicleDynamicSwitchHMI', 'statusSwitchDriveDynamicSport2', 'statusRangeTankStatus', 'Range', 'statusEngineStatus', 'ActualSteeringAngleDriver', 'statusYawVelocityVehicle'].forEach((n) => {
                    const txt = raw[n] || 'nothing yet';
                    cv.text(n + ':  ' + txt.slice(0, 120), 48, y, 15, t.text, { font: 'label', literal: true }); y += 21;
                    for (let i = 120; i < txt.length && i < 2 * 120; i += 120) { cv.text(txt.slice(i, i + 120), 72, y, 15, t.dim, { font: 'label', literal: true }); y += 21; }
                    y += 6;
                });
                const vh = D.vehicle();
                cv.text('Vehicle: ' + (vh.vehicle === 'ice' ? 'petrol or diesel' : 'plug-in hybrid') + ' (' + vh.how + (vh.how === 'set' ? '' : ': ' + vh.why) + ')', 48, y + 34, 18, t.text, { font: 'bold', literal: true });
                cv.text('Read as: ' + (d.driveMode || '-') + ', steering ' + (isNum(d.steer) ? Math.round(d.steer) + '°' : '--') + ', yaw ' + (isNum(d.yaw) ? d.yaw.toFixed(1) : '--') + ', fuel ' + (isNum(d.frange) ? Math.round(d.frange) : '--') + ', electric ' + (isNum(d.erange) ? Math.round(d.erange) : '--'), 48, y + 6, 18, t.text, { font: 'bold', literal: true });
                return ui.image('MAIN_GFX', cv);
            }
            if (page === 2) {
                cv.text('What the cluster shows besides this app (the renderer\'s report; photograph it with a layout up)', 48, 70, 24, t.text, { font: 'bold', literal: true });
                const txt = cluster.rendererStatus();
                const lines = txt ? txt.split('\n').filter((l) => /^slot 0x|^target (panel|map|hud)|^dcsm/.test(l)) : ['nothing yet: the Cluster renderer answers from 0.3.107 on'];
                lines.slice(0, 15).forEach((l, i) => cv.text(l.slice(0, 140), 48, 116 + i * 26, 16, t.text, { font: 'label', literal: true }));
                return ui.image('MAIN_GFX', cv);
            }
            if (page > 2) {
                cv.text('Signals on this car for ranges, fuel and charge (' + found.list.length + ')   ·   page ' + (page - 2) + ' of ' + (pages() - 3), 48, 70, 26, t.text, { font: 'bold', literal: true });
                found.list.slice((page - 3) * SIGNALS_PER_PAGE, (page - 2) * SIGNALS_PER_PAGE).forEach((s, i) => {
                    const y = 130 + i * 54;
                    cv.text(s.iface.replace(/^de\.bmw\./, '') + '  ·  ' + s.field + (s.get ? '  get' : '') + (s.notify ? '  notify' : ''), 48, y, 20, t.text, { font: 'label', literal: true });
                    cv.text(s.members.slice(0, 10).join(', ').slice(0, 150), 72, y + 24, 16, t.dim, { font: 'label', literal: true });
                });
                return ui.image('MAIN_GFX', cv);
            }
            const st = cluster.status(), d = data(), o = options();
            const spd = isNum(d.speed) ? Math.round(o.speedUnit === 'kmh' ? d.speed : d.speed / 1.609344) + ' ' + (o.speedUnit === 'kmh' ? 'km/h' : 'mph') : '--';
            const tmp = (c) => (isNum(c) ? Math.round(o.tempUnit === 'c' ? c : c * 9 / 5 + 32) + '°' : '--');
            const lines = [
                ['On the cluster', !showing() ? 'Off - the stock cluster shows (press Show on the cluster)'
                    : st.shown ? 'Showing: ' + layout.title + ', ' + look() + ' colours' : 'Waiting for live car data'],
                ['Cluster renderer', st.renderer + '   ·   panel: ' + st.target + '   ·   ' + st.layers + ' layers' + (st.refused ? '   ·   refused: ' + st.refused : '')],
                ['Car data', (d.demo ? 'demo   ·   ' : live() ? 'live   ·   ' : 'not live   ·   ') + spd + '   ·   ' + (isNum(d.rpm) ? Math.round(d.rpm) + ' rpm' : '-- rpm')
                    + '   ·   gear ' + layout.gearText(d) + '   ·   oil ' + tmp(d.oil) + '   ·   coolant ' + tmp(d.coolant) + '   ·   outside ' + tmp(d.outside)],
                ['Shared by apps', D.status().providers + '   ·   diagnostic link ' + D.status().diag + '   ·   charge ' + (isNum(d.soc) ? Math.round(d.soc) + '%' : '--') + '   ·   power ' + (isNum(d.kw) ? d.kw.toFixed(1) + ' kW' : '--')],
                ['Drive mode (car)', (d.driveMode || '-') + '   ·   raw: ' + rawOf('statusFESVehicleDynamicSwitchHMI') + '  ' + rawOf('statusSwitchDriveDynamicSport2')],
                ['Range (car)', 'fuel ' + (isNum(d.frange) ? Math.round(d.frange) : '--') + '  electric ' + (isNum(d.erange) ? Math.round(d.erange) : '--') + '  xDrive ' + (isNum(d.splitRear) ? Math.round(d.splitRear) + '% rear' : '--') + '   ·   raw: ' + rawOf('statusRangeTankStatus')],
            ];
            cv.text('Cluster Layouts ' + ((ctx.spec && ctx.spec.version) || ''), 48, 80, 44, t.text, { font: 'bold', literal: true });
            lines.forEach(([k, v], i) => {
                cv.text(k, 48, 160 + i * 64, 22, t.dim, { font: 'bold', literal: true });
                cv.text(String(v).slice(0, 120), 330, 160 + i * 64, k.indexOf('(car)') >= 0 ? 17 : 22, t.text, { font: 'label', literal: true });
            });
            creditFooter(cv, t);
            return ui.image('MAIN_GFX', cv);
        }
        ctx.loop('MAIN', 2, render);
        Promise.resolve().then(render).catch((e) => log.warn('first render: ' + (e && e.stack || e)));
    },
});
