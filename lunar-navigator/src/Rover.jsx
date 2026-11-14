// Simulador de rover: se maneja con W/A/S/D sobre el sitio elegido.
//
// Qué es real:    dirección y altura del Sol y la Tierra (JPL Horizons, sitio y fecha de la app),
//                 gravedad lunar (1,62 m/s²), tracción limitada por esa gravedad, sin atmósfera.
// Qué es modelo:  el terreno se genera por computadora (cráteres con la distribución de tamaños típica),
//                 con una semilla fija por sitio. NO es el relieve real de LOLA.
//                 Batería y enlace son un modelo simplificado para jugar.
import { useEffect, useRef, useState } from "react";
import { valueAt, azAt } from "./horizons.js";

const D2R = Math.PI / 180;
const G = 1.62; // gravedad lunar, m/s²
const MU = 0.6; // fricción rueda–regolito
const CRR = 0.08; // resistencia a la rodadura en suelo blando
const VMAX = 5; // m/s (18 km/h, como el rover lunar del Apollo)
const A_MOTOR = 1.1; // m/s²
const WB = 1.8, TRACK = 1.7, STEER_MAX = 0.45;
const N = 384, CELL = 1.5, SIZE = (N - 1) * CELL, HALF = SIZE / 2;
const SAMPLES = 5;
const M = 96, CS = SIZE / M; // grilla gruesa para planificar la ruta (~6 m)
const ROUTE_COL = [[1, 0.25, 0.2], [1, 0.8, 0.15], [0.2, 0.95, 0.4]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Azimut (desde el norte, hacia el este) y elevación -> vector. Mundo: x = este, y = arriba, z = sur.
const skyDir = (az, el) => [Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)];

/* ---------- Terreno ---------- */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function noise2(seed) {
  const h = (i, j) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y); let fx = x - i, fy = y - j;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy - 0.5;
  };
}

function makeTerrain(site) {
  const seed = (Math.imul(Math.round((site.lat + 90) * 1000), 73856093) ^ Math.imul(Math.round((site.lon + 360) * 1000), 19349663)) >>> 0;
  const rnd = mulberry(seed), nz = noise2(seed);
  const polar = Math.abs(site.lat) > 80, rough = polar ? 2 : Math.abs(site.lat) > 50 ? 1.4 : 0.8;
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * CELL, z = j * CELL;
    h[j * N + i] = rough * (5 * nz(x / 130, z / 130) + 1.2 * nz(x / 37, z / 37)) + 0.12 * nz(x / 14, z / 14);
  }
  const craters = [];
  const stamp = (cx, cz, D, fresh) => {
    const R = D / 2, depth = 0.15 * D * fresh, rim = 0.035 * D * fresh, ext = R * 2.5;
    const i0 = Math.max(0, Math.floor((cx - ext + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((cx + ext + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((cz - ext + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((cz + ext + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const r = Math.hypot(i * CELL - HALF - cx, j * CELL - HALF - cz) / R;
      if (r < 1) h[j * N + i] += -depth + (depth + rim) * r * r;
      else if (r < 2.5) h[j * N + i] += rim * Math.pow((2.5 - r) / 1.5, 3);
    }
    craters.push({ x: cx, z: cz, R });
  };
  if (polar) stamp(120, -70, 150, 0.6); // un cráter grande, con el fondo en sombra cuando el Sol está bajo
  const count = Math.round(260 * rough);
  for (let k = 0; k < count; k++) {
    const D = Math.min(90, 4 / Math.sqrt(rnd() + 0.002)), cx = (rnd() - 0.5) * SIZE, cz = (rnd() - 0.5) * SIZE, fresh = 0.3 + rnd() * 0.6;
    if (Math.hypot(cx, cz) < D * 1.3 + 4) continue; // zona de inicio despejada
    stamp(cx, cz, D, fresh);
  }
  let maxH = -1e9;
  for (let k = 0; k < h.length; k++) if (h[k] > maxH) maxH = h[k];
  const beacons = craters.filter((c) => c.R > 5 && c.R < 80 && Math.hypot(c.x, c.z) > 25 && Math.hypot(c.x, c.z) < 190)
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).filter((_, k) => k % 3 === 0).slice(0, SAMPLES)
    .map((c) => ({ x: c.x, z: c.z, taken: false }));
  return { h, maxH, beacons };
}

function heightAt(T, x, z) {
  const fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = T.h, k = j * N + i;
  return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + N] * (1 - u) + h[k + N + 1] * u) * v;
}

// ¿Hay línea de visión libre desde (x, y, z) hacia la dirección d? (para sombra y enlace)
function clearPath(T, x, y, z, d, exact) {
  if (d[1] <= -0.02) return false;
  let t = 0, step = CELL;
  for (let k = 0; k < 400; k++) {
    t += step; step *= 1.03;
    const px = x + d[0] * t, pz = z + d[2] * t, py = y + d[1] * t;
    if (py > T.maxH || Math.abs(px) > HALF || Math.abs(pz) > HALF) return true;
    const ground = exact ? heightAt(T, px, pz) : T.h[Math.round((pz + HALF) / CELL) * N + Math.round((px + HALF) / CELL)];
    if (ground > py) return false;
  }
  return true;
}

function computeLit(T, sun, sunOn, out) {
  if (sunOn <= 0) { out.fill(0); return; }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
    out[j * N + i] = clearPath(T, i * CELL - HALF, T.h[j * N + i] + 0.1, j * CELL - HALF, sun, false) ? sunOn : 0;
}

/* ---------- WebGL ---------- */

const SKY_VS = `#version 300 es
in vec2 aPos; out vec2 vP; void main(){ vP=aPos; gl_Position=vec4(aPos,1.,1.); }`;
const SKY_FS = `#version 300 es
precision highp float; in vec2 vP; out vec4 o;
uniform vec3 uR,uU,uF,uSun,uEarth; uniform vec2 uTan; uniform float uSunOn,uGround;
float hash(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
void main(){
  vec3 d=normalize(uF+vP.x*uTan.x*uR+vP.y*uTan.y*uU), c=vec3(0.);
  if(d.y<-.004){ o=vec4(vec3(uGround),1.); return; }              // suelo lejano, más allá del mapa
  vec3 p=d*110., ip=floor(p), fp=fract(p)-.5; float h=hash(ip);    // estrellas (el cielo lunar es negro también de día)
  c+=step(.992,h)*smoothstep(.16,0.,length(fp))*(.25+.75*hash(ip+7.))*(1.-.75*uSunOn);
  float ca=dot(d,uEarth), rE=.0166;                                // Tierra: ~1,9° de diámetro, con su fase real
  if(ca>cos(rE)){
    vec3 t=normalize(cross(uEarth,vec3(0.,1.,.001))), b=cross(t,uEarth);
    vec2 q=vec2(dot(d,t),dot(d,b))/sin(rE); float z=sqrt(max(0.,1.-dot(q,q)));
    vec3 n=normalize(q.x*t+q.y*b-z*uEarth);
    float cl=hash(floor(vec3(q*6.,1.)));
    c=mix(vec3(.08,.25,.6),vec3(.9),step(.62,cl))*(.03+max(dot(n,uSun),0.))*1.3;
  }
  float cs=dot(d,uSun);                                            // Sol: disco de ~0,5° y resplandor
  c+=vec3(1.,.97,.9)*(smoothstep(cos(.0055),cos(.0042),cs)*3.+pow(max(cs,0.),900.)*.7+pow(max(cs,0.),60.)*.12);
  o=vec4(c,1.);
}`;
const TER_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aLit; uniform mat4 uVP; out vec3 vP,vN; out float vLit;
void main(){ vP=aPos; vN=aNor; vLit=aLit; gl_Position=uVP*vec4(aPos,1.); }`;
const TER_FS = `#version 300 es
precision highp float; in vec3 vP,vN; in float vLit; out vec4 o;
uniform vec3 uSun,uEarth,uRover,uFwd,uEye; uniform float uExp,uHead,uEarthOn,uSunOn;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ return vn(p)*.6+vn(p*3.1)*.3+vn(p*9.7)*.1; }
void main(){
  float dist=length(vP-uEye), k=clamp(30./dist,0.,1.), e=.12, n0=fbm(vP.xz*1.4);
  vec3 n=normalize(vN+k*.035*vec3(n0-fbm((vP.xz+vec2(e,0.))*1.4),0.,n0-fbm((vP.xz+vec2(0.,e))*1.4)));   // rugosidad fina del regolito
  float alb=.42+.14*fbm(vP.xz*.05)+.05*n0;
  vec3 w=uRover+vec3(0.,.8,0.)-vP; float tt=dot(w,uSun);                                              // sombra del rover
  float sh=tt>0.?smoothstep(.75,1.15,length(w-uSun*tt)):1.;
  float L=max(dot(n,uSun),0.)*vLit*sh + .0004+.0012*uEarthOn*(1.-.8*uSunOn)*max(dot(n,uEarth),.2);
  vec3 tp=vP-(uRover+vec3(0.,1.1,0.)); float d=length(tp); tp/=d;                                     // faros
  L+=uHead*.07*smoothstep(.72,.93,dot(tp,uFwd))*max(dot(n,-tp),0.)/(1.+.02*d*d);
  o=vec4(pow(vec3(1.)-exp(-vec3(alb*L*uExp)),vec3(.4545))*vec3(1.,.985,.96),1.);
}`;
const OBJ_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; uniform mat4 uVP,uM; out vec3 vN;
void main(){ vN=mat3(uM)*aNor; gl_Position=uVP*uM*vec4(aPos,1.); }`;
const OBJ_FS = `#version 300 es
precision highp float; in vec3 vN; out vec4 o; uniform vec3 uCol,uSun; uniform float uLit,uExp,uEmis;
void main(){ float L=uLit*max(dot(normalize(vN),uSun),0.)+.0012;
  o=vec4(pow(vec3(1.)-exp(-uCol*L*uExp),vec3(.4545))+uCol*uEmis,1.); }`;

function boxMesh() {
  const v = [], f = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  for (const n of f) {
    const a = Math.abs(n[0]) ? [0, 1, 0] : [1, 0, 0], b = cross(n, a);
    const c = (s, t) => [0, 1, 2].map((i) => (n[i] + a[i] * s + b[i] * t) / 2);
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) v.push(...c(s, t), ...n);
  }
  return new Float32Array(v);
}
function wheelMesh(seg = 16) { // cilindro con el eje en X
  const v = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * 2 * Math.PI, a1 = ((k + 1) / seg) * 2 * Math.PI;
    const p = (a, x) => [x, Math.cos(a) / 2, Math.sin(a) / 2], n = (a) => [0, Math.cos(a), Math.sin(a)];
    v.push(...p(a0, -.5), ...n(a0), ...p(a1, -.5), ...n(a1), ...p(a1, .5), ...n(a1), ...p(a0, -.5), ...n(a0), ...p(a1, .5), ...n(a1), ...p(a0, .5), ...n(a0));
    for (const x of [-.5, .5]) v.push(x, 0, 0, x * 2, 0, 0, ...p(a0, x), x * 2, 0, 0, ...p(a1, x), x * 2, 0, 0);
  }
  return new Float32Array(v);
}

function createGame(canvas, site) {
  const gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) return null;
  const T = makeTerrain(site);
  const program = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    const cache = {};
    return { p, u: (name) => (cache[name] ??= gl.getUniformLocation(p, name)) };
  };
  const sky = program(SKY_VS, SKY_FS), ter = program(TER_VS, TER_FS), obj = program(OBJ_VS, OBJ_FS);
  const vao = (prog, data, attrs, stride) => {
    const va = gl.createVertexArray(); gl.bindVertexArray(va);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (const [name, size, offset] of attrs) {
      const loc = gl.getAttribLocation(prog.p, name);
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4); }
    }
    return va;
  };
  const skyVao = vao(sky, new Float32Array([-1, -1, 3, -1, -1, 3]), [["aPos", 2, 0]], 2);
  const box = boxMesh(), wheel = wheelMesh();
  const boxVao = vao(obj, box, [["aPos", 3, 0], ["aNor", 3, 3]], 6), wheelVao = vao(obj, wheel, [["aPos", 3, 0], ["aNor", 3, 3]], 6);

  // Malla del terreno
  const verts = new Float32Array(N * N * 6);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 6, h = T.h, at = (a, b) => h[clamp(b, 0, N - 1) * N + clamp(a, 0, N - 1)];
    const n = norm([(at(i - 1, j) - at(i + 1, j)) / (2 * CELL), 1, (at(i, j - 1) - at(i, j + 1)) / (2 * CELL)]);
    verts.set([i * CELL - HALF, h[j * N + i], j * CELL - HALF, n[0], n[1], n[2]], k);
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  for (let j = 0, q = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx.set([a, a + N, a + 1, a + 1, a + N, a + N + 1], q); q += 6; }
  const terVao = vao(ter, verts, [["aPos", 3, 0], ["aNor", 3, 3]], 6);
  const litBuf = gl.createBuffer(), lit = new Float32Array(N * N);
  gl.bindBuffer(gl.ARRAY_BUFFER, litBuf); gl.bufferData(gl.ARRAY_BUFFER, lit, gl.DYNAMIC_DRAW);
  const litLoc = gl.getAttribLocation(ter.p, "aLit"); gl.enableVertexAttribArray(litLoc); gl.vertexAttribPointer(litLoc, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const skyState = { sun: [0, 1, 0], earth: [0, 1, 0], sunOn: 0, earthUp: false, sunEl: 0, exp: 4 };
  const fresh = () => ({ x: 0, z: 0, y: heightAt(T, 0, 0), vy: 0, psi: 0, v: 0, u: 0, steer: 0, pitch: 0, roll: 0, air: false, flipped: false });
  const g = {
    T, s: fresh(), battery: 80, lights: false, cam: { yaw: 0, pitch: 0.3, dist: 9, mode: 0, follow: 0 }, samples: 0,
    sunlit: false, link: false, linkWhy: "", acc: 0, tick: 0, odo: 0, guide: true, route: [], routeT: 0, target: null, nav: null,
    // Ruta sugerida al próximo punto: camino de menor costo que evita pendientes fuertes y prefiere sol y señal.
    plan() {
      const s = g.s, open = T.beacons.filter((b) => !b.taken);
      g.target = open.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0] ?? null;
      g.route = [];
      if (!g.target) { g.nav = null; return; }
      const hh = new Float32Array(M * M), good = new Uint8Array(M * M), cost = new Float32Array(M * M).fill(Infinity), next = new Int32Array(M * M).fill(-1);
      const X = (i) => (i + 0.5) * CS - HALF;
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const x = X(i), z = X(j), y = heightAt(T, x, z), k = j * M + i;
        hh[k] = y;
        const sun = lit[Math.round((z + HALF) / CELL) * N + Math.round((x + HALF) / CELL)] > 0.5;
        good[k] = (sun ? 1 : 0) + (skyState.earthUp && clearPath(T, x, y + 1.8, z, skyState.earth, false) ? 1 : 0);
      }
      const cell = (v) => clamp(Math.floor((v + HALF) / CS), 0, M - 1), start = cell(g.target.z) * M + cell(g.target.x);
      const heap = [[0, start]]; cost[start] = 0;
      const pop = () => { let b = 0; for (let q = 1; q < heap.length; q++) if (heap[q][0] < heap[b][0]) b = q; return heap.splice(b, 1)[0]; };
      while (heap.length) {
        const [c, k] = pop();
        if (c > cost[k]) continue;
        const i = k % M, j = (k / M) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if ((!di && !dj) || a < 0 || b < 0 || a >= M || b >= M) continue;
          const n = b * M + a, d = CS * Math.hypot(di, dj), slope = Math.atan(Math.abs(hh[n] - hh[k]) / d) / D2R;
          if (slope > 25) continue; // demasiado empinado para el rover
          const nc = c + d * (1 + 3 * (slope / 25) ** 2 + (2 - good[n]) * 0.8);
          if (nc < cost[n]) { cost[n] = nc; next[n] = k; heap.push([nc, n]); }
        }
      }
      g.nav = { next, good, X, cell };
    },
    trace() {
      const nav = g.nav; g.route = [];
      if (!nav || !g.target) return;
      let k = nav.cell(g.s.z) * M + nav.cell(g.s.x);
      g.route.push([g.s.x, g.s.z, nav.good[k]]);
      k = nav.next[k];
      for (let q = 0; q < 400 && k >= 0; q++) { g.route.push([nav.X(k % M), nav.X((k / M) | 0), nav.good[k]]); k = nav.next[k]; }
    },
    setSky(sunAz, sunEl, earthAz, earthEl) {
      skyState.sun = skyDir(sunAz, sunEl); skyState.earth = skyDir(earthAz, earthEl);
      skyState.sunOn = clamp((sunEl + 0.27) / 0.54, 0, 1); skyState.earthUp = earthEl > 0; skyState.sunEl = sunEl;
      skyState.exp = 1.25 / Math.max(Math.sin(Math.max(sunEl, 0) * D2R), 0.06);
      computeLit(T, skyState.sun, skyState.sunOn, lit);
      gl.bindBuffer(gl.ARRAY_BUFFER, litBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lit);
      g.tick = 1; g.plan();
    },
    reset() { g.s = fresh(); g.battery = Math.max(g.battery, 40); g.plan(); },
    step(dt, keys) {
      const s = g.s;
      if (s.flipped) return;
      let thr = (keys.w ? 1 : 0) - (keys.s ? 1 : 0); const st = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      if (g.battery <= 0) thr = 0;
      s.steer += clamp(st * STEER_MAX - s.steer, -dt * 1.6, dt * 1.6);
      const f = [Math.sin(s.psi), 0, -Math.cos(s.psi)], r = [Math.cos(s.psi), 0, Math.sin(s.psi)];
      const H = (a, b) => heightAt(T, s.x + f[0] * a + r[0] * b, s.z + f[2] * a + r[2] * b);
      const hf = (H(WB / 2, -TRACK / 2) + H(WB / 2, TRACK / 2)) / 2, hb = (H(-WB / 2, -TRACK / 2) + H(-WB / 2, TRACK / 2)) / 2;
      const hl = (H(WB / 2, -TRACK / 2) + H(-WB / 2, -TRACK / 2)) / 2, hr = (H(WB / 2, TRACK / 2) + H(-WB / 2, TRACK / 2)) / 2;
      if (!s.air) {
        const pitch = Math.atan2(hf - hb, WB), roll = Math.atan2(hl - hr, TRACK);
        s.pitch += (pitch - s.pitch) * Math.min(1, dt * 10); s.roll += (roll - s.roll) * Math.min(1, dt * 10);
        if (Math.abs(pitch) > 0.96 || Math.abs(roll) > 0.87) { s.flipped = true; return; }
        const trac = MU * G * Math.cos(pitch) * Math.cos(roll); // con poca gravedad hay poca tracción
        let drive = 0, hold = CRR * G;
        if (thr !== 0 && (thr * s.v >= 0 || Math.abs(s.v) < 0.05)) drive = clamp(thr * A_MOTOR * (1 - Math.min(1, Math.abs(s.v) / VMAX)), -trac, trac);
        else hold = trac * (thr !== 0 || keys[" "] ? 1 : 0.5); // frenar, o motores reteniendo
        if (keys[" "]) hold = trac;
        const push = drive - G * Math.sin(pitch);
        s.v += push * dt;
        const dv = hold * dt;
        s.v = Math.abs(s.v) <= dv && Math.abs(push) < hold ? 0 : s.v - Math.sign(s.v) * Math.min(dv, Math.abs(s.v));
        const side = G * Math.sin(roll); // deslizamiento lateral en pendientes
        s.u += side * dt;
        const du = trac * dt;
        s.u = Math.abs(s.u) <= du && Math.abs(side) < trac ? 0 : s.u - Math.sign(s.u) * Math.min(du, Math.abs(s.u));
        const yaw = clamp((s.v * Math.tan(s.steer)) / WB, -trac / Math.max(Math.abs(s.v), 0.2), trac / Math.max(Math.abs(s.v), 0.2));
        s.psi += yaw * dt;
      }
      const c = Math.cos(s.pitch);
      s.x = clamp(s.x + (f[0] * s.v * c + r[0] * s.u) * dt, -HALF + 6, HALF - 6);
      s.z = clamp(s.z + (f[2] * s.v * c + r[2] * s.u) * dt, -HALF + 6, HALF - 6);
      g.odo += Math.abs(s.v) * dt;
      const ground = heightAt(T, s.x, s.z);
      if (s.air) {
        s.vy -= G * dt; s.y += s.vy * dt; // vuelo balístico
        if (s.y <= ground) { s.y = ground; s.air = false; s.vy = 0; s.v *= 0.9; }
      } else {
        const vyG = (ground - s.y) / dt;
        if ((vyG - s.vy) / dt < -G && Math.abs(s.v) > 1.2) s.air = true; // el suelo cae más rápido que la gravedad: despega
        else { s.y = ground; s.vy = vyG; }
      }
      // Energía (modelo simple) y enlace
      const use = 0.03 + 0.22 * Math.abs(thr) + (g.lights ? 0.06 : 0);
      g.battery = clamp(g.battery + ((g.sunlit ? 0.6 : 0) - use) * dt, 0, 100);
      g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = 0.2;
        g.sunlit = skyState.sunOn > 0.3 && clearPath(T, s.x, s.y + 1.3, s.z, skyState.sun, true);
        const los = skyState.earthUp && clearPath(T, s.x, s.y + 1.8, s.z, skyState.earth, true);
        g.link = los; g.linkWhy = skyState.earthUp ? (los ? "" : "terrain") : "below";
        for (const b of T.beacons) if (!b.taken && Math.hypot(b.x - s.x, b.z - s.z) < 4) { b.taken = true; g.samples++; g.plan(); }
        g.routeT -= 0.2;
        if (g.routeT <= 0) { g.routeT = 0.6; g.trace(); }
      }
    },
    render() {
      const w = canvas.width, h = canvas.height, s = g.s, cam = g.cam;
      gl.viewport(0, 0, w, h);
      const f0 = [Math.sin(s.psi), 0, -Math.cos(s.psi)], r0 = [Math.cos(s.psi), 0, Math.sin(s.psi)];
      const up2 = norm([r0[0] * Math.tan(s.roll) - f0[0] * Math.tan(s.pitch), 1, r0[2] * Math.tan(s.roll) - f0[2] * Math.tan(s.pitch)]); // normal del suelo
      const fw = norm([f0[0] - up2[0] * dot(f0, up2), f0[1] - up2[1] * dot(f0, up2), f0[2] - up2[2] * dot(f0, up2)]);
      const rt = cross(fw, up2), pos = [s.x, s.y, s.z];
      // Cámara
      cam.follow += (((s.psi - cam.follow + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * 0.06;
      let eye, look;
      if (cam.mode === 1) { // desde el mástil
        eye = [s.x + up2[0] * 1.9 + fw[0] * 0.2, s.y + up2[1] * 1.9 + fw[1] * 0.2, s.z + up2[2] * 1.9 + fw[2] * 0.2];
        const a = s.psi + cam.yaw; look = norm([Math.sin(a), fw[1] - (cam.pitch - 0.3), -Math.cos(a)]);
      } else {
        const a = cam.follow + cam.yaw, cp = Math.cos(cam.pitch), tgt = [s.x, s.y + 1.2, s.z];
        eye = [tgt[0] - Math.sin(a) * cam.dist * cp, tgt[1] + Math.sin(cam.pitch) * cam.dist, tgt[2] + Math.cos(a) * cam.dist * cp];
        eye[1] = Math.max(eye[1], heightAt(T, eye[0], eye[2]) + 0.7);
        look = norm([tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]]);
      }
      const cr = norm(cross(look, [0, 1, 0])), cu = cross(cr, look);
      const fov = 60 * D2R, t = 1 / Math.tan(fov / 2), asp = w / h, near = 0.3, far = 4000;
      const P = [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
      const V = [cr[0], cu[0], -look[0], 0, cr[1], cu[1], -look[1], 0, cr[2], cu[2], -look[2], 0, -dot(cr, eye), -dot(cu, eye), dot(look, eye), 1];
      const VP = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) VP[c * 4 + r] = P[r] * V[c * 4] + P[4 + r] * V[c * 4 + 1] + P[8 + r] * V[c * 4 + 2] + P[12 + r] * V[c * 4 + 3];
      const E = skyState.exp;
      // Cielo
      gl.disable(gl.DEPTH_TEST); gl.useProgram(sky.p); gl.bindVertexArray(skyVao);
      gl.uniform3fv(sky.u("uR"), cr); gl.uniform3fv(sky.u("uU"), cu); gl.uniform3fv(sky.u("uF"), look);
      gl.uniform3fv(sky.u("uSun"), skyState.sun); gl.uniform3fv(sky.u("uEarth"), skyState.earth);
      gl.uniform2f(sky.u("uTan"), Math.tan(fov / 2) * asp, Math.tan(fov / 2)); gl.uniform1f(sky.u("uSunOn"), skyState.sunOn);
      gl.uniform1f(sky.u("uGround"), Math.pow(1 - Math.exp(-0.45 * Math.max(skyState.sun[1], 0) * skyState.sunOn * E * 0.5), 0.4545));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Terreno
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.useProgram(ter.p); gl.bindVertexArray(terVao);
      gl.uniformMatrix4fv(ter.u("uVP"), false, VP); gl.uniform3fv(ter.u("uSun"), skyState.sun); gl.uniform3fv(ter.u("uEarth"), skyState.earth);
      gl.uniform3fv(ter.u("uRover"), pos); gl.uniform3fv(ter.u("uFwd"), fw); gl.uniform3fv(ter.u("uEye"), eye);
      gl.uniform1f(ter.u("uExp"), E); gl.uniform1f(ter.u("uHead"), g.lights && g.battery > 0 ? 1 : 0);
      gl.uniform1f(ter.u("uEarthOn"), skyState.earthUp ? 1 : 0); gl.uniform1f(ter.u("uSunOn"), skyState.sunOn);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
      // Rover
      gl.useProgram(obj.p); gl.uniformMatrix4fv(obj.u("uVP"), false, VP); gl.uniform3fv(obj.u("uSun"), skyState.sun); gl.uniform1f(obj.u("uExp"), E);
      const part = (va, count, off, size, col, emis = 0, basis = [rt, up2, [-fw[0], -fw[1], -fw[2]]], origin = pos, lit = g.sunlit ? skyState.sunOn : 0) => {
        const [X, Y, Z] = basis, M = new Float32Array(16);
        for (let i = 0; i < 3; i++) { M[i] = X[i] * size[0]; M[4 + i] = Y[i] * size[1]; M[8 + i] = Z[i] * size[2]; M[12 + i] = origin[i] + X[i] * off[0] + Y[i] * off[1] + Z[i] * off[2]; }
        M[15] = 1;
        gl.bindVertexArray(va); gl.uniformMatrix4fv(obj.u("uM"), false, M); gl.uniform3fv(obj.u("uCol"), col);
        gl.uniform1f(obj.u("uLit"), lit); gl.uniform1f(obj.u("uEmis"), emis); gl.drawArrays(gl.TRIANGLES, 0, count);
      };
      const B = box.length / 6, W = wheel.length / 6;
      part(boxVao, B, [0, 0.72, 0], [1.25, 0.34, 2.1], [0.75, 0.74, 0.7]);
      part(boxVao, B, [0, 0.95, 0.15], [1.5, 0.05, 1.5], [0.1, 0.14, 0.35]); // panel solar
      part(boxVao, B, [0.35, 1.5, -0.75], [0.07, 1.2, 0.07], [0.6, 0.6, 0.6]);
      part(boxVao, B, [0.35, 2.12, -0.78], [0.42, 0.18, 0.22], [0.8, 0.8, 0.82], g.lights ? 0.25 : 0);
      part(boxVao, B, [-0.4, 1.25, 0.7], [0.5, 0.5, 0.06], [0.85, 0.75, 0.35]); // antena
      for (const wx of [-1, 1]) for (const wz of [-0.95, 0, 0.95]) {
        const px = s.x + rt[0] * wx * 0.85 - fw[0] * wz, pz = s.z + rt[2] * wx * 0.85 - fw[2] * wz;
        const py = s.y + rt[1] * wx * 0.85 - fw[1] * wz, lift = s.air ? -0.2 : clamp(heightAt(T, px, pz) - py, -0.28, 0.28);
        part(wheelVao, W, [wx * 0.85, 0.36 + lift, wz], [0.34, 0.72, 0.72], [0.16, 0.16, 0.17]);
      }
      if (g.guide) for (let q = 0; q < g.route.length - 1; q++) { // ruta sugerida, coloreada por tramo
        const a = g.route[q], b = g.route[q + 1], ya = heightAt(T, a[0], a[1]) + 0.15, yb = heightAt(T, b[0], b[1]) + 0.15;
        const dir = [b[0] - a[0], yb - ya, b[1] - a[1]], len = Math.hypot(...dir), z = norm(dir), x = norm(cross(z, [0, 1, 0]));
        part(boxVao, B, [0, 0, 0], [0.45, 0.05, len * (q ? 0.86 : 0.5)], ROUTE_COL[Math.min(a[2], b[2])], 0.75, [x, cross(x, z), z], [(a[0] + b[0]) / 2, (ya + yb) / 2, (a[1] + b[1]) / 2], 0);
      }
      for (const b of T.beacons) if (!b.taken) // puntos de ciencia
        part(boxVao, B, [0, 14, 0], [0.18, 28, 0.18], [0.2, 0.9, 1], 0.8, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [b.x, heightAt(T, b.x, b.z), b.z], 0);
      gl.bindVertexArray(null);
    },
    sky: skyState,
    dispose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
  return g;
}

/* ---------- Componente ---------- */

const KEYMAP = { arrowup: "w", arrowdown: "s", arrowleft: "a", arrowright: "d" };

export default function Rover({ site, table, ms, t, f }) {
  const canvasRef = useRef(null), game = useRef(null), keys = useRef({});
  const [offsetH, setOffsetH] = useState(0);
  const [hud, setHud] = useState(null);
  const [failed, setFailed] = useState(false);
  const now = ms + offsetH * 36e5;

  useEffect(() => { setOffsetH(0); }, [site.id, ms]);

  useEffect(() => {
    const cv = canvasRef.current;
    let g;
    try { g = createGame(cv, site); } catch (err) { console.warn(err); }
    if (!g) { setFailed(true); return; }
    game.current = g;
    const resize = () => { const d = Math.min(1.5, window.devicePixelRatio || 1); cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d); };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();
    const down = (e) => {
      if (e.target.closest?.("input,select,textarea")) return;
      const k = KEYMAP[e.key.toLowerCase()] ?? e.key.toLowerCase();
      if ("wasd ".includes(k)) { keys.current[k] = true; e.preventDefault(); }
      if (e.repeat) return;
      if (k === "r") g.reset();
      if (k === "l") g.lights = !g.lights;
      if (k === "c") g.cam.mode = 1 - g.cam.mode;
      if (k === "g") g.guide = !g.guide;
      if (k === "q") setOffsetH((o) => o - 6);
      if (k === "e") setOffsetH((o) => o + 6);
    };
    const upKey = (e) => { keys.current[KEYMAP[e.key.toLowerCase()] ?? e.key.toLowerCase()] = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", upKey);
    let raf, last = performance.now(), hudT = 0;
    const loop = (time) => {
      const dt = Math.min(0.1, (time - last) / 1000); last = time;
      if (g.ready) {
        g.acc += dt;
        while (g.acc >= 1 / 120) { g.step(1 / 120, keys.current); g.acc -= 1 / 120; }
        g.render();
        hudT -= dt;
        if (hudT <= 0) {
          hudT = 0.15;
          setHud({ v: Math.abs(g.s.v) * 3.6, slope: g.s.pitch / D2R, battery: g.battery, sunlit: g.sunlit, link: g.link, why: g.linkWhy, samples: g.samples,
            total: g.T.beacons.length, next: g.target ? Math.hypot(g.target.x - g.s.x, g.target.z - g.s.z) : null, guide: g.guide, flipped: g.s.flipped, air: g.s.air, lights: g.lights, odo: g.odo, night: g.sky.sunOn < 0.3 });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", down); window.removeEventListener("keyup", upKey); g.dispose(); game.current = null; };
  }, [site.id]);

  // Sol y Tierra reales para el sitio y la hora elegidos
  const sky = table ? { sunEl: valueAt(table, "sun", now), sunAz: azAt(table, "sunAz", now), earthEl: valueAt(table, "earth", now), earthAz: azAt(table, "earthAz", now) } : null;
  useEffect(() => {
    const g = game.current;
    if (!g || !sky) return;
    const id = setTimeout(() => { g.setSky(sky.sunAz, sky.sunEl, sky.earthAz, sky.earthEl); g.ready = true; }, 20);
    return () => clearTimeout(id);
  }, [site.id, !!table, now]);

  const drag = useRef(null);
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, ...game.current?.cam }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    const d = drag.current, g = game.current;
    if (!d || !g) return;
    g.cam.yaw = d.yaw + (e.clientX - d.x) * 0.006; g.cam.pitch = clamp(d.pitch + (e.clientY - d.y) * 0.005, 0.03, 1.3);
  };
  const onWheel = (e) => { const g = game.current; if (g) g.cam.dist = clamp(g.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 4, 60); };
  const hold = (k) => ({ onPointerDown: (e) => { e.preventDefault(); keys.current[k] = true; }, onPointerUp: () => { keys.current[k] = false; }, onPointerLeave: () => { keys.current[k] = false; } });

  if (failed) return <section className="glass view"><p className="loading">{t.rvNoGl}</p></section>;
  const linkText = !hud ? "" : hud.link ? t.rvLinkOk : hud.why === "terrain" ? t.rvLinkTerrain : t.rvLinkBelow;
  return (
    <section className="rover">
      <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onWheel={onWheel} aria-label={t.rover} />
      {(!sky || !hud) && <p className="rv-msg glass">{t.rvLoading}</p>}
      {hud && sky && (
        <>
          <div className="rv-hud glass tl">
            <strong>{site.name}</strong>
            <span>{f.coord(site)}</span>
            <span>{f.full(now)}{offsetH !== 0 && ` (${offsetH > 0 ? "+" : ""}${offsetH} h)`}</span>
            <span className="rv-row"><i className="dot sun" />{t.sun}: {f.deg(sky.sunEl)} · az {Math.round(sky.sunAz)}°</span>
            <span className="rv-row"><i className="dot earth" />{t.earth}: {f.deg(sky.earthEl)} · az {Math.round(sky.earthAz)}°</span>
          </div>
          <div className="rv-hud glass tr">
            <div className="rv-big"><b>{hud.v.toFixed(1)}</b> km/h</div>
            <span>{t.rvSlope}: {hud.slope.toFixed(0)}° · {t.rvOdo}: {hud.odo.toFixed(0)} m</span>
            <span className="rv-row">{t.rvBattery}: <b>{Math.round(hud.battery)}%</b></span>
            <div className="track"><i className={hud.battery < 20 ? "low" : "sun"} style={{ width: `${hud.battery}%` }} /></div>
            <span className="rv-row"><i className={`dot ${hud.sunlit ? "ok" : "bad"}`} />{hud.sunlit ? t.rvCharging : hud.night ? t.rvNight : t.rvShadow}</span>
            <span className="rv-row"><i className={`dot ${hud.link ? "ok" : "bad"}`} />{linkText}</span>
            <span className="rv-row"><i className="dot earth" />{t.rvSamples}: {hud.samples} / {hud.total}</span>
            <span>{hud.next == null ? t.rvAll : `${t.rvNext}: ${hud.next.toFixed(0)} m`}</span>
          </div>
          {(hud.flipped || hud.battery <= 0) && <p className="rv-msg glass">{hud.flipped ? t.rvFlipped : t.rvEmpty}</p>}
          <div className="rv-hud glass bl">
            <strong>{t.rvGoal}</strong>
            {hud.guide && <span className="rv-row">{t.rvLegend} <i className="dot ok" />{t.rvG} <i className="dot warn" />{t.rvY} <i className="dot bad" />{t.rvR}</span>}
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t.rvDrive} · <kbd>␣</kbd> {t.rvBrake} · <kbd>L</kbd> {t.rvLights} · <kbd>C</kbd> {t.rvCam} · <kbd>G</kbd> {t.rvGuide} · <kbd>Q</kbd><kbd>E</kbd> {t.rvTime} · <kbd>R</kbd> {t.rvReset}</span>
            <span className="hint">{t.rvNote}</span>
          </div>
          <div className="rv-pad" aria-hidden="true">
            <button {...hold("w")}>▲</button><button {...hold("a")}>◀</button><button {...hold("s")}>▼</button><button {...hold("d")}>▶</button>
          </div>
        </>
      )}
    </section>
  );
}
