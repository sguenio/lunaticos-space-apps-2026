import { useEffect, useMemo, useRef, useState } from "react";
import { vec } from "./horizons.js";

const D2R = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---------- Mapa y relieve reales (NASA SVS, CGI Moon Kit) ----------
   Color: mosaico de la cámara de LRO. Relieve: altimetría LOLA.
   Primero se buscan en public/ (npm run assets) y, si no están, se piden a NASA vía el proxy de Vite.
   Para más nitidez se puede reemplazar public/moon.jpg por una versión 4k/8k convertida a JPG. */

const SVS = "/nasa-svs/vis/a000000/a004700/a004720/";

function loadImage(urls) {
  return new Promise((resolve) => {
    const attempt = (i) => {
      if (i >= urls.length) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => attempt(i + 1);
      img.src = urls[i];
    };
    attempt(0);
  });
}

const PW = 1024, PH = 512; // copia chica en memoria para las miniaturas y el modo sin WebGL
let assetsPromise = null;
export function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      loadImage(["/moon.jpg", SVS + "lroc_color_2k.jpg"]),
      loadImage(["/moon-bump.jpg", SVS + "ldem_3_8bit.jpg"]),
    ]).then(([color, bump]) => {
      let pixels = null;
      if (color) {
        const c = document.createElement("canvas");
        c.width = PW; c.height = PH;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(color, 0, 0, PW, PH);
        pixels = ctx.getImageData(0, 0, PW, PH).data;
      }
      return { color, bump, pixels };
    });
  }
  return assetsPromise;
}

function viewBasis(lat0, lon0) {
  const sl = Math.sin(lat0 * D2R), cl = Math.cos(lat0 * D2R), so = Math.sin(lon0 * D2R), co = Math.cos(lon0 * D2R);
  return { f: [cl * co, cl * so, sl], e: [-so, co, 0], n: [-sl * co, -sl * so, cl] };
}

/* ---------- Dibujo 2D (miniaturas y respaldo sin WebGL) ---------- */

function drawMoon2D(ctx, size, radius, basis, sun, pixels, scale = 1) {
  const img = ctx.createImageData(size, size);
  const { f, e, n } = basis, out = img.data, c = size / 2;
  for (let py = 0; py < size; py++) {
    const y = ((c - py - 0.5) / radius) * scale;
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5 - c) / radius) * scale;
      const r2 = x * x + y * y;
      if (r2 > 1) continue;
      const z = Math.sqrt(1 - r2);
      const p0 = x * e[0] + y * n[0] + z * f[0], p1 = x * e[1] + y * n[1] + z * f[1], p2 = x * e[2] + y * n[2] + z * f[2];
      let r = 150, g = 150, b = 152;
      if (pixels) {
        const u = Math.min(PW - 1, ((Math.atan2(p1, p0) / Math.PI + 1) * 0.5 * PW) | 0); // lon 0° al centro
        const v = Math.min(PH - 1, ((Math.acos(Math.max(-1, Math.min(1, p2))) / Math.PI) * PH) | 0);
        const o = (v * PW + u) * 4;
        r = pixels[o]; g = pixels[o + 1]; b = pixels[o + 2];
      }
      let light = 1.2;
      if (sun) {
        const lam = p0 * sun[0] + p1 * sun[1] + p2 * sun[2];
        light = 0.07 + 1.1 * Math.pow(Math.max(0, lam), 0.7);
      }
      const o = (py * size + px) * 4;
      out[o] = r * light; out[o + 1] = g * light; out[o + 2] = b * light;
      out[o + 3] = scale < 1 ? 255 : 255 * Math.min(1, (1 - Math.sqrt(r2)) * radius);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function SiteThumb({ site }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    loadAssets().then((a) => {
      const ctx = ref.current?.getContext("2d");
      if (alive && ctx) drawMoon2D(ctx, 96, 48, viewBasis(site.lat, site.lon), null, a.pixels, 0.3);
    });
    return () => { alive = false; };
  }, [site.lat, site.lon]);
  return <canvas ref={ref} width="96" height="96" className="thumb" aria-hidden="true" />;
}

/* ---------- Dibujo WebGL: mapa a resolución completa + sombras del relieve ---------- */

const VS = `#version 300 es
in vec2 aPos; out vec2 vP;
void main(){ vP = aPos; gl_Position = vec4(aPos, 0., 1.); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform vec3 uE, uN, uF, uSun;
uniform float uK, uAA, uLit, uHasTex, uHasBump, uRelief;
uniform sampler2D uTex, uBump;
uniform vec2 uTexel;
const float PI = 3.14159265359;
void main(){
  vec2 q = vP * uK;
  float r2 = dot(q, q);
  if (r2 > 1.) discard;
  float r = sqrt(r2), z = sqrt(1. - r2);
  vec3 p = q.x * uE + q.y * uN + z * uF;                       // punto de la superficie lunar
  vec2 uv = vec2(atan(p.y, p.x) / (2. * PI) + .5, .5 - asin(clamp(p.z, -1., 1.)) / PI);
  vec3 col = uHasTex > .5 ? texture(uTex, uv).rgb : vec3(.58);
  vec3 n = p;
  if (uHasBump > .5) {                                          // normal inclinada según la pendiente del terreno
    float cl = max(sqrt(1. - p.z * p.z), .05);
    vec3 T = vec3(-p.y, p.x, 0.) / cl, B = cross(p, T);
    float he = texture(uBump, uv + vec2(uTexel.x, 0.)).r - texture(uBump, uv - vec2(uTexel.x, 0.)).r;
    float hn = texture(uBump, uv - vec2(0., uTexel.y)).r - texture(uBump, uv + vec2(0., uTexel.y)).r;
    n = normalize(p - uRelief * (he / cl * T + hn * B));
  }
  float light = 1.08;
  if (uLit > .5) {
    float day = smoothstep(-.03, .05, dot(p, uSun));            // lado de día según el Sol real
    light = .055 + 1.2 * pow(max(dot(n, uSun), 0.), .65) * day;
  }
  float a = clamp((1. - r) / uAA, 0., 1.);
  o = vec4(col * light * a, a);
}`;

function createRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.warn("WebGL no disponible, se usa el dibujo 2D:", err);
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (name) => gl.getUniformLocation(prog, name);
  const has = { tex: 0, bump: 0 };
  let texel = [1 / 1024, 1 / 512];

  const upload = (unit, img) => {
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let src = img;
    if (img.naturalWidth > max) { // textura más grande de lo que soporta la placa: se reduce
      src = document.createElement("canvas");
      src.width = max; src.height = Math.round((img.naturalHeight * max) / img.naturalWidth);
      src.getContext("2d").drawImage(img, 0, 0, src.width, src.height);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return [1 / src.width, 1 / src.height];
  };

  return {
    setAssets({ color, bump }) {
      if (color) { upload(0, color); has.tex = 1; }
      if (bump) { texel = upload(1, bump); has.bump = 1; }
    },
    draw(basis, sun, radiusFrac) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform3fv(U("uE"), basis.e); gl.uniform3fv(U("uN"), basis.n); gl.uniform3fv(U("uF"), basis.f);
      gl.uniform3fv(U("uSun"), sun ?? [0, 0, 1]);
      gl.uniform1f(U("uLit"), sun ? 1 : 0);
      gl.uniform1f(U("uK"), 1 / radiusFrac);
      gl.uniform1f(U("uAA"), 3 / (canvas.width * radiusFrac));
      gl.uniform1f(U("uHasTex"), has.tex); gl.uniform1f(U("uHasBump"), has.bump);
      gl.uniform1f(U("uRelief"), 3.0); // relieve exagerado ~3x para que los cráteres se lean
      gl.uniform2fv(U("uTexel"), texel);
      gl.uniform1i(U("uTex"), 0); gl.uniform1i(U("uBump"), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/* ---------- Componente ---------- */

const CV = 560, C = CV / 2, RF = 0.78, R = C * RF; // unidades del SVG superpuesto
const PIN = "M0 0C-5-7-9-11-9-16a9 9 0 1 1 18 0c0 5-4 9-9 16z";

export default function Globe({ sites, selected, statuses, onSelect, sunDir, earthDir, sunUp, earthUp, labels }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const renderer = useRef(null);
  const drag = useRef(null);
  const [mode, setMode] = useState("gl");
  const [assets, setAssets] = useState(null);
  const [px, setPx] = useState(0);
  const focus = (s) => ({ lat: s.lat * 0.5, lon: Math.abs(s.lon) > 90 ? s.lon : s.lon * 0.5 });
  const [view, setView] = useState(() => focus(selected));
  const basis = useMemo(() => viewBasis(view.lat, view.lon), [view]);

  useEffect(() => { loadAssets().then(setAssets); }, []);
  useEffect(() => setView(focus(selected)), [selected.id]);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setPx(Math.round(e.contentRect.width * Math.min(2, window.devicePixelRatio || 1))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !px) return;
    if (mode === "gl") {
      if (!renderer.current || renderer.current.canvas !== cv) {
        const r = createRenderer(cv);
        if (!r) { setMode("2d"); return; }
        renderer.current = Object.assign(r, { canvas: cv, loaded: null });
      }
      if (cv.width !== px) { cv.width = px; cv.height = px; }
      if (assets && renderer.current.loaded !== assets) { renderer.current.setAssets(assets); renderer.current.loaded = assets; }
      renderer.current.draw(basis, sunDir, RF);
    } else {
      const size = Math.min(px, 560);
      if (cv.width !== size) { cv.width = size; cv.height = size; }
      drawMoon2D(cv.getContext("2d"), size, (size / 2) * RF, basis, sunDir, assets?.pixels);
    }
  }, [mode, px, basis, sunDir, assets]);

  const project = (v) => ({ x: C + R * dot(v, basis.e), y: C - R * dot(v, basis.n), front: dot(v, basis.f) > 0 });
  const around = (v, k) => { // ubicación del Sol / Tierra alrededor del globo, según su dirección real
    const x = dot(v, basis.e), y = dot(v, basis.n), l = Math.hypot(x, y) || 1;
    return { x: C + (R * k * x) / l, y: C - (R * k * y) / l };
  };
  const sp = project(vec(selected.lat, selected.lon));
  const sunP = sunDir && around(sunDir, 1.16), earthP = earthDir && around(earthDir, 1.16);
  const tagW = (text) => text.length * 7.4 + 22;

  const onDown = (ev) => { drag.current = { x: ev.clientX, y: ev.clientY, ...view }; ev.currentTarget.setPointerCapture(ev.pointerId); };
  const onMove = (ev) => {
    const d = drag.current;
    if (!d) return;
    const k = 150 / (wrap.current?.clientWidth || 500);
    setView({ lat: Math.max(-90, Math.min(90, d.lat + (ev.clientY - d.y) * k)), lon: d.lon - (ev.clientX - d.x) * k });
  };

  return (
    <div className="globe" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <canvas key={mode} ref={canvas} aria-label={labels.dragHint} />
      <svg viewBox={`0 0 ${CV} ${CV}`}>
        <defs>
          <radialGradient id="g-sun"><stop offset="0" stopColor="#fff6d6" /><stop offset=".35" stopColor="#ffc24a" /><stop offset="1" stopColor="#ffc24a" stopOpacity="0" /></radialGradient>
          <radialGradient id="g-earth" cx=".35" cy=".3"><stop offset="0" stopColor="#7cc4ff" /><stop offset=".6" stopColor="#1f6fd1" /><stop offset="1" stopColor="#0b2f6b" /></radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R * 1.08} className="orbit" />
        {sp.front && sunP && sunUp && <line x1={sp.x} y1={sp.y} x2={sunP.x} y2={sunP.y} className="ray sun" />}
        {sp.front && earthP && earthUp && <line x1={sp.x} y1={sp.y} x2={earthP.x} y2={earthP.y} className="ray earth" />}
        {sunP && (
          <g transform={`translate(${sunP.x} ${sunP.y})`}>
            <circle r="26" fill="url(#g-sun)" /><circle r="9" fill="#fff3c4" />
            <g transform="translate(0 -30)"><rect x={-tagW(labels.sun) / 2} y="-11" width={tagW(labels.sun)} height="22" rx="11" className="tag" /><text className="tag-t" y="4">{labels.sun}</text></g>
          </g>
        )}
        {earthP && (
          <g transform={`translate(${earthP.x} ${earthP.y})`}>
            <circle r="14" fill="url(#g-earth)" />
            <path d="M-7-6c3-3 7-2 8 1s-2 5-5 4-5-3-3-5zM2 4c3-2 8 0 7 3s-5 4-7 3-2-4 0-6z" fill="#3fa66b" opacity=".85" />
            <g transform="translate(0 -28)"><rect x={-tagW(labels.earth) / 2} y="-11" width={tagW(labels.earth)} height="22" rx="11" className="tag" /><text className="tag-t" y="4">{labels.earth}</text></g>
          </g>
        )}
        {sites.map((s) => {
          const p = project(vec(s.lat, s.lon));
          if (!p.front || s.id === selected.id) return null;
          return (
            <g key={s.id} className={`pin ${statuses[s.id] ?? "none"}`} transform={`translate(${p.x} ${p.y})`}
              onPointerDown={(e) => e.stopPropagation()} onClick={() => onSelect(s.id)}>
              <title>{s.name}</title>
              <path d={PIN} /><circle cy="-16" r="3.4" className="hole" />
            </g>
          );
        })}
        {sp.front && (
          <g className="pin sel" transform={`translate(${sp.x} ${sp.y})`}>
            <ellipse rx="20" ry="7" className="ring" /><ellipse rx="12" ry="4" className="ring" />
            <path d={PIN} transform="scale(1.3)" /><circle cy="-20.8" r="4.4" className="hole" />
            <line x1="11" y1="-18" x2="24" y2="-29" className="lead" />
            <g transform="translate(24 -29)">
              <rect y="-13" width={tagW(selected.name)} height="26" rx="9" className="tag sel" />
              <text x="11" y="4.5" className="tag-t left">{selected.name}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
