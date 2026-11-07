'use strict';
/**
 * signal_finder.js - which signals this car offers for ranges, fuel and the battery's charge, read from the
 * head unit's own service catalog (/etc/oap/someip/someip-interfaces.json, what the installer builds every
 * app's signal access from). An app can only read a signal its app.json declares, and a declared field the
 * catalog does not have makes the install fail, so the names have to come from the car itself: this lists
 * them on the app's page (and in its log) to be added to app.json.
 */
const fs = require('fs');

const CATALOG = process.env.SOMEIP_CATALOG || '/etc/oap/someip/someip-interfaces.json';
const MATCH = /range|reichweite|remaining|fuel|tank|kraftstoff|soc\b|stateofcharge|chargelevel|charginglevel|hvbattery|highvoltage|electric/i;

/** The member names of a field's data type (structs flattened one level deep, with their parents'). */
function members(db, ref, depth) {
    const d = db.datatypes && db.datatypes[ref];
    if (!d || depth > 2) return [];
    if (d.type === 'typedef') return members(db, d.dataRef || d.baseType, depth);
    if (d.type === 'array') return members(db, d.elementDataRef, depth + 1);
    if (d.type !== 'struct') return [];
    let out = [], dd = d;
    for (;;) {
        out = (dd.members || []).map((m) => m.name).concat(out);
        if (!dd.extends || !db.datatypes[dd.extends]) break;
        dd = db.datatypes[dd.extends];
    }
    return out;
}

/**
 * The candidates: [{ iface, field, get, notify, members: [names] }], those whose own name matches first.
 * opts.path: another catalog (tests); opts.match: another pattern. Returns { list, error }.
 */
function findSignals(opts) {
    let db;
    try { db = JSON.parse(fs.readFileSync((opts && opts.path) || CATALOG, 'utf8')); } catch (e) { return { list: [], error: 'catalog not readable: ' + e.message }; }
    const list = [], re = (opts && opts.match) || MATCH;
    Object.keys(db.interfaces || {}).forEach((iface) => {
        if (!/^de\.bmw\./.test(iface)) return;
        const fields = db.interfaces[iface].fields || {};
        Object.keys(fields).forEach((name) => {
            const f = fields[name], mem = members(db, f.dataRef, 0);
            const own = re.test(name), inMembers = mem.filter((m) => re.test(m));
            if (!own && !inMembers.length) return;
            list.push({ iface, field: name, get: !!(f.getter && f.getter.id), notify: !!f.notifier, members: own ? mem : inMembers, own });
        });
    });
    list.sort((a, b) => (b.own - a.own) || (/range/i.test(b.field + b.members.join()) - /range/i.test(a.field + a.members.join())) || (a.iface + a.field).localeCompare(b.iface + b.field));
    return { list, error: null };
}

module.exports = { findSignals, CATALOG, MATCH };
