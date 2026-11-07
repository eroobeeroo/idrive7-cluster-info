'use strict';
/**
 * Cluster Centre - pages of hidden data in the centre of the factory cluster, drawn by the cluster itself.
 *
 * The stock speedometer, rev counter and warning lights stay; the centre (the map area, slot 0x100, 1088x480,
 * taken over from the stock map in Map view as Waze on cluster does) shows one of the pages chosen in the
 * settings (pages.js): temperatures, fuel and boost, warm-up, turbo cool-down, the xDrive split, eDrive, the
 * engine on / off, steering, the 0-60 timer and two custom pages. Every page is built once on the cluster
 * (engine.js groups); changing page sends only which group shows. A shift light with the gear sits at the top.
 *
 * This screen shows the page as it is now (cpu_preview.js), the next page, the timer's arming, and the
 * signals the car has for steering, yaw and why the engine started (signal_finder.js). Settings are kept per
 * driver profile.
 */
const clock = require('./clock');
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const { startCluster } = require('./engine');
const { startData } = require('./data');
const presence = require('./presence');
const { PAGES, pieces, palette, W: SW, H: SH } = require('./pages');
const { WarmUp, CoolDown, PerfTimer } = require('./features');
const { drawPieces } = require('./cpu_preview');
const { findSignals } = require('./signal_finder');
const attribution = require('./attribution');

/* The free / open-source notice on the app's own screen (attribution.js), dim normally, red if the build was
 * altered - matches the mark woven into the cluster pages. */
function creditFooter(cv, t) {
    const v = attribution.verify();
    const red = '#ff5a5a';
    const head = v.ok ? attribution.INFO.notice : 'MODIFIED BUILD (' + v.reason + ') - this is free: ' + attribution.INFO.notice;
    cv.text(head, 48, 486, 17, v.ok ? t.dim : red, { font: 'bold', literal: true });
    cv.text(attribution.INFO.url + (v.ok ? '   ·   official build, key ' + (v.fingerprint || '?') : ''), 48, 506, 15, v.ok ? t.dim : red, { font: 'label', literal: true });
}

const W = 1600, H = 520;
let record = null;
try { record = require('./kit/record'); } catch (e) { /* an older kit: no pixel images */ }
const PREVIEW_ID = 0x43430001;
let lastSig = '';
/** The picture at half size (each 2x2 block averaged). */
function half(d, w, h) {
    const W2 = w >> 1, H2 = h >> 1, out = new Uint8Array(W2 * H2 * 4);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
        const a = ((y * 2) * w + x * 2) * 4, b = a + w * 4, o = (y * W2 + x) * 4;
        for (let c = 0; c < 4; c++) out[o + c] = (d[a + c] + d[a + 4 + c] + d[b + c] + d[b + 4 + c]) >> 2;
    }
    return out;
}
/** A cheap fingerprint of the preview's pixels (every 997th byte), so an unchanged picture is not sent again. */
function previewSig(d) { let h = 0; for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) | 0; return d.length + ':' + h; }
const PAGE_IDS = ['temps', 'fuel', 'warmup', 'cooldown', 'xdrive', 'edrive', 'engine', 'steering', 'timer', 'custom1', 'custom2'];
const FIND = [
    { name: 'steering and yaw', match: /lenkwinkel|steer|yaw|gier|drehrate/i },
    { name: 'why the engine started', match: /startgrund|startreason|enginestart|combustion|verbrennungsmotor|engineon|motorstart|startrequest/i },
];

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        // the clock's zone and format (clock.js: the unit runs its apps on UTC)
        const clockNow = () => { clock.setZone(settings.get('timeZone')); clock.setTwelve(settings.get('clock') !== '24'); };
        clockNow();
        settings.onChange((k) => { if (k === 'timeZone' || k === 'clock') clockNow(); });
        const showing = () => settings.get('show') === 'on';
        const data = startData(ctx, { shown: showing });
        const num = (k, dflt) => { const v = Number(settings.get(k)); return isFinite(v) ? v : dflt; };

        /* ---------- what is worked out from the readings ---------- */
        const warm = new WarmUp(), cool = new CoolDown(), perf = new PerfTimer();
        const eng = { onMs: 0, driveMs: 0, starts: 0, last: null, was: false, why: null };
        const extra = () => ({ warm: warm.state(data.data()), cool: cool.state(), perf: perf.state(Date.now()), eng: { onMs: eng.onMs, share: eng.driveMs > 60000 ? eng.onMs / eng.driveMs * 100 : null, starts: eng.starts, why: eng.why } });
        const feedOpts = () => {
            Object.assign(warm.o, { target: num('warmTarget', 90), coldLimit: num('coldLimit', 3500), redline: num('redline', 6500) });
            Object.assign(cool.o, { hardRpm: num('hardRpm', 4500) });
            perf.o.kmh = settings.get('speedUnit') === 'kmh';
        };
        setInterval(() => {
            feedOpts();
            const t = Date.now(), d = data.data();
            warm.feed(t, d); cool.feed(t, d); perf.feed(t, d);
            const dt = eng.last === null ? 0 : Math.min(2000, t - eng.last);
            eng.last = t;
            if (typeof d.speed === 'number' && d.speed > 1) { eng.driveMs += dt; if (d.engineOn) eng.onMs += dt; }
            if (d.engineOn && !eng.was) eng.starts++;
            eng.was = !!d.engineOn;
            if (d.startWhy) eng.why = d.startWhy;
        }, 200);
        const all = () => Object.assign(data.data(), extra());

        /* ---------- options for the pages ---------- */
        // (a petrol or diesel car, Settings > Vehicle: ICE, has no eDrive page)
        const enabled = () => PAGE_IDS.filter((id) => settings.get('page_' + id) === 'on' && !(id === 'edrive' && data.vehicle().vehicle === 'ice'));
        const options = () => ({
            look: settings.get('look'), fit: settings.get('fit'), pages: enabled(), style: settings.get('style'), accent: settings.get('accent'), size: settings.get('size'),
            units: { temp: settings.get('tempUnit'), press: settings.get('pressUnit'), speed: settings.get('speedUnit'), torque: settings.get('torqueUnit') },
            warn: { oilHigh: num('oilHigh'), coolantHigh: num('coolantHigh'), iatHigh: num('iatHigh'), gearboxHigh: num('gearboxHigh'), battTempHigh: num('battTempHigh'), lpfpLow: num('lpfpLow') },
            shift: { on: settings.get('shift') !== 'off', from: num('shiftFrom', 4000), at: num('shiftAt', 6200) },
            badge: settings.get('badge') !== 'off',
            warmTarget: num('warmTarget', 90), redline: num('redline', 6500),
            custom: [1, 2].map((i) => ({ style: settings.get('c' + i + 'Style'), slots: [1, 2, 3, 4, 5, 6].slice(0, num('c' + i + 'Count', 4)).map((s) => settings.get('c' + i + 's' + s)).filter((k) => k && k !== 'none') })),
        });
        let page = enabled()[0] || null, pageAt = Date.now();
        const layout = { id: 'centre', pieces: (o) => pieces(o) };
        const cluster = startCluster({
            client: new ClusterRender('cluster_centre'),
            target: 'map', contend: true, z: 200,
            layout: () => layout, options, log, data: all, onFresh: data.onFresh,
            theme: () => palette(settings.get('accent'), settings.get('look')),
            font: () => (settings.get('look') === 'modern' ? 'bold' : 'light'),
            live: () => data.car.data().demo || data.car.subs.some((s) => s.available) || data.car.lastCar > 0,
            // not while Cluster Layouts covers the whole panel: the pages would be hidden under it and take the
            // renderer's layers the layout needs
            enabled: () => showing() && !!page && !presence.active('layouts'),
            sweep: () => false,
            group: page,
        });
        function goTo(id) {
            page = id; pageAt = Date.now();
            cluster.setGroup(id);
            const pg = PAGES[id];
            if (pg) data.want(pg.needsOf ? pg.needsOf(options()) : pg.needs);
        }
        function next() { const list = enabled(); if (!list.length) { page = null; return; } goTo(list[(list.indexOf(page) + 1) % list.length]); }
        if (page) goTo(page);
        setInterval(() => {
            const r = num('rotate', 0);
            if (r > 0 && Date.now() - pageAt >= r * 1000) next();
            const pg = PAGES[page];
            if (pg) data.want(pg.needsOf ? pg.needsOf(options()) : pg.needs);
        }, 1000);

        /* ---------- settings per driver profile ---------- */
        const PROFILE_KEYS = settings.schema.map((s) => s.key).filter((k) => k !== 'show' && k !== 'demo');
        const PROFILE_FILE = path.join(ctx.dataDir, 'profiles.json');
        let profiles = {}, applying = false, profile = null;
        try { profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')) || {}; } catch (e) { /* none yet */ }
        const saveProfiles = () => { try { fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles)); } catch (e) { log.warn('profiles: ' + e); } };
        const snapshot = () => { const o = {}; PROFILE_KEYS.forEach((k) => { o[k] = settings.get(k); }); return o; };
        ctx.signals.watch('de.bmw.infotainment.personalization.SessionManager', 'de.bmw.infotainment.personalization.SessionManager', {
            currentUserAccountReference: (v) => {
                const id = typeof v === 'string' ? v : v && (v.value || v.currentUserAccountReference);
                if (!id || String(id) === profile) return;
                profile = String(id);
                if (profiles[profile]) {
                    applying = true;
                    PROFILE_KEYS.forEach((k) => { if (profiles[profile][k] !== undefined && profiles[profile][k] !== settings.get(k)) settings.set(k, profiles[profile][k]); });
                    applying = false;
                    log.info('driver profile ' + profile + ': their settings');
                    rebuild();
                } else { profiles[profile] = snapshot(); saveProfiles(); log.info('driver profile ' + profile + ': first seen'); }
            },
        }, log, { pollMs: 5000 });

        function rebuild() {
            cluster.rebuild();
            const list = enabled();
            if (list.indexOf(page) < 0) page = list[0] || null;
            if (page) { const p = page; page = null; goTo(p); }
        }
        settings.onChange((k, v) => {
            if (!applying && profile && PROFILE_KEYS.indexOf(k) >= 0) { profiles[profile] = Object.assign(profiles[profile] || snapshot(), { [k]: v }); saveProfiles(); }
            if (applying || k === 'show' || k === 'demo' || k === 'rotate') return;
            if (k === 'accent') return cluster.recolour();
            rebuild();
        });

        /* ---------- signals the car has for steering, yaw and why the engine started ---------- */
        const found = FIND.map((f) => Object.assign({ name: f.name }, findSignals({ match: f.match })));
        found.forEach((f) => { if (f.error) log.warn('signals: ' + f.error); else { log.info('signals for ' + f.name + ': ' + f.list.length); f.list.slice(0, 40).forEach((s) => log.info('  ' + s.iface + ' ' + s.field + ' {' + s.members.slice(0, 10).join(', ') + '}')); } });
        const sigList = [].concat(...found.map((f) => f.list.map((s) => Object.assign({ what: f.name }, s))));
        let sigPage = 0;

        ui.onClick('BTN_SHOW', () => { settings.set('show', showing() ? 'off' : 'on'); return safeRender(); });
        ui.onClick('BTN_NEXT', () => { sigPage = 0; next(); return safeRender(); });
        ui.onClick('BTN_ARM', () => {
            if (perf.mode === 'off' || perf.mode === 'done') perf.arm(); else perf.cancel();
            // arming shows the timer page, turned on if it was off
            if (enabled().indexOf('timer') < 0) settings.set('page_timer', 'on');
            goTo('timer');
            return safeRender();
        });
        ui.onClick('BTN_SIGNALS', () => { sigPage = (sigPage + 1) % (1 + Math.ceil(sigList.length / 7)); return safeRender(); });

        function render() {
            const t = ctx.theme();
            const cv = ctx.canvas(W, H).clear(t.bg);
            if (sigPage > 0) {
                cv.text('Signals on this car for steering, yaw and engine starts (' + sigList.length + ')   ·   page ' + sigPage, 48, 60, 26, t.text, { font: 'bold', literal: true });
                if (found[0].error) cv.text(found[0].error, 48, 110, 20, t.dim, { font: 'label', literal: true });
                sigList.slice((sigPage - 1) * 7, sigPage * 7).forEach((s, i) => {
                    const y = 116 + i * 54;
                    cv.text(s.what + ':  ' + s.iface.replace(/^de\.bmw\./, '') + '  ·  ' + s.field + (s.get ? '  get' : '') + (s.notify ? '  notify' : ''), 48, y, 20, t.text, { font: 'label', literal: true });
                    cv.text(s.members.slice(0, 10).join(', ').slice(0, 150), 72, y + 24, 16, t.dim, { font: 'label', literal: true });
                });
                return ui.image('MAIN_GFX', cv);
            }
            // the page as the cluster shows it, then what feeds it
            const o = options(), d = all(), list = enabled();
            const sc = drawPieces(pieces(Object.assign({}, o, { pages: page ? [page] : [] })), palette(settings.get('accent'), settings.get('look')), d, SW, SH, page);
            const k = 0.82, pw = Math.round(SW * k), ph = Math.round(SH * k);
            // on the car the screen is a recorder for the GPU draw engine: the preview goes as a pixel image
            // (record.js setImage, uploaded when it changed); a plain canvas (the tests) draws it in place
            if (typeof cv.image === 'function' && record) {
                const sig = previewSig(sc.d);
                if (sig !== lastSig) { lastSig = sig; record.setImage(PREVIEW_ID, SW / 2, SH / 2, half(sc.d, SW, SH)); }   // half size: a quarter of the bytes
                cv.image(PREVIEW_ID, 24, 30, pw, ph);
            } else if (typeof cv.drawImage === 'function') cv.drawImage(sc.d, SW, SH, 24, 30, pw, ph);
            const st = cluster.status(), ds = data.status();
            const x = pw + 52, line = (i, a, b) => { cv.text(a, x, 60 + i * 50, 18, t.dim, { font: 'bold', literal: true }); cv.text(String(b).slice(0, 34), x, 84 + i * 50, 18, t.text, { font: 'label', literal: true }); };
            line(0, 'In the cluster', !showing() ? 'off (stock map)' : st.shown ? 'showing' : presence.active('layouts') ? 'waiting: Cluster Layouts is showing a layout' : 'waiting');
            line(1, 'Page', page ? (list.indexOf(page) + 1) + ' of ' + list.length + ': ' + PAGES[page].title.toLowerCase() : 'none chosen');
            line(2, 'Next page', num('rotate', 0) ? 'every ' + num('rotate', 0) + ' s' : 'with Next page');
            line(3, 'Cluster renderer', st.renderer + ', centre ' + st.target + ', ' + st.layers + ' layers' + (st.refused ? ', refused: ' + st.refused : '') + '   ·   app ' + ((ctx.spec && ctx.spec.version) || ''));
            line(4, 'Engine units (UDS)', ds.diag);
            line(5, 'Shared by apps', ds.providers);
            line(6, '0-60 timer', perf.mode);
            line(7, 'Signals found', sigList.length + ' (press Signals)');
            creditFooter(cv, t);
            return ui.image('MAIN_GFX', cv);
        }
        // a failing frame says why on the screen (and in the log) instead of leaving it blank
        async function safeRender() {
            try { return await render(); } catch (e) {
                log.warn('render: ' + (e && e.stack || e));
                try { const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg); cv.text('Cluster Centre ' + ((ctx.spec && ctx.spec.version) || '') + ': the screen failed to draw', 48, 80, 26, t.text, { font: 'bold', literal: true }); cv.text(String(e && e.message || e).slice(0, 140), 48, 130, 20, t.dim, { font: 'label', literal: true }); return ui.image('MAIN_GFX', cv); } catch (e2) { return null; }
            }
        }
        ctx.loop('MAIN', 2, safeRender);
        safeRender();
    },
});
