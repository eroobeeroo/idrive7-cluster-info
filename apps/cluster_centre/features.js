'use strict';
/**
 * features.js - what Cluster Centre works out from the readings: the warm-up guide, the turbo cool-down and
 * the 0-60 / quarter-mile timer. Each is fed samples (time in ms and the car's data) and holds no timers of
 * its own, so tests can drive them with any clock.
 */
const isNum = (v) => typeof v === 'number' && isFinite(v);

/**
 * Warm-up: how fast the oil is warming (°C a minute, over the last few minutes), when it reaches the target
 * temperature, and a safe rev limit that rises from the cold limit (at COLD_C) to the redline (at the target).
 */
class WarmUp {
    constructor(o) { this.o = Object.assign({ target: 90, coldLimit: 3500, redline: 7000 }, o); this.hist = []; }
    feed(t, d) {
        if (!isNum(d.oil)) return;
        const h = this.hist;
        if (!h.length || t - h[h.length - 1].t >= 5000) h.push({ t, c: d.oil });
        while (h.length && t - h[0].t > 5 * 60000) h.shift();
    }
    /** °C a minute over the history (null until 1 minute of it). */
    rate() {
        const h = this.hist;
        if (h.length < 2 || h[h.length - 1].t - h[0].t < 60000) return null;
        return (h[h.length - 1].c - h[0].c) / ((h[h.length - 1].t - h[0].t) / 60000);
    }
    /** { oil, ready, minutes (to the target, null unknown), limit (rpm) }. */
    state(d) {
        const o = this.o, oil = d.oil;
        if (!isNum(oil)) return { oil: null, ready: false, minutes: null, limit: null };
        const ready = oil >= o.target, r = this.rate();
        const minutes = ready ? 0 : r && r > 0.05 ? Math.min(99, (o.target - oil) / r) : null;
        const COLD_C = 40, f = Math.max(0, Math.min(1, (oil - COLD_C) / (o.target - COLD_C)));
        const limit = Math.round((o.coldLimit + (o.redline - o.coldLimit) * f) / 100) * 100;
        return { oil, ready, minutes, limit };
    }
}

/**
 * Turbo cool-down: time driven hard (engine speed or engine torque over the limits) builds up a cool-down of
 * 30 s to 3 min, which counts down only while driving gently or idling.
 */
class CoolDown {
    constructor(o) { this.o = Object.assign({ hardRpm: 4500, hardNm: 400, gentleRpm: 3000 }, o); this.hard = 0; this.left = 0; this.last = null; }
    feed(t, d) {
        const dt = this.last === null ? 0 : Math.min(2000, t - this.last);
        this.last = t;
        const o = this.o, hard = (isNum(d.rpm) && d.rpm >= o.hardRpm) || (isNum(d.torque) && d.torque >= o.hardNm);
        if (hard) {
            this.hard += dt;
            this.left = Math.max(this.left, Math.min(180000, 30000 + this.hard * 1.5));
        } else if (isNum(d.rpm) && d.rpm < o.gentleRpm) {
            this.left = Math.max(0, this.left - dt);
            if (this.left === 0) this.hard = 0;
        }
    }
    /** { active, seconds, total } */
    state() { return { active: this.left > 0, seconds: Math.ceil(this.left / 1000), total: Math.min(180, Math.round((30000 + this.hard * 1.5) / 1000)) }; }
}

/**
 * The 0-60 mph (0-100 km/h) and quarter-mile timer: armed from the app, ready once stopped, started as the
 * car moves off, the times and the quarter's trap speed kept as the last run and the best.
 */
const QUARTER_M = 402.336;
class PerfTimer {
    constructor(o) { this.o = Object.assign({ kmh: false }, o); this.mode = 'off'; this.last = null; this.best = {}; this.run = null; }
    /** The target speed in km/h: 60 mph or 100 km/h. */
    target() { return this.o.kmh ? 100 : 60 * 1.609344; }
    arm() { this.mode = 'armed'; this.run = null; }
    cancel() { this.mode = 'off'; this.run = null; }
    feed(t, d) {
        const v = d.speed;
        if (!isNum(v) || this.mode === 'off' || this.mode === 'done') return;
        if (this.mode === 'armed' && v < 0.5) this.mode = 'ready';
        else if (this.mode === 'ready' && v >= 0.8) { this.mode = 'running'; this.run = { t0: t, lt: t, lv: v, dist: 0, sixty: null, quarter: null, trap: null }; }
        else if (this.mode === 'running') {
            const r = this.run, dt = (t - r.lt) / 1000;
            r.dist += (r.lv + v) / 2 / 3.6 * dt;
            if (r.sixty === null && v >= this.target()) r.sixty = (t - r.t0) / 1000 - (v - this.target()) / Math.max(0.1, (v - r.lv) / Math.max(dt, 0.001)) ;
            if (r.quarter === null && r.dist >= QUARTER_M) { r.quarter = (t - r.t0) / 1000; r.trap = v; }
            r.lt = t; r.lv = v;
            // done: the quarter reached, or stopped again
            if (r.quarter !== null || (v < 0.5 && t - r.t0 > 1000)) {
                this.mode = 'done';
                this.last = { sixty: r.sixty, quarter: r.quarter, trap: r.trap };
                ['sixty', 'quarter'].forEach((k) => { if (isNum(r[k]) && (!isNum(this.best[k]) || r[k] < this.best[k])) { this.best[k] = r[k]; if (k === 'quarter') this.best.trap = r.trap; } });
            }
        }
    }
    /** { mode, elapsed (s, running), speed, last, best } */
    state(t) { return { mode: this.mode, elapsed: this.run && this.mode === 'running' ? (t - this.run.t0) / 1000 : null, last: this.last, best: this.best, run: this.run }; }
}

module.exports = { WarmUp, CoolDown, PerfTimer, QUARTER_M };
