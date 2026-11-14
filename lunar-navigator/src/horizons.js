// Datos reales de NASA/JPL Horizons (https://ssd.jpl.nasa.gov/horizons/).
// Todo lo que muestra la app sale de acá: no hay fórmulas propias de posición.

const HOUR = 36e5;
export const DAY = 864e5;
export const STEP = HOUR; // un dato por hora
const ENDPOINT = "/horizons"; // ver proxy en vite.config.js
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const pad = (n) => String(n).padStart(2, "0");
function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function horizonsUrl(params, base = ENDPOINT) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${k === "format" ? v : encodeURIComponent(`'${v}'`)}`)
    .join("&");
  return `${base}?${qs}`;
}

// Horizons pide no mandar consultas en paralelo: las encolamos de a una.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

// Registro de todo lo que se le pide a Horizons (lo muestra la pestaña Datos).
export const requestLog = [];
const logListeners = new Set();
export function onLog(cb) { logListeners.add(cb); return () => logListeners.delete(cb); }
function logAdd(entry) {
  requestLog.unshift(entry);
  if (requestLog.length > 200) requestLog.pop();
  logTouch();
  return entry;
}
function logTouch() { for (const cb of logListeners) cb(); }

async function fetchRows(params, meta = {}) {
  const full = { format: "text", OBJ_DATA: "NO", CSV_FORMAT: "YES", ...params };
  const entry = logAdd({ id: Math.random().toString(36).slice(2), at: Date.now(), ...meta, source: "network", status: "pending", rows: null, ms: null,
    url: horizonsUrl(full, "https://ssd.jpl.nasa.gov/api/horizons.api") });
  const t0 = performance.now();
  try {
    const rows = await fetchRowsRaw(full);
    Object.assign(entry, { status: "ok", rows: rows.length, ms: Math.round(performance.now() - t0) });
    return rows;
  } catch (err) {
    Object.assign(entry, { status: "error", ms: Math.round(performance.now() - t0), error: err.message });
    throw err;
  } finally { logTouch(); }
}

async function fetchRowsRaw(full) {
  const res = await fetch(horizonsUrl(full));
  if (!res.ok) throw new Error(`JPL Horizons respondió HTTP ${res.status}`);
  const text = await res.text();
  const a = text.indexOf("$$SOE"), b = text.indexOf("$$EOE");
  if (a < 0 || b < 0) throw new Error("JPL Horizons no devolvió datos: " + text.trim().slice(-200));
  return text.slice(a + 5, b).trim().split("\n").map((line) => {
    const p = line.split(",").map((s) => s.trim());
    const m = p[0].match(/^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) throw new Error("Formato de fecha inesperado en Horizons: " + p[0]);
    return { t: Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5]), v: p.slice(1).filter((s) => s !== "" && s !== "*" && !/^[A-Za-z]$/.test(s)).map(Number) };
  });
}

function cached(key, loader, meta) {
  try {
    const hit = localStorage.getItem(key);
    if (hit) {
      const data = JSON.parse(hit);
      logAdd({ id: key, at: Date.now(), ...meta, source: "cache", status: "ok", rows: (data.sun ?? data.earth).length, ms: 0 });
      return Promise.resolve(data);
    }
  } catch { /* sin localStorage: seguimos sin caché */ }
  return loader().then((data) => {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* caché llena */ }
    return data;
  });
}

const memo = new Map();
function once(key, loader, meta) {
  if (!memo.has(key)) {
    const p = cached(key, loader, meta);
    p.catch(() => memo.delete(key)); // permite reintentar
    memo.set(key, p);
  }
  return memo.get(key);
}

const lon360 = (lon) => ((lon % 360) + 360) % 360;
const span = (startMs, stopMs) => ({ START_TIME: fmtTime(startMs), STOP_TIME: fmtTime(stopMs), STEP_SIZE: "1h" });

// Parámetros de la consulta "cuerpo visto desde un punto de la superficie lunar".
// QUANTITIES 4 = azimut y elevación aparentes (sin atmósfera).
export function siteQuery(site, body, startMs, stopMs) {
  return {
    COMMAND: body === "sun" ? "10" : "399",
    CENTER: "coord@301",
    SITE_COORD: `${lon360(site.lon)},${site.lat},${site.alt ?? 0}`,
    QUANTITIES: "4",
    ...span(startMs, stopMs),
  };
}

// Elevación (y azimut) del Sol y la Tierra, hora por hora, en un sitio.
export function loadSite(site, startMs, stopMs) {
  const key = `lln1:site:${lon360(site.lon)},${site.lat},${site.alt ?? 0}:${startMs}:${stopMs}`;
  return once(key, async () => {
    const sun = await enqueue(() => fetchRows(siteQuery(site, "sun", startMs, stopMs), { what: "sun", site: site.name, from: startMs, to: stopMs }));
    const earth = await enqueue(() => fetchRows(siteQuery(site, "earth", startMs, stopMs), { what: "earth", site: site.name, from: startMs, to: stopMs }));
    if (!sun.length || sun.length !== earth.length) throw new Error("Horizons devolvió tablas incompletas");
    return {
      t0: sun[0].t,
      sun: sun.map((r) => r.v[1]), sunAz: sun.map((r) => r.v[0]),
      earth: earth.map((r) => r.v[1]), earthAz: earth.map((r) => r.v[0]),
    };
  }, { what: "site", site: site.name, from: startMs, to: stopMs });
}

// Puntos subterrestre y subsolar sobre la Luna (para iluminar el globo).
// QUANTITIES 14 = sub-observador (lon, lat); 15 = sub-solar (lon, lat). Longitud este positiva.
export function loadMoon(startMs, stopMs) {
  return once(`lln1:moon:${startMs}:${stopMs}`, async () => {
    const rows = await enqueue(() => fetchRows({ COMMAND: "301", CENTER: "500@399", QUANTITIES: "14,15", ...span(startMs, stopMs) }, { what: "moon", site: "", from: startMs, to: stopMs }));
    return { t0: rows[0].t, earth: rows.map((r) => [r.v[1], r.v[0]]), sun: rows.map((r) => [r.v[3], r.v[2]]) }; // [lat, lon]
  }, { what: "moon", site: "", from: startMs, to: stopMs });
}

/* ---------- Lectura de las tablas ---------- */

const D2R = Math.PI / 180;
export function vec(lat, lon) {
  const cl = Math.cos(lat * D2R);
  return [cl * Math.cos(lon * D2R), cl * Math.sin(lon * D2R), Math.sin(lat * D2R)];
}

function locate(table, arr, ms) {
  const x = Math.max(0, Math.min(arr.length - 1, (ms - table.t0) / STEP));
  const i = Math.min(arr.length - 2, Math.floor(x));
  return [i, x - i];
}

export function valueAt(table, key, ms) {
  const arr = table[key];
  const [i, f] = locate(table, arr, ms);
  return arr[i] + (arr[i + 1] - arr[i]) * f;
}

export function dirAt(moon, key, ms) {
  const arr = moon[key];
  const [i, f] = locate(moon, arr, ms);
  const a = vec(...arr[i]), b = vec(...arr[i + 1]);
  const v = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}

// Horas hasta que el cuerpo cruza el horizonte; null si no cruza dentro de los datos.
function hoursToCrossing(table, key, ms) {
  const arr = table[key];
  const x = Math.max(0, (ms - table.t0) / STEP);
  let prevPos = x, prevVal = valueAt(table, key, ms);
  const up = prevVal > 0;
  for (let k = Math.floor(x) + 1; k < arr.length; k++) {
    const val = arr[k];
    if (val > 0 !== up) return prevPos + ((k - prevPos) * prevVal) / (prevVal - val) - x;
    prevPos = k; prevVal = val;
  }
  return null;
}

// % de los próximos `days` días con el cuerpo sobre el horizonte.
function share(table, key, ms, days) {
  const arr = table[key];
  const i0 = Math.max(0, Math.round((ms - table.t0) / STEP));
  const i1 = Math.min(arr.length - 1, i0 + days * 24);
  let up = 0;
  for (let i = i0; i <= i1; i++) if (arr[i] > 0) up++;
  return Math.round((100 * up) / (i1 - i0 + 1));
}

export function metricsAt(table, ms, days = 14) {
  const sun = valueAt(table, "sun", ms), earth = valueAt(table, "earth", ms);
  const horizonH = (table.t0 + (table.sun.length - 1) * STEP - ms) / HOUR; // hasta dónde llegan los datos
  return {
    sun, earth, sunUp: sun > 0, earthUp: earth > 0,
    sunNext: hoursToCrossing(table, "sun", ms),
    earthNext: hoursToCrossing(table, "earth", ms),
    horizonH,
    power: share(table, "sun", ms, days),
    comm: share(table, "earth", ms, days),
  };
}

export const statusOf = (m) => (m.sunUp && m.earthUp ? "ok" : m.sunUp || m.earthUp ? "warn" : "bad");

// Tramos [inicio, ancho] (0..1) en que el cuerpo está sobre el horizonte, entre dos instantes.
export function bands(table, key, fromMs, toMs) {
  const arr = table[key], out = [];
  const i0 = Math.max(0, Math.round((fromMs - table.t0) / STEP));
  const i1 = Math.min(arr.length - 1, Math.round((toMs - table.t0) / STEP));
  let from = null;
  for (let i = i0; i <= i1 + 1; i++) {
    const up = i <= i1 && arr[i] > 0;
    if (up && from == null) from = i;
    if (!up && from != null) { out.push([(from - i0) / (i1 - i0), (Math.min(i, i1) - from) / (i1 - i0)]); from = null; }
  }
  return out;
}

// Mejor atraso (en días): de día, maximiza energía + comunicación de los días siguientes.
export function bestDelay(table, plannedMs, maxDelay, days = 14) {
  let top = null;
  for (let d = 0; d <= maxDelay; d += 0.5) {
    const ms = plannedMs + d * DAY;
    if (valueAt(table, "sun", ms) <= 0) continue;
    const score = share(table, "sun", ms, days) + share(table, "earth", ms, days);
    if (!top || score > top.score) top = { delay: d, score };
  }
  return top;
}

// Borra las respuestas de Horizons guardadas en este navegador.
export function clearCache() {
  memo.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("lln1:")) localStorage.removeItem(k);
  } catch { /* sin localStorage */ }
}

// Azimut interpolado (cuida el salto 359° -> 0°).
export function azAt(table, key, ms) {
  const arr = table[key];
  const [i, f] = locate(table, arr, ms);
  const d = ((arr[i + 1] - arr[i] + 540) % 360) - 180;
  return (arr[i] + d * f + 360) % 360;
}

// Estadísticas de una ventana [fromMs, toMs]: extremos, tramos continuos más largos (en horas) y solapamiento.
export function windowStats(table, fromMs, toMs) {
  const i0 = Math.max(0, Math.round((fromMs - table.t0) / STEP)), i1 = Math.min(table.sun.length - 1, Math.round((toMs - table.t0) / STEP));
  const out = { sunMin: 90, sunMax: -90, earthMin: 90, earthMax: -90, sunRun: 0, darkRun: 0, linkRun: 0, gapRun: 0, both: 0 };
  let sunRun = 0, darkRun = 0, linkRun = 0, gapRun = 0, both = 0;
  for (let i = i0; i <= i1; i++) {
    const s = table.sun[i], e = table.earth[i];
    out.sunMin = Math.min(out.sunMin, s); out.sunMax = Math.max(out.sunMax, s);
    out.earthMin = Math.min(out.earthMin, e); out.earthMax = Math.max(out.earthMax, e);
    sunRun = s > 0 ? sunRun + 1 : 0; darkRun = s > 0 ? 0 : darkRun + 1;
    linkRun = e > 0 ? linkRun + 1 : 0; gapRun = e > 0 ? 0 : gapRun + 1;
    out.sunRun = Math.max(out.sunRun, sunRun); out.darkRun = Math.max(out.darkRun, darkRun);
    out.linkRun = Math.max(out.linkRun, linkRun); out.gapRun = Math.max(out.gapRun, gapRun);
    if (s > 0 && e > 0) both++;
  }
  out.both = Math.round((100 * both) / (i1 - i0 + 1));
  return out;
}

// Tabla horaria de un sitio como CSV (para abrir en Excel, Python, etc.).
export function toCsv(table) {
  const rows = ["time_utc,sun_elevation_deg,sun_azimuth_deg,earth_elevation_deg,earth_azimuth_deg"];
  for (let i = 0; i < table.sun.length; i++)
    rows.push([new Date(table.t0 + i * STEP).toISOString(), table.sun[i], table.sunAz[i], table.earth[i], table.earthAz[i]].join(","));
  return rows.join("\n");
}

// Salidas y puestas del Sol y la Tierra dentro de [fromMs, toMs], en orden.
export function events(table, fromMs, toMs) {
  const out = [];
  const i0 = Math.max(0, Math.floor((fromMs - table.t0) / STEP)), i1 = Math.min(table.sun.length - 2, Math.ceil((toMs - table.t0) / STEP));
  for (const body of ["sun", "earth"]) {
    const arr = table[body];
    for (let i = i0; i <= i1; i++) {
      const a = arr[i], b = arr[i + 1];
      if (a > 0 !== b > 0) out.push({ t: table.t0 + (i + a / (a - b)) * STEP, body, rise: b > 0 });
    }
  }
  return out.filter((e) => e.t >= fromMs && e.t <= toMs).sort((x, y) => x.t - y.t);
}

// Horas de un día (24 h desde dayMs) con el Sol y con la Tierra sobre el horizonte.
export function dayHours(table, dayMs) {
  const i0 = Math.max(0, Math.round((dayMs - table.t0) / STEP));
  let sun = 0, earth = 0;
  for (let i = i0; i < i0 + 24 && i < table.sun.length; i++) { if (table.sun[i] > 0) sun++; if (table.earth[i] > 0) earth++; }
  return { sun, earth };
}

// Temperatura aproximada del suelo iluminado (°C): equilibrio radiativo de una superficie lisa,
// albedo 0,11 y emisividad 0,95. Es una estimación, no una medición; de noche devuelve null.
export function surfaceTempC(sunElevDeg) {
  if (sunElevDeg <= 0) return null;
  return Math.pow((1361 * 0.89 * Math.sin((sunElevDeg * Math.PI) / 180)) / (0.95 * 5.670374e-8), 0.25) - 273.15;
}
