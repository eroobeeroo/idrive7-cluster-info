'use strict';
/**
 * preview.js - draws a layout as the cluster would: the scene engine.js makes (tools/scene.js), each layer's
 * GLSL ES 1.00 shader compiled and run in WebGL 1 (the same shader language the KOMBI's renderer runs) in
 * headless Chromium, at 1920x720. Fails if a shader does not compile.
 *
 *   node tools/preview.js [--layout analog_sport] [--look comfort|sport|efficient] [--centre info|stock] [--kmh]
 *                         [--black] [--speed 62] [--rpm 3200] [--gear 4] [--stage D] [--mode S] [--oil 96] [--coolant 90]
 *                         [--mcar] [--out preview.png]
 * --mcar: Settings > Cluster M car, with the M KOMBI's two dark boxes drawn over the layout as on the car
 */
const fs = require('fs');
const path = require('path');
const { makeScene } = require('./scene');

/* the service's quad vertex shader (cluster-render src/compositor.cpp), with the quad placed in pixels */
const VS = `#version 100
attribute vec2 a_position;
uniform mat4 u_mvp;
varying vec2 v_uv;
void main() {
    v_uv = vec2(a_position.x, 1.0 - a_position.y);
    gl_Position = u_mvp * vec4(a_position, 0.0, 1.0);
}`;

function args(argv) {
    const a = { layout: 'analog_sport', look: 'comfort', mode: null, centre: 'info', kmh: false, speed: 62, rpm: 3200, gear: 4, stage: 'D', oil: 96, coolant: 90, outside: 9, soc: 64, kw: -12.4, erange: 29, frange: 520, fuel: 55, gearbox: 78, iat: 31, batt: 27, boost: 0.82, split: 62, out: 'preview.png', scale: 1 };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i].replace(/^--/, '');
        if (k === 'kmh') a.kmh = true;
        else if (k === 'black') a.black = true;
        else if (k === 'mcar') a.mcar = true;
        else if (k === 'engine') a.engine = true;
        else a[k] = isNaN(Number(argv[i + 1])) ? argv[++i] : Number(argv[++i]);
    }
    return a;
}

/** The page: draws the scene with WebGL, quad by quad, alpha-blended in order. */
function page(scene, mapWindow, over) {
    /* with the map in the centre, a stand-in for it behind the cluster's layers, where slot 0x100 shows */
    const map = mapWindow ? `<div style="position:absolute;left:416px;top:120px;width:1088px;height:480px;background:#1b222b;
background-image:linear-gradient(28deg,transparent 47%,#3a4656 47%,#3a4656 53%,transparent 53%),linear-gradient(-62deg,transparent 48%,#2f3a48 48%,#2f3a48 52%,transparent 52%),
linear-gradient(90deg,transparent 30%,#4ea3ff 30%,#4ea3ff 31.4%,transparent 31.4%);background-size:260px 200px,340px 300px,100% 100%;
color:#6f7f92;font:600 22px sans-serif;display:flex;align-items:center;justify-content:center">map</div>` : '';
    return `<!doctype html><html><body style="margin:0;background:#000;position:relative">${map}
<canvas id="c" width="${scene.w}" height="${scene.h}" style="position:absolute;left:0;top:0"></canvas>
${(over || []).map((b) => `<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:#020202;outline:1px solid #2a2a2a"></div>`).join('')}
<script>
const S = ${JSON.stringify(scene)};
const TIME = ${Number(scene.time) || 0};   /* the renderer's clock for animated pieces (--time s) */
const VS = ${JSON.stringify(VS)};
const MAPW = ${mapWindow ? 'true' : 'false'};
const gl = document.getElementById('c').getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
const errors = [];
function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) errors.push(gl.getShaderInfoLog(s) + '\\n' + src.slice(0, 200)); return s; }
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
const tex = {};
for (const k in S.assets) {
  const a = S.assets[k], bin = atob(a.px), px = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, a.w, a.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  tex[k] = t;
}
gl.viewport(0, 0, S.w, S.h); gl.clearColor(0, 0, 0, MAPW ? 0 : 1); gl.clear(gl.COLOR_BUFFER_BIT);
gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
for (const q of S.quads) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, q.fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { errors.push('link: ' + gl.getProgramInfoLog(p)); continue; }
  gl.useProgram(p);
  const loc = gl.getAttribLocation(p, 'a_position'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  /* pixels -> clip space, y down: x' = 2(x + u w)/W - 1, y' = 1 - 2(y + (1 - v) h)/H (a_position.y = 1 at the top) */
  const m = new Float32Array([2*q.w/S.w,0,0,0, 0,2*q.h/S.h,0,0, 0,0,1,0, 2*q.x/S.w-1, 1-2*(q.y+q.h)/S.h, 0,1]);
  gl.uniformMatrix4fv(gl.getUniformLocation(p, 'u_mvp'), false, m);
  for (const n in q.uniforms) {
    const u = q.uniforms[n], v = u.v, t = u.type;
    const l = gl.getUniformLocation(p, t ? n + '[0]' : n) || gl.getUniformLocation(p, n);
    if (!l) continue;
    const w = t === 'vec4' ? 4 : t === 'vec3' ? 3 : t === 'vec2' ? 2 : v.length;
    if (w === 1) gl.uniform1fv(l, v); else if (w === 2) gl.uniform2fv(l, v); else if (w === 3) gl.uniform3fv(l, v); else gl.uniform4fv(l, v);
  }
  let unit = 0;
  { const lt = gl.getUniformLocation(p, 'u_time'); if (lt) gl.uniform1f(lt, TIME); }
  for (const s in q.binds) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[q.binds[s]]); gl.uniform1i(gl.getUniformLocation(p, s), unit); unit++; }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
window.__errors = errors; window.__done = true;
</script></body></html>`;
}

async function render(scene, out, mapWindow, over) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const p = await browser.newPage({ viewport: { width: scene.w, height: scene.h }, deviceScaleFactor: 1 });

        await p.setContent(page(scene, mapWindow, over));
        await p.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
        const errors = await p.evaluate(() => window.__errors);
        await p.screenshot({ path: out, clip: { x: 0, y: 0, width: scene.w, height: scene.h } });
        return errors;
    } finally { await browser.close(); }
}

if (require.main === module) {
    const a = args(process.argv.slice(2));
    const s = makeScene({ layout: a.layout, look: a.look, black: !!a.black, options: { centre: a.centre, speedUnit: a.kmh ? 'kmh' : 'mph', vehicle: a.engine ? 'ice' : 'phev', cluster: a.mcar ? 'm' : 'standard' },
        data: { speed: a.speed * (a.kmh ? 1 : 1.609344), rpm: a.rpm, gear: a.gear, stage: a.stage, mode: a.mode, driveMode: a.drive, oil: a.oil, coolant: a.coolant, outside: a.outside, soc: a.soc, kw: a.kw, erange: a.erange, frange: a.frange,
            gearbox: a.gearbox, iat: a.iat, battTemp: a.batt, boostActual: a.boost, torque: 312, timing: 14.5, hpfp: 205, boostTarget: 0.9, splitRear: a.split, engineOn: a.rpm > 300, fuelPct: a.fuel, pdDrive: 62, pdClimate: 24, pdSeats: 14 } });
    // let the needles ease to their readings
    // two minutes first, on a made-up clock, so trend lines have a past
    const base = Object.assign({}, s.data()), now = Date.now;
    let fake = now() - 130000;
    Date.now = () => fake;
    for (let i = 0; i < 132; i++) {
        fake += 1000;
        const f = i / 132, wob = (v, b) => (typeof v === 'number' ? v + b * Math.sin(i / 7) + b * 0.5 * Math.sin(i / 2.3) : v);
        s.setData(Object.assign({}, base, { oil: wob(base.oil - 12 * (1 - f), 1.2), coolant: wob(base.coolant - 5 * (1 - f), 0.8), gearbox: wob(base.gearbox - 9 * (1 - f), 1),
            iat: wob(base.iat, 4), battTemp: wob(base.battTemp, 0.6), boostActual: Math.max(-0.3, wob(base.boostActual, 0.5)) }));
        s.engine._tick();
    }
    s.setData(base);
    for (let i = 0; i < 40; i++) { fake += 40; s.engine._tick(); }
    Date.now = now;
    const scene = s.scene();
    s.stop();
    scene.time = a.time || 0;
    render(scene, a.out, a.centre === 'map', a.mcar ? require('../apps/cluster_layouts/layout_common').M_BOXES : []).then((errors) => {
        if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
        console.log('wrote ' + path.resolve(a.out) + ' (' + scene.quads.length + ' layers)');
        process.exit(0);
    }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { render, page };
