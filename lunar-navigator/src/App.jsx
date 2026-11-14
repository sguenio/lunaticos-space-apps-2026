import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./icons.jsx";
import Globe, { SiteThumb, loadAssets } from "./Globe.jsx";
import { STRINGS } from "./i18n.js";
import Rover from "./Rover.jsx";
import {
  DAY, loadSite, loadMoon, metricsAt, statusOf, bands, bestDelay, dirAt, valueAt, horizonsUrl, siteQuery, clearCache, azAt, windowStats, toCsv, events, dayHours, surfaceTempC, requestLog, onLog,
} from "./horizons.js";

/* ---------- Configuración ---------- */

// Coordenadas (lat, lon este) de NASA NSSDC y LROC salvo donde se indica.
const SITES = [
  { id: "a11", name: "Apollo 11", lat: 0.67408, lon: 23.47297 },
  { id: "a12", name: "Apollo 12", lat: -3.0128, lon: -23.4219, group: "apollo", year: 1969 },
  { id: "a14", name: "Apollo 14", lat: -3.64589, lon: -17.47194, group: "apollo", year: 1971 },
  { id: "a15", name: "Apollo 15", lat: 26.13239, lon: 3.6333, group: "apollo", year: 1971 },
  { id: "a16", name: "Apollo 16", lat: -8.9734, lon: 15.5011, group: "apollo", year: 1972 },
  { id: "a17", name: "Apollo 17", lat: 20.1911, lon: 30.7723, group: "apollo", year: 1972 },
  { id: "ce3", name: "Chang'e 3", lat: 44.1214, lon: -19.5117, group: "change", year: 2013 },
  { id: "ce4", name: "Chang'e 4", lat: -45.4561, lon: 177.5885, group: "change", year: 2019 },
  { id: "ce5", name: "Chang'e 5", lat: 43.0576, lon: -51.9161, group: "change", year: 2020 },
  { id: "bg1", name: "Blue Ghost M1", lat: 18.562, lon: 61.81, group: "clps", year: 2025 }, // fuente: prensa especializada
  { id: "ch3", name: "Chandrayaan-3", lat: -69.373, lon: 32.319 }, // sin reverificar
  { id: "mal", name: "Malapert Massif", lat: -86.0, lon: 0.0, approx: true }, // verificar coordenadas
  { id: "sha", name: "Shackleton Rim", lat: -89.78, lon: -155.73, approx: true }, // verificar coordenadas
];

const LEAD_DAYS = 2; // días visibles antes de la fecha planificada
const WINDOW_DAYS = 40; // largo de la línea de tiempo
const MAX_DELAY = WINDOW_DAYS - LEAD_DAYS;
const SCORE_OPTIONS = [7, 14, 28];
const FETCH_DAYS = WINDOW_DAYS + 28 + 2; // datos extra para mirar hacia adelante desde el mayor atraso
const SCENARIOS = [0, 3, 7, 10, 14, 21, 28, 35];
const LOCALE = { en: "en-US", es: "es-AR" };

/* ---------- Preferencias (tema, idioma, ventana de puntaje) ---------- */

function loadPrefs() {
  const base = { theme: "dark", lang: (navigator.language || "en").startsWith("es") ? "es" : "en", scoreDays: 14 };
  try { return { ...base, ...JSON.parse(localStorage.getItem("lln:prefs") || "{}") }; } catch { return base; }
}

/* ---------- Formato ---------- */

function makeFmt(lang, t) {
  const loc = LOCALE[lang];
  const num = (x, d = 1) => x.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  return {
    coord: (s) => `${s.approx ? "~" : ""}${num(Math.abs(s.lat), 3)}° ${s.lat >= 0 ? "N" : "S"}, ${num(Math.abs(s.lon), 3)}° ${s.lon >= 0 ? "E" : lang === "es" ? "O" : "W"}`,
    deg: (x) => `${num(x)}°`,
    dur: (h, horizonH) => (h == null ? `> ${Math.floor(horizonH / 24)} d` : h < 48 ? `${Math.round(h)} h` : `${num(h / 24)} d`),
    day: (ms) => new Date(ms).toLocaleDateString(loc, { timeZone: "UTC", month: "short", day: "2-digit" }),
    full: (ms) => new Date(ms).toLocaleString(loc, { timeZone: "UTC", month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC",
    delay: (d) => (Number.isInteger(d) ? String(d) : num(d)),
    yesNo: (b) => (b ? t.yes : t.no),
  };
}

/* ---------- Datos de Horizons ---------- */

function useHorizons(sites, firstId, startMs, stopMs, attempt) {
  const [store, setStore] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setError(null);
    const put = (k) => (v) => alive && setStore((s) => ({ ...s, [k]: v }));
    const fail = (e) => alive && setError(e.message);
    const ordered = [...sites].sort((a, b) => (b.id === firstId) - (a.id === firstId)); // primero el sitio elegido
    loadSite(ordered[0], startMs, stopMs).then(put(`${ordered[0].id}@${startMs}`), fail);
    loadMoon(startMs, stopMs).then(put(`moon@${startMs}`), fail);
    for (const s of ordered.slice(1)) loadSite(s, startMs, stopMs).then(put(`${s.id}@${startMs}`), fail);
    return () => { alive = false; };
  }, [sites, startMs, stopMs, attempt]);
  return { moon: store[`moon@${startMs}`], tableOf: (id) => store[`${id}@${startMs}`], error };
}

/* ---------- Piezas chicas ---------- */

function Segmented({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} className={v === value ? "on" : ""} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function Bands({ table, fromMs, toMs }) {
  const bd = useMemo(() => (table ? { sun: bands(table, "sun", fromMs, toMs), earth: bands(table, "earth", fromMs, toMs) } : null), [table, fromMs, toMs]);
  return (
    <div className="bands">
      {bd?.earth.map(([l, w], i) => <i key={`e${i}`} className="earth" style={{ left: `${l * 100}%`, width: `${w * 100}%` }} />)}
      {bd?.sun.map(([l, w], i) => <i key={`s${i}`} className="sun" style={{ left: `${l * 100}%`, width: `${w * 100}%` }} />)}
    </div>
  );
}

function Metric({ icon, tone, label, children, plan, t }) {
  return (
    <div className="metric">
      <span className="m-k"><span className={`m-ic ${tone}`}><Icon name={icon} size={15} /></span>{label}</span>
      <strong>{children}</strong>
      {plan && <span className="m-plan">{t.plan}: {plan}</span>}
    </div>
  );
}

function Bar({ icon, tone, label, value, plan, t }) {
  return (
    <div className="bar">
      <span className={`m-ic ${tone}`}><Icon name={icon} size={16} /></span>
      <span className="b-k">{label}</span>
      <div className="track"><i className={tone} style={{ width: `${value}%` }} /></div>
      <b>{value}%{plan != null && plan !== value && <em> ({t.plan.toLowerCase()} {plan}%)</em>}</b>
    </div>
  );
}

/* ---------- Tarjeta de un sitio ---------- */

function SiteCard({ site, table, ms, plannedMs, scoreDays, t, f }) {
  if (!table) {
    return (
      <section className="glass card">
        <h2><i className="dot none" />{site.name}</h2>
        <p className="coords">{f.coord(site)}</p>
        <p className="loading">{t.loadingSite}</p>
      </section>
    );
  }
  const m = metricsAt(table, ms, scoreDays);
  const p = ms !== plannedMs ? metricsAt(table, plannedMs, scoreDays) : null;
  const st = statusOf(m);
  const rawUrl = horizonsUrl({ format: "text", ...siteQuery(site, "sun", ms, ms + DAY) }, "https://ssd.jpl.nasa.gov/api/horizons.api");
  return (
    <section className="glass card">
      <a className="ext" href={rawUrl} target="_blank" rel="noreferrer" title={t.rawData} aria-label={t.rawData}><Icon name="external" size={16} /></a>
      <h2><i className={`dot ${st}`} />{site.name}</h2>
      <p className="coords">{f.coord(site)}<span className={`pill ${st}`}>{t[`st_${st}`]}</span></p>
      <div className="metrics">
        <Metric t={t} icon="sun" tone="sun" label={t.sunElev} plan={p && f.deg(p.sun)}>{f.deg(m.sun)}</Metric>
        <Metric t={t} icon="sunset" tone="sun" label={m.sunUp ? t.sunsetIn : t.sunriseIn} plan={p && p.sunUp === m.sunUp && f.dur(p.sunNext, p.horizonH)}>
          {f.dur(m.sunNext, m.horizonH)}
        </Metric>
        <Metric t={t} icon="eye" tone="earth" label={t.earthVisible} plan={p && `${f.yesNo(p.earthUp)} · ${f.deg(p.earth)}`}>
          <span className={m.earthUp ? "yes" : "no"}>{f.yesNo(m.earthUp)}</span><small> · {f.deg(m.earth)}</small>
        </Metric>
        <Metric t={t} icon="globe" tone="earth" label={m.earthUp ? t.earthsetIn : t.earthriseIn} plan={p && p.earthUp === m.earthUp && f.dur(p.earthNext, p.horizonH)}>
          {f.dur(m.earthNext, m.horizonH)}
        </Metric>
      </div>
      <Bar t={t} icon="bolt" tone="sun" label={t.power} value={m.power} plan={p?.power} />
      <Bar t={t} icon="antenna" tone="earth" label={t.comm} value={m.comm} plan={p?.comm} />
      <p className="hint">{t.scoreHint(scoreDays)}</p>
    </section>
  );
}

/* ---------- Línea de tiempo ---------- */

function Timeline({ table, plannedMs, planned, setPlanned, delay, setDelay, playing, setPlaying, scoreDays, t, f }) {
  const fromMs = plannedMs - LEAD_DAYS * DAY, toMs = fromMs + WINDOW_DAYS * DAY;
  const best = useMemo(() => (table ? bestDelay(table, plannedMs, MAX_DELAY, scoreDays) : null), [table, plannedMs, scoreDays]);
  const pos = (days) => `${((days + LEAD_DAYS) / WINDOW_DAYS) * 100}%`;
  const ticks = [];
  for (let d = 0; d <= MAX_DELAY; d += 7) ticks.push(d);
  const seek = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const d = ((ev.clientX - r.left) / r.width) * WINDOW_DAYS - LEAD_DAYS;
    setDelay(Math.max(0, Math.min(MAX_DELAY, Math.round(d * 4) / 4)));
  };
  return (
    <section className="glass timeline">
      <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? t.pause : t.play}>
        <Icon name={playing ? "pause" : "play"} size={20} />
      </button>
      <div className="tl-main">
        <div className="tl-legend">
          <span><i className="dot sun" />{t.sunlight}</span>
          <span><i className="dot earth" />{t.earthVis}</span>
          <label>{t.planned}
            <input type="datetime-local" value={planned} onChange={(e) => { setPlanned(e.target.value); setDelay(0); }} />
          </label>
        </div>
        <div className="tl-track" onPointerDown={(e) => { setPlaying(false); seek(e); }} onPointerMove={(e) => e.buttons === 1 && seek(e)}>
          <Bands table={table} fromMs={fromMs} toMs={toMs} />
          <b className="mark plan" style={{ left: pos(0) }} />
          <b className={`mark now ${delay < 4 ? "l" : delay > MAX_DELAY - 6 ? "r" : ""}`} style={{ left: pos(delay) }}><span>{f.full(plannedMs + delay * DAY)}</span></b>
        </div>
        <div className="tl-ticks">
          {ticks.map((d) => <span key={d} style={{ left: pos(d) }}>{f.day(plannedMs + d * DAY)}</span>)}
        </div>
      </div>
      <div className="delay">
        <label htmlFor="delay">{t.delay(f.delay(delay))}</label>
        <div>
          <input id="delay" type="range" min="0" max={MAX_DELAY} step="0.25" value={delay}
            style={{ "--fill": `${(delay / MAX_DELAY) * 100}%` }}
            onChange={(e) => { setPlaying(false); setDelay(+e.target.value); }} />
          <output>+{f.delay(delay)} d</output>
        </div>
        {best && (
          <button className="link" onClick={() => { setPlaying(false); setDelay(best.delay); }}>
            {t.best(f.delay(best.delay), f.day(plannedMs + best.delay * DAY))}
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------- Vista Análisis: todos los sitios lado a lado ---------- */

function Analysis({ sites, tableOf, selId, setSelId, ms, plannedMs, scoreDays, t, f }) {
  const fromMs = plannedMs - LEAD_DAYS * DAY, toMs = fromMs + WINDOW_DAYS * DAY;
  const selTable = tableOf(selId);
  return (
    <section className="glass view">
      <h2>{t.analysisTitle}<small>{f.full(ms)}</small></h2>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>{t.site}</th><th>{t.sunElev}</th><th>{t.nextSun}</th><th>{t.earthElev}</th><th>{t.nextEarth}</th><th>{t.power}</th><th>{t.comm}</th><th className="wide">{t.window}</th></tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const table = tableOf(s.id);
              const m = table && metricsAt(table, ms, scoreDays);
              return (
                <tr key={s.id} className={s.id === selId ? "on" : ""} onClick={() => setSelId(s.id)}>
                  <td><button className="row-btn"><i className={`dot ${m ? statusOf(m) : "none"}`} /><span><strong>{s.name}</strong><small>{f.coord(s)}</small></span></button></td>
                  {m ? (
                    <>
                      <td className="num">{f.deg(m.sun)}</td>
                      <td>{m.sunUp ? t.sets : t.rises} {f.dur(m.sunNext, m.horizonH)}</td>
                      <td className="num">{f.deg(m.earth)}</td>
                      <td>{m.earthUp ? t.sets : t.rises} {f.dur(m.earthNext, m.horizonH)}</td>
                      <td className="num">{m.power}%</td>
                      <td className="num">{m.comm}%</td>
                    </>
                  ) : <td colSpan="6" className="muted">{t.loadingSite}</td>}
                  <td className="wide"><Bands table={table} fromMs={fromMs} toMs={toMs} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint">{t.scoreHint(scoreDays)}</p>
        {selTable && <SiteDeep site={sites.find((s) => s.id === selId)} table={selTable} ms={ms} fromMs={fromMs} toMs={toMs} t={t} f={f} />}
      </div>
    </section>
  );
}

/* ---------- Vista Planificación: escenarios de atraso ---------- */

function Planning({ sites, site, setSelId, table, plannedMs, delay, setDelay, scoreDays, t, f }) {
  const best = useMemo(() => (table ? bestDelay(table, plannedMs, MAX_DELAY, scoreDays) : null), [table, plannedMs, scoreDays]);
  const rows = useMemo(() => {
    const set = new Set(SCENARIOS);
    if (best) set.add(best.delay);
    return [...set].sort((a, b) => a - b);
  }, [best]);
  return (
    <section className="glass view">
      <h2>{t.planningTitle}
        <select value={site.id} onChange={(e) => setSelId(e.target.value)} aria-label={t.site}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </h2>
      <p className="sub">{t.planningSub(site.name)}</p>
      <div className="scroll">
        {!table ? <p className="loading">{t.loadingSite}</p> : (
          <table>
            <thead>
              <tr><th>{t.scenario}</th><th>{t.date}</th><th>{t.sunElev}</th><th>{t.nextSun}</th><th>{t.earthVisible}</th><th>{t.power}</th><th>{t.comm}</th><th>{t.score}</th></tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const m = metricsAt(table, plannedMs + d * DAY, scoreDays);
                return (
                  <tr key={d} className={d === delay ? "on" : ""} onClick={() => setDelay(d)}>
                    <td><button className="row-btn"><i className={`dot ${statusOf(m)}`} /><strong>{d === 0 ? t.onTime : `+${f.delay(d)} d`}</strong>
                      {best?.delay === d && <span className="tag-best">{t.bestTag}</span>}</button></td>
                    <td>{f.full(plannedMs + d * DAY)}</td>
                    <td className="num">{f.deg(m.sun)}{!m.sunUp && <small> · {t.night}</small>}</td>
                    <td>{m.sunUp ? t.sets : t.rises} {f.dur(m.sunNext, m.horizonH)}</td>
                    <td>{f.yesNo(m.earthUp)} · {f.deg(m.earth)}</td>
                    <td className="num">{m.power}%</td>
                    <td className="num">{m.comm}%</td>
                    <td className="num"><b>{Math.round((m.power + m.comm) / 2)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="hint">{t.scoreHint(scoreDays)}</p>
    </section>
  );
}

/* ---------- Vista Ajustes ---------- */

function Settings({ prefs, setPrefs, texReal, t }) {
  return (
    <section className="view settings">
      <div className="glass set"><h3>{t.language}</h3>
        <Segmented label={t.language} value={prefs.lang} onChange={(lang) => setPrefs({ ...prefs, lang })} options={[["es", "Español"], ["en", "English"]]} />
      </div>
      <div className="glass set"><h3>{t.scoreWindow}</h3>
        <Segmented label={t.scoreWindow} value={prefs.scoreDays} onChange={(scoreDays) => setPrefs({ ...prefs, scoreDays })} options={SCORE_OPTIONS.map((n) => [n, t.days(n)])} />
        <p className="hint">{t.scoreHint(prefs.scoreDays)}</p>
      </div>
      <div className="glass set"><h3>{t.cache}</h3>
        <p className="hint">{t.cacheHint}</p>
        <button className="btn" onClick={() => { clearCache(); location.reload(); }}>{t.clearCache}</button>
      </div>
      <div className="glass set wide"><h3>{t.sources}</h3>
        <ul><li>{t.src1}</li><li>{t.src2}</li><li>{t.src3}</li>{!texReal && <li className="warn-t">{t.texMissing}</li>}</ul>
      </div>
    </section>
  );
}

/* ---------- Pantalla de inicio ---------- */

function Splash({ leaving, t }) {
  return (
    <div className={`splash ${leaving ? "out" : ""}`} aria-hidden="true">
      <div className="sp-moon"><i /></div>
      <h1>{t.brand1} <span>{t.brand2}</span></h1>
      <p>{t.splash}</p>
    </div>
  );
}

/* ---------- Cielo: el Sol y la Tierra respecto al horizonte del sitio ---------- */

function Sky({ site, table, plannedMs, ms, scoreDays, t, f }) {
  const W = 1000, H = 400, L = 54, R = 16, T = 16, B = 34;
  const fromMs = plannedMs - LEAD_DAYS * DAY, toMs = fromMs + WINDOW_DAYS * DAY;
  const track = useMemo(() => {
    if (!table) return null;
    const pts = [];
    for (let x = fromMs; x <= toMs; x += 2 * 36e5) pts.push([azAt(table, "sunAz", x), valueAt(table, "sun", x), azAt(table, "earthAz", x), valueAt(table, "earth", x)]);
    return pts;
  }, [table, fromMs, toMs]);
  if (!track) return <section className="glass view"><p className="loading">{t.loadingSite}</p></section>;
  const m = metricsAt(table, ms, scoreDays);
  const sun = [azAt(table, "sunAz", ms), m.sun], earth = [azAt(table, "earthAz", ms), m.earth];
  const top = Math.min(90, Math.max(12, ...track.map((p) => Math.max(p[1], p[3]))) + 3), bot = Math.max(-90, Math.min(-8, ...track.map((p) => Math.min(p[1], p[3]))) - 2);
  const X = (az) => L + (az / 360) * (W - L - R), Y = (el) => T + ((top - el) / (top - bot)) * (H - T - B);
  const path = (ia, ie) => track.map((p, i) => `${i && Math.abs(p[ia] - track[i - 1][ia]) < 180 ? "L" : "M"}${X(p[ia]).toFixed(1)} ${Y(p[ie]).toFixed(1)}`).join("");
  const ticks = [bot, 0, top].concat(top > 30 ? [30, 60].filter((v) => v < top - 5) : []).map((v) => Math.round(v));
  const label = (p, name, cls) => (
    <g transform={`translate(${X(p[0])} ${Y(p[1])})`} className={p[1] > 0 ? "" : "dim"}>
      <title>{`${name}: ${f.deg(p[1])}, az ${Math.round(p[0])}°`}</title>
      {cls === "sun" && <circle r="20" className="halo" />}
      <circle r={cls === "sun" ? 9 : 11} className={`body ${cls}`} />
      <text y={p[1] > 0 ? -18 : 28} className="ax mid lab">{name} {f.deg(p[1])}</text>
    </g>
  );
  const cards = [
    [t.sun, "sun", sun, m.sunUp, m.sunUp ? t.sunsetIn : t.sunriseIn, m.sunNext],
    [t.earth, "earth", earth, m.earthUp, m.earthUp ? t.earthsetIn : t.earthriseIn, m.earthNext],
  ];
  return (
    <section className="glass view">
      <h2>{t.skyTitle(site.name)}<small>{f.full(ms)}</small></h2>
      <p className="sub">{t.skySub}</p>
      <div className="sky-wrap">
        <figure className="chart sky">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.skyTitle(site.name)}>
            <rect x={L} y={T} width={W - L - R} height={Y(0) - T} className="sky-bg" />
            <rect x={L} y={Y(0)} width={W - L - R} height={H - B - Y(0)} className="ground" />
            {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v === 0 ? "zero" : "grid"} /><text x={L - 8} y={Y(v) + 4} className="ax end">{v}°</text></g>)}
            {[[0, t.north], [90, t.east], [180, t.south], [270, t.west], [360, t.north]].map(([az, n]) => (
              <g key={az}><line x1={X(az)} x2={X(az)} y1={T} y2={H - B} className="grid" /><text x={X(az)} y={H - 10} className="ax mid lab">{n} {az % 360}°</text></g>
            ))}
            <text x={L + 8} y={Y(0) - 6} className="ax">{t.horizon}</text>
            <path d={path(0, 1)} className="ln sun thin" /><path d={path(2, 3)} className="ln earth thin" />
            {label(earth, t.earth, "earth")}{label(sun, t.sun, "sun")}
          </svg>
        </figure>
        <div className="sky-side">
          {cards.map(([name, cls, p, up, nextLabel, next]) => (
            <div key={cls} className="sky-card">
              <h3><i className={`dot ${cls}`} />{name}<span className={`pill ${up ? "ok" : "bad"}`}>{up ? t.above : t.below}</span></h3>
              <dl><div><dt>{t.elevation}</dt><dd>{f.deg(p[1])}</dd></div><div><dt>{t.azimuth}</dt><dd>{Math.round(p[0])}°</dd></div><div><dt>{nextLabel}</dt><dd>{f.dur(next, m.horizonH)}</dd></div></dl>
            </div>
          ))}
          <p className="hint">{t.skyNote}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------- Datos: qué se le pide a NASA y qué devuelve, en vivo ---------- */

function useLog() {
  const [, bump] = useState(0);
  useEffect(() => onLog(() => bump((n) => n + 1)), []);
  return requestLog;
}

function DataView({ site, table, ms, assets, t, f }) {
  const log = useLog();
  const net = log.filter((e) => e.source === "network").length, cache = log.filter((e) => e.source === "cache").length;
  const hour = Math.round(ms / 36e5) * 36e5, rows = [];
  for (let k = -5; k <= 6; k++) rows.push(hour + k * 36e5);
  const clock = (x) => new Date(x).toLocaleTimeString([], { hour12: false });
  return (
    <section className="glass view">
      <h2>{t.dataTitle}</h2>
      <p className="sub">{t.dataSub}</p>
      <div className="scroll">
        <div className="src">
          <div><h3><i className="dot ok" />{t.srcHorizons}</h3><p>{t.srcHorizonsD}</p>
            <p className="num"><b>{net}</b> {t.reqNet} · <b>{cache}</b> {t.reqCache}</p>
            <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank" rel="noreferrer">{t.open} Horizons</a></div>
          <div><h3><i className={`dot ${assets?.color ? "ok" : "bad"}`} />{t.srcMap}</h3><p>{t.srcMapD}</p>
            <p className="num">{assets?.color ? `${t.loaded}: ${assets.color.naturalWidth} × ${assets.color.naturalHeight} px` : t.notLoaded}{assets?.bump ? ` · LOLA ${assets.bump.naturalWidth} × ${assets.bump.naturalHeight} px` : ""}</p>
            <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noreferrer">{t.open} NASA SVS</a></div>
          <div><h3><i className="dot none" />{t.srcRef}</h3><p>{t.srcRefD}</p>
            <p><a href="https://quickmap.lroc.asu.edu/" target="_blank" rel="noreferrer">{t.open} QuickMap</a> · <a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">{t.open} Moon Trek</a></p></div>
        </div>
        <div className="data-cols">
          <div>
            <h3 className="ev-h">{t.liveTitle(site.name)}</h3>
            {!table ? <p className="loading">{t.loadingSite}</p> : (
              <table><thead><tr><th>{t.timeUtc}</th><th>{t.sunElev}</th><th>{t.sunAz}</th><th>{t.earthElev}</th><th>{t.earthAz}</th></tr></thead>
                <tbody>{rows.map((x) => (
                  <tr key={x} className={x === hour ? "on" : ""}><td>{f.full(x)}</td><td className="num">{valueAt(table, "sun", x).toFixed(4)}°</td><td className="num">{azAt(table, "sunAz", x).toFixed(3)}°</td>
                    <td className="num">{valueAt(table, "earth", x).toFixed(4)}°</td><td className="num">{azAt(table, "earthAz", x).toFixed(3)}°</td></tr>
                ))}</tbody></table>
            )}
          </div>
          <div>
            <h3 className="ev-h">{t.logTitle}</h3>
            <table><thead><tr><th>{t.colWhen}</th><th>{t.colWhat}</th><th>{t.site}</th><th>{t.colSource}</th><th>{t.colStatus}</th><th>{t.colRows}</th><th>{t.colTime}</th><th>{t.colQuery}</th></tr></thead>
              <tbody>{log.slice(0, 60).map((e) => (
                <tr key={e.id + e.at}><td className="num">{clock(e.at)}</td><td>{t[`w_${e.what}`]}</td><td>{e.site}</td>
                  <td>{e.source === "network" ? t.reqNet : t.reqCache}</td>
                  <td><i className={`dot ${e.status === "ok" ? "ok" : e.status === "error" ? "bad" : "warn"}`} /> {e.status === "ok" ? t.stOk : e.status === "error" ? t.stError : t.stPending}</td>
                  <td className="num">{e.rows ?? ""}</td><td className="num">{e.ms == null ? "" : `${e.ms} ms`}</td>
                  <td>{e.url && <a href={e.url} target="_blank" rel="noreferrer">{t.viewQuery}</a>}</td></tr>
              ))}</tbody></table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Calendario de luz y señal ---------- */

function Calendar({ site, table, plannedMs, delay, setDelay, ms, t, f }) {
  const fromMs = plannedMs - LEAD_DAYS * DAY, toMs = fromMs + WINDOW_DAYS * DAY;
  const data = useMemo(() => {
    if (!table) return null;
    const day0 = Math.floor(plannedMs / DAY) * DAY, days = [];
    for (let d = 0; d <= MAX_DELAY; d++) days.push({ d, ms: day0 + d * DAY, ...dayHours(table, day0 + d * DAY) });
    return { days, ev: events(table, plannedMs, toMs), st: windowStats(table, plannedMs, toMs) };
  }, [table, plannedMs, toMs]);
  if (!data) return <section className="glass view"><p className="loading">{t.loadingSite}</p></section>;
  const sunH = data.days.reduce((a, d) => a + d.sun, 0), linkH = data.days.reduce((a, d) => a + d.earth, 0);
  const temp = surfaceTempC(valueAt(table, "sun", ms));
  const tiles = [
    [t.totLight, f.dur(sunH, 0)], [t.totDark, f.dur(data.st.darkRun, 0)], [t.totLink, f.dur(linkH, 0)], [t.totGap, f.dur(data.st.gapRun, 0)],
    [t.tempNow, temp == null ? t.tempNight : `≈ ${Math.round(temp)} °C`],
  ];
  const offset = (plannedMs - Math.floor(plannedMs / DAY) * DAY) / DAY;
  return (
    <section className="glass view">
      <h2>{t.calTitle(site.name)}</h2>
      <p className="sub">{t.dayNote} {t.calSub}</p>
      <div className="scroll">
        <dl className="stats">{tiles.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <div className="cal">
          {data.days.map((d) => (
            <button key={d.d} className={Math.floor(delay + offset) === d.d ? "on" : ""} onClick={() => setDelay(Math.max(0, Math.min(MAX_DELAY, d.d - offset + 0.5)))}>
              <strong>{f.day(d.ms)}</strong>
              <span className="cal-row"><Icon name="sun" size={13} /><i className="track"><i className="sun" style={{ width: `${(d.sun / 24) * 100}%` }} /></i><b>{d.sun} h</b></span>
              <span className="cal-row"><Icon name="antenna" size={13} /><i className="track"><i className="earth" style={{ width: `${(d.earth / 24) * 100}%` }} /></i><b>{d.earth} h</b></span>
            </button>
          ))}
        </div>
        <p className="hint"><Icon name="sun" size={12} /> {t.hLight} · <Icon name="antenna" size={12} /> {t.hLink}</p>
        <h3 className="ev-h">{t.evTitle}</h3>
        {data.ev.length === 0 ? <p className="muted">{t.evNone}</p> : (
          <ul className="ev">{data.ev.map((e) => (
            <li key={e.t + e.body}><i className={`dot ${e.body}`} /><b>{f.full(e.t)}</b><span>{t[`ev_${e.body}_${e.rise ? "rise" : "set"}`]}</span></li>
          ))}</ul>
        )}
        <p className="hint">{t.tempNote}</p>
      </div>
    </section>
  );
}

/* ---------- Elegir modo (después de la pantalla de inicio) ---------- */

function ModePicker({ onPick, t }) {
  return (
    <div className="picker">
      <h2>{t.pickTitle}</h2>
      <div className="pick-grid">
        <button className="glass pick" onClick={() => onPick("simple")}>
          <span className="pick-ic"><Icon name="rover" size={30} /></span><strong>{t.simple}</strong><span>{t.pickSimple}</span>
        </button>
        <button className="glass pick" onClick={() => onPick("advanced")}>
          <span className="pick-ic"><Icon name="chart" size={30} /></span><strong>{t.advanced}</strong><span>{t.pickAdvanced}</span>
        </button>
      </div>
      <p className="hint">{t.pickHint}</p>
    </div>
  );
}

/* ---------- Modo simple: respuestas en lenguaje claro ---------- */

function SimpleView({ sites, site, setSelId, statuses, table, ms, globe, onDrive, scoreDays, t, f }) {
  const m = table && metricsAt(table, ms, scoreDays);
  const st = m && statusOf(m);
  return (
    <main className="overview">
      <aside className="glass sites simple">
        <div className="p-head"><span className="pin-ic"><Icon name="pin" size={18} /></span><h3>{t.pickPlace}</h3></div>
        <ul>
          {sites.map((s) => (
            <li key={s.id}>
              <button className={s.id === site.id ? "on" : ""} onClick={() => setSelId(s.id)}>
                <SiteThumb site={s} />
                <i className={`dot ${statuses[s.id] ?? "none"}`} />
                <span><strong>{s.name}</strong><small>{t[`blurb_${s.id}`] ?? (s.group ? t[`grp_${s.group}`](s.year) : f.coord(s))}</small></span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="stage">{globe}</div>
      <div className="right">
        <section className="glass card easy">
          <h2><i className={`dot ${st ?? "none"}`} />{site.name}</h2>
          {!m ? <p className="loading">{t.loadingSite}</p> : (
            <>
              <p className={`verdict ${st}`}>{t[`v_${st}`]}</p>
              <div className="qa">
                <span className="m-ic sun"><Icon name="sun" size={22} /></span>
                <div><h3>{t.qSun} <b className={m.sunUp ? "yes" : "no"}>{f.yesNo(m.sunUp)}</b></h3>
                  <p>{!m.sunUp ? t.sNight(f.dur(m.sunNext, m.horizonH)) : m.sun < 5 ? t.sLow(f.deg(m.sun), f.dur(m.sunNext, m.horizonH)) : t.sHigh(f.deg(m.sun), f.dur(m.sunNext, m.horizonH))}</p></div>
              </div>
              <div className="qa">
                <span className="m-ic earth"><Icon name="antenna" size={22} /></span>
                <div><h3>{t.qEarth} <b className={m.earthUp ? "yes" : "no"}>{f.yesNo(m.earthUp)}</b></h3>
                  <p>{m.earthUp ? t.eUp(f.deg(m.earth), f.dur(m.earthNext, m.horizonH)) : t.eDown(f.dur(m.earthNext, m.horizonH))}</p></div>
              </div>
              <p className="hint">{t.next2w(scoreDays)}: <b>{m.power}%</b> {t.lightShare} · <b>{m.comm}%</b> {t.linkShare}.</p>
              <p className="hint">{t.why}</p>
              <button className="btn primary" onClick={onDrive}><Icon name="rover" size={18} />{t.drive}</button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

/* ---------- Pantalla dividida: dos escenarios al mismo tiempo ---------- */

function Split({ sites, tableOf, moon, plannedMs, scen, setScen, scoreDays, t, f }) {
  const panes = scen.map((sc) => {
    const site = sites.find((s) => s.id === sc.siteId) ?? sites[0], table = tableOf(site.id), ms = plannedMs + sc.delay * DAY;
    return { ...sc, site, table, ms, m: table && metricsAt(table, ms, scoreDays) };
  });
  const set = (i, patch) => setScen(scen.map((sc, k) => (k === i ? { ...sc, ...patch } : sc)));
  const fromMs = plannedMs - LEAD_DAYS * DAY, toMs = fromMs + WINDOW_DAYS * DAY;
  const [a, b] = panes;
  const score = (m) => Math.round((m.power + m.comm) / 2);
  const rows = a.m && b.m ? [
    [t.sunElev, a.m.sun, b.m.sun, f.deg], [t.earthElev, a.m.earth, b.m.earth, f.deg],
    [t.power, a.m.power, b.m.power, (x) => `${x}%`], [t.comm, a.m.comm, b.m.comm, (x) => `${x}%`], [t.score, score(a.m), score(b.m), String],
  ] : [];
  const diff = rows.length ? score(b.m) - score(a.m) : 0;
  const signed = (x) => `${x > 0 ? "+" : ""}${x}`;
  // Alternativas de un clic para el escenario B, siempre respecto del plan A
  const presets = [
    [t.preLater, () => set(1, { siteId: a.site.id, delay: Math.min(MAX_DELAY, a.delay + 7) })],
    [t.preBest, () => { const best = a.table && bestDelay(a.table, plannedMs, MAX_DELAY, scoreDays); if (best) set(1, { siteId: a.site.id, delay: best.delay }); }],
    [t.preSite, () => {
      let top = null;
      for (const s of sites) { const tb = tableOf(s.id); if (!tb || s.id === a.site.id) continue; const sc = score(metricsAt(tb, a.ms, scoreDays)); if (!top || sc > top.sc) top = { id: s.id, sc }; }
      if (top) set(1, { siteId: top.id, delay: a.delay });
    }],
  ];
  return (
    <main className="split">
      <section className="glass split-head">
        <div><strong>{t.splitTitle}</strong><span>{t.splitSub}</span></div>
        <span className="pre">{t.preTry}{presets.map(([label, run]) => <button key={label} className="btn sm" onClick={run}>{label}</button>)}</span>
      </section>
      {panes.map((p, i) => {
        const statuses = {};
        for (const s of sites) { const tb = tableOf(s.id); if (tb) statuses[s.id] = statusOf({ sunUp: valueAt(tb, "sun", p.ms) > 0, earthUp: valueAt(tb, "earth", p.ms) > 0 }); }
        return (
          <section key={i} className="glass pane">
            <header>
              <b className="badge">{"AB"[i]}</b><strong className="pane-name">{i ? t.planB : t.planA}</strong>
              <select value={p.site.id} onChange={(e) => set(i, { siteId: e.target.value })} aria-label={`${t.scenario} ${"AB"[i]}: ${t.site}`}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="range" min="0" max={MAX_DELAY} step="0.25" value={p.delay} style={{ "--fill": `${(p.delay / MAX_DELAY) * 100}%` }}
                onChange={(e) => set(i, { delay: +e.target.value })} aria-label={t.delay(f.delay(p.delay))} />
              <output>+{f.delay(p.delay)} d · {f.full(p.ms)}</output>
            </header>
            <div className="pane-body">
              <div className="stage">
                <Globe sites={sites} selected={p.site} statuses={statuses} onSelect={(id) => set(i, { siteId: id })}
                  sunDir={moon ? dirAt(moon, "sun", p.ms) : null} earthDir={moon ? dirAt(moon, "earth", p.ms) : null}
                  sunUp={!!p.m?.sunUp} earthUp={!!p.m?.earthUp} labels={{ sun: t.sun, earth: t.earth, dragHint: t.dragHint }} />
              </div>
              <SiteCard site={p.site} table={p.table} ms={p.ms} plannedMs={p.ms} scoreDays={scoreDays} t={t} f={f} />
            </div>
            <div className="pane-tl">
              <Bands table={p.table} fromMs={fromMs} toMs={toMs} />
              <b className="mark now" style={{ left: `${((p.delay + LEAD_DAYS) / WINDOW_DAYS) * 100}%` }} />
            </div>
          </section>
        );
      })}
      <section className="glass diff">
        <strong>{t.difference}</strong>
        {rows.map(([label, va, vb, fmt]) => (
          <span key={label} className="chip"><small>{label}</small>
            <b className={va > vb ? "win" : ""}>{fmt(va)}</b> → <b className={vb > va ? "win" : ""}>{fmt(vb)}</b>
          </span>
        ))}
        {rows.length > 0 && (
          <span className={`verdict-t ${diff > 0 ? "good" : diff < 0 ? "poor" : ""}`}>
            {diff === 0 ? t.splitTie : diff > 0 ? t.splitBetter(diff) : t.splitWorse(-diff)}
            <small> {t.power} {signed(b.m.power - a.m.power)} · {t.comm} {signed(b.m.comm - a.m.comm)}</small>
          </span>
        )}
      </section>
    </main>
  );
}

/* ---------- Detalle para investigadores: gráfico, estadísticas y CSV ---------- */

function ElevChart({ table, fromMs, toMs, ms, t, f }) {
  const [hover, setHover] = useState(null);
  const W = 1000, H = 230, L = 46, R = 70, T = 14, B = 26;
  const pts = useMemo(() => {
    const out = [];
    for (let x = fromMs; x <= toMs; x += 3 * 36e5) out.push([x, valueAt(table, "sun", x), valueAt(table, "earth", x)]);
    return out;
  }, [table, fromMs, toMs]);
  const lo = Math.min(-2, ...pts.map((p) => Math.min(p[1], p[2]))), hi = Math.max(2, ...pts.map((p) => Math.max(p[1], p[2])));
  const X = (x) => L + ((x - fromMs) / (toMs - fromMs)) * (W - L - R), Y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const path = (k) => pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join("");
  const ticksY = [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i);
  const days = [];
  for (let d = fromMs + LEAD_DAYS * DAY; d <= toMs; d += 7 * DAY) days.push(d);
  const at = hover ?? ms, last = pts[pts.length - 1];
  const move = (e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(fromMs, Math.min(toMs, fromMs + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (toMs - fromMs)))); };
  return (
    <figure className="chart">
      <figcaption>
        <strong>{t.chartTitle}</strong>
        <span className="legend"><i className="sw sun" />{t.sun} <i className="sw earth" />{t.earth}</span>
        <span className="readout">{f.full(at)} · {t.sun} {f.deg(valueAt(table, "sun", at))} · {t.earth} {f.deg(valueAt(table, "earth", at))}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label={t.chartTitle}>
        <rect x={L} y={Y(0)} width={W - L - R} height={Math.max(0, H - B - Y(0))} className="below" />
        {ticksY.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className={v === 0 ? "zero" : "grid"} /><text x={L - 8} y={Y(v) + 4} className="ax end">{f.deg(v)}</text></g>)}
        <text x={L + 6} y={Y(0) - 5} className="ax">{t.horizon}</text>
        {days.map((d) => <text key={d} x={X(d)} y={H - 7} className="ax mid">{f.day(d)}</text>)}
        <path d={path(1)} className="ln sun" /><path d={path(2)} className="ln earth" />
        <text x={X(last[0]) + 8} y={Y(last[1]) + 4} className="ax lab">{t.sun}</text>
        <text x={X(last[0]) + 8} y={Y(last[2]) + (Math.abs(Y(last[2]) - Y(last[1])) < 13 ? 17 : 4)} className="ax lab">{t.earth}</text>
        <line x1={X(at)} x2={X(at)} y1={T} y2={H - B} className="cursor" />
        <circle cx={X(at)} cy={Y(valueAt(table, "sun", at))} r="5" className="pt sun" /><circle cx={X(at)} cy={Y(valueAt(table, "earth", at))} r="5" className="pt earth" />
      </svg>
    </figure>
  );
}

function SiteDeep({ site, table, ms, fromMs, toMs, t, f }) {
  const [showTable, setShowTable] = useState(false);
  const stats = useMemo(() => windowStats(table, fromMs, toMs), [table, fromMs, toMs]);
  const sun = valueAt(table, "sun", ms);
  const flux = (x) => `${Math.round(x).toLocaleString()} W/m²`, hrs = (h) => f.dur(h, 0);
  const items = [
    [t.sunAz, `${Math.round(azAt(table, "sunAz", ms))}°`], [t.earthAz, `${Math.round(azAt(table, "earthAz", ms))}°`],
    [t.fluxFlat, flux(sun > 0 ? 1361 * Math.sin((sun * Math.PI) / 180) : 0)], [t.fluxTrack, flux(sun > 0 ? 1361 : 0)],
    [t.sunRange, `${f.deg(stats.sunMin)} … ${f.deg(stats.sunMax)}`], [t.earthRange, `${f.deg(stats.earthMin)} … ${f.deg(stats.earthMax)}`],
    [t.longestDay, hrs(stats.sunRun)], [t.longestNight, hrs(stats.darkRun)],
    [t.longestLink, hrs(stats.linkRun)], [t.longestGap, hrs(stats.gapRun)], [t.bothShare, `${stats.both}%`],
    [t.tempNow, surfaceTempC(sun) == null ? t.tempNight : `≈ ${Math.round(surfaceTempC(sun))} °C`],
  ];
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv(table)], { type: "text/csv" }));
    a.download = `${site.name.replace(/\W+/g, "-").toLowerCase()}-horizons.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const rows = [];
  for (let x = fromMs; x <= toMs; x += DAY) rows.push(x);
  return (
    <div className="deep">
      <h3>{t.deepTitle(site.name)}
        <button className="btn sm" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>{t.tableView}</button>
        <button className="btn sm" onClick={download}><Icon name="download" size={15} />{t.exportCsv}</button>
      </h3>
      {showTable ? (
        <table><thead><tr><th>{t.date}</th><th>{t.sunElev}</th><th>{t.sunAz}</th><th>{t.earthElev}</th><th>{t.earthAz}</th></tr></thead>
          <tbody>{rows.map((x) => <tr key={x}><td>{f.full(x)}</td><td className="num">{f.deg(valueAt(table, "sun", x))}</td><td className="num">{Math.round(azAt(table, "sunAz", x))}°</td>
            <td className="num">{f.deg(valueAt(table, "earth", x))}</td><td className="num">{Math.round(azAt(table, "earthAz", x))}°</td></tr>)}</tbody></table>
      ) : <ElevChart table={table} fromMs={fromMs} toMs={toMs} ms={ms} t={t} f={f} />}
      <dl className="stats">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="hint">{t.fluxNote}</p>
    </div>
  );
}

/* ---------- App ---------- */

export default function App() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [view, setView] = useState("overview");
  const [sites, setSites] = useState(SITES);
  const [selId, setSelId] = useState("sha");
  const [comparing, setComparing] = useState(false);
  const [cmpId, setCmpId] = useState("mal");
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ name: "", lat: "", lon: "" });
  const [planned, setPlanned] = useState("2026-11-15T12:00");
  const [delay, setDelay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [texReal, setTexReal] = useState(true);
  const [assets, setAssets] = useState(null);
  const [splash, setSplash] = useState(() => { try { return sessionStorage.getItem("lln:seen") ? "off" : "on"; } catch { return "on"; } });
  const [minTime, setMinTime] = useState(false);
  const [scen, setScen] = useState([{ siteId: "sha", delay: 0 }, { siteId: "sha", delay: 14 }]);
  const mode = prefs.mode ?? "advanced";
  const setMode = (m) => { setPrefs({ ...prefs, mode: m }); if (m === "simple" && !["overview", "sky", "calendar", "rover"].includes(view)) setView("overview"); };
  const openSplit = () => { // A = el plan tal como está; B = el mismo sitio una semana después, para empezar
    setScen([{ siteId: selId, delay }, { siteId: selId, delay: Math.min(MAX_DELAY, delay + 7) }]); setView("split");
  };

  const t = STRINGS[prefs.lang] ?? STRINGS.en;
  const f = useMemo(() => makeFmt(prefs.lang, t), [prefs.lang, t]);
  const { scoreDays } = prefs;

  useEffect(() => {
    document.documentElement.dataset.theme = "dark"; // la app es solo modo oscuro
    document.documentElement.lang = prefs.lang;
    try { localStorage.setItem("lln:prefs", JSON.stringify(prefs)); } catch { /* sin localStorage */ }
  }, [prefs]);

  const plannedMs = useMemo(() => {
    const ms = Date.parse(planned + ":00Z");
    return Math.floor((Number.isNaN(ms) ? Date.UTC(2026, 10, 15, 12) : ms) / 36e5) * 36e5;
  }, [planned]);
  const startMs = plannedMs - LEAD_DAYS * DAY, stopMs = startMs + FETCH_DAYS * DAY;
  const ms = plannedMs + delay * DAY;

  const firstId = useRef(selId);
  firstId.current = selId;
  const { moon, tableOf, error } = useHorizons(sites, firstId.current, startMs, stopMs, attempt);

  const site = sites.find((s) => s.id === selId) ?? sites[0];
  const others = sites.filter((s) => s.id !== site.id);
  const cmp = comparing ? others.find((s) => s.id === cmpId) ?? others[0] : null;
  const table = tableOf(site.id);

  useEffect(() => { loadAssets().then((a) => { setTexReal(!!a.color); setAssets(a); }); }, []);
  useEffect(() => { const id = setTimeout(() => setMinTime(true), 1900); return () => clearTimeout(id); }, []);
  useEffect(() => { // la pantalla de inicio se va cuando llegan los primeros datos (o a los 8 s)
    if (splash !== "on") return;
    const leave = () => { setSplash("out"); try { sessionStorage.setItem("lln:seen", "1"); } catch { /* sin sessionStorage */ } };
    if (minTime && (table || error)) { leave(); return; }
    const id = setTimeout(leave, 8000);
    return () => clearTimeout(id);
  }, [splash, minTime, table, error]);
  useEffect(() => { if (splash === "out") { const id = setTimeout(() => setSplash("off"), 700); return () => clearTimeout(id); } }, [splash]);

  useEffect(() => {
    if (!playing) return;
    let raf;
    const tick = () => {
      setDelay((d) => {
        if (d >= MAX_DELAY) { setPlaying(false); return MAX_DELAY; }
        return Math.min(MAX_DELAY, d + 0.05);
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const statuses = {};
  for (const s of sites) {
    const tb = tableOf(s.id);
    if (tb) statuses[s.id] = statusOf({ sunUp: valueAt(tb, "sun", ms) > 0, earthUp: valueAt(tb, "earth", ms) > 0 });
  }
  const sunDir = useMemo(() => (moon ? dirAt(moon, "sun", ms) : null), [moon, ms]);
  const earthDir = useMemo(() => (moon ? dirAt(moon, "earth", ms) : null), [moon, ms]);
  const st = statuses[site.id];

  const addCustom = (ev) => {
    ev.preventDefault();
    const lat = parseFloat(custom.lat.replace(",", ".")), lon = parseFloat(custom.lon.replace(",", "."));
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 360)) return;
    const s = { id: `c${Date.now()}`, name: custom.name.trim() || `Custom ${sites.length - SITES.length + 1}`, lat, lon: lon > 180 ? lon - 360 : lon };
    setSites([...sites, s]);
    setSelId(s.id);
    setCustom({ name: "", lat: "", lon: "" });
    setAdding(false);
  };

  const tabs = mode === "simple"
    ? [["overview", "globe"], ["sky", "sunset"], ["calendar", "calendar"], ["rover", "rover"]]
    : [["overview", "globe"], ["sky", "sunset"], ["calendar", "calendar"], ["analysis", "chart"], ["split", "columns"], ["planning", "scale"], ["rover", "rover"], ["data", "database"], ["settings", "gear"]];
  const globe = (
    <Globe sites={sites} selected={site} statuses={statuses} onSelect={setSelId} sunDir={sunDir} earthDir={earthDir}
      sunUp={table ? valueAt(table, "sun", ms) > 0 : false} earthUp={table ? valueAt(table, "earth", ms) > 0 : false}
      labels={{ sun: t.sun, earth: t.earth, dragHint: t.dragHint }} />
  );
  const shared = { scoreDays, t, f };

  return (
    <div className="app">
      {splash !== "off" && <Splash leaving={splash === "out"} t={t} />}
      {splash === "off" && !prefs.mode && <ModePicker onPick={setMode} t={t} />}
      <header className="top">
        <div className="brand">
          <svg width="44" height="28" viewBox="0 0 62 40" aria-hidden="true"><path d="M4 34C6 16 20 5 34 5c11 0 20 7 24 17-6-7-14-11-23-11C22 11 11 20 4 34z" fill="currentColor" /></svg>
          <h1>{t.brand1}<span>{t.brand2}</span></h1>
        </div>
        <nav className="glass" aria-label="Sections">
          {tabs.map(([id, icon]) => (
            <button key={id} title={t[id]} aria-label={t[id]} className={view === id ? "on" : ""} aria-current={view === id ? "page" : undefined} onClick={() => (id === "split" ? openSplit() : setView(id))}>
              <Icon name={icon} size={17} /><span>{t[id]}</span>
            </button>
          ))}
        </nav>
        <div className="tools">
          <p className={`ready ${error ? "bad" : st ?? "none"}`}><i className="dot" />{error ? t.ready_err : t[`ready_${st ?? "none"}`]}</p>
          <Segmented label={t.mode} value={mode} onChange={setMode} options={[["simple", t.simple], ["advanced", t.advanced]]} />
          <Segmented label={t.language} value={prefs.lang} onChange={(lang) => setPrefs({ ...prefs, lang })} options={[["es", "ES"], ["en", "EN"]]} />
        </div>
      </header>

      {error && (
        <p className="error" role="alert">{t.error(error)} <button className="link" onClick={() => setAttempt(attempt + 1)}>{t.retry}</button></p>
      )}

      {view === "overview" && mode === "simple" && (
        <SimpleView sites={sites} site={site} setSelId={setSelId} statuses={statuses} table={table} ms={ms} globe={globe} onDrive={() => setView("rover")} {...shared} />
      )}
      {view === "sky" && <main><Sky site={site} table={table} plannedMs={plannedMs} ms={ms} {...shared} /></main>}
      {view === "data" && <main><DataView site={site} table={table} ms={ms} assets={assets} t={t} f={f} /></main>}
      {view === "calendar" && <main><Calendar site={site} table={table} plannedMs={plannedMs} delay={delay} setDelay={(d) => { setPlaying(false); setDelay(d); }} ms={ms} t={t} f={f} /></main>}
      {view === "split" && <Split sites={sites} tableOf={tableOf} moon={moon} plannedMs={plannedMs} scen={scen} setScen={setScen} {...shared} />}
      {view === "rover" && <main><Rover site={site} table={table} ms={ms} t={t} f={f} /></main>}
      {view === "overview" && mode === "advanced" && (
        <main className="overview">
          <aside className="glass sites">
            <div className="p-head">
              <span className="pin-ic"><Icon name="pin" size={18} /></span>
              <h3>{t.sites}</h3>
              <button className="icon-btn" onClick={() => setAdding(!adding)} aria-label={t.addCustom} title={t.addCustom} aria-expanded={adding}><Icon name="plus" size={18} /></button>
            </div>
            {adding && (
              <form className="custom" onSubmit={addCustom}>
                <input aria-label={t.name} placeholder={t.name} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
                <div>
                  <input aria-label={t.lat} placeholder={t.lat} inputMode="decimal" value={custom.lat} onChange={(e) => setCustom({ ...custom, lat: e.target.value })} />
                  <input aria-label={t.lon} placeholder={t.lon} inputMode="decimal" value={custom.lon} onChange={(e) => setCustom({ ...custom, lon: e.target.value })} />
                </div>
                <button type="submit" className="btn">{t.addSite}</button>
              </form>
            )}
            <ul>
              {sites.map((s) => (
                <li key={s.id}>
                  <button className={s.id === site.id ? "on" : ""} onClick={() => setSelId(s.id)}>
                    <SiteThumb site={s} />
                    <i className={`dot ${statuses[s.id] ?? "none"}`} />
                    <span><strong>{s.name}</strong><small>{f.coord(s)}</small></span>
                    <Icon name="chev" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <button className={`btn compare ${comparing ? "on" : ""}`} onClick={() => setComparing(!comparing)} aria-pressed={comparing}>
              <Icon name="scale" size={17} />{t.compare}
            </button>
          </aside>

          <div className="stage">{globe}</div>

          <div className="right">
            <SiteCard site={site} table={table} ms={ms} plannedMs={plannedMs} {...shared} />
            {cmp && (
              <>
                <label className="cmp-pick">{t.compareWith}
                  <select value={cmp.id} onChange={(e) => setCmpId(e.target.value)}>
                    {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <SiteCard site={cmp} table={tableOf(cmp.id)} ms={ms} plannedMs={plannedMs} {...shared} />
              </>
            )}
          </div>
        </main>
      )}
      {view === "analysis" && <main><Analysis sites={sites} tableOf={tableOf} selId={site.id} setSelId={setSelId} ms={ms} plannedMs={plannedMs} {...shared} /></main>}
      {view === "planning" && <main><Planning sites={sites} site={site} setSelId={setSelId} table={table} plannedMs={plannedMs} delay={delay} setDelay={(d) => { setPlaying(false); setDelay(d); }} {...shared} /></main>}
      {view === "settings" && <main><Settings prefs={prefs} setPrefs={setPrefs} texReal={texReal} t={t} /></main>}

      {!["settings", "split", "rover"].includes(view) && (
        <Timeline table={table} plannedMs={plannedMs} planned={planned} setPlanned={setPlanned}
          delay={delay} setDelay={setDelay} playing={playing} setPlaying={setPlaying} {...shared} />
      )}
    </div>
  );
}
