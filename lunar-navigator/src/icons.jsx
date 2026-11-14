const P = {
  pin: ["M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z", "M12 12.7a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"],
  plus: ["M12 5v14M5 12h14"],
  chev: ["M9 6l6 6-6 6"],
  scale: ["M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0L5 8zM19 8l-3 6a3 3 0 0 0 6 0l-3-6z"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"],
  sunset: ["M2 20h20M5 16h14M7 16a5 5 0 0 1 10 0M12 4v4M5.3 8.3l1.8 1.8M18.7 8.3l-1.8 1.8"],
  eye: ["M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z", "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"],
  antenna: ["M12 13v8M9 21h6M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.7 18.3a9 9 0 0 1 0-12.6M18.3 5.7a9 9 0 0 1 0 12.6"],
  external: ["M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  alert: ["M12 8v5M12 16.5v.5"],
  chart: ["M4 20V10M10 20V4M16 20v-7M21 20H3"],
  calendar: ["M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M4 9h16M8 3v4M16 3v4"],
  moon: ["M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"],
  columns: ["M4 5h16v14H4zM12 5v14"],
  rover: ["M3 13h18v3H3zM6 13l2-5h8l2 5", "M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  download: ["M12 4v11M7 11l5 5 5-5M5 20h14"],
  database: ["M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z", "M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6", "M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"],
};
const FILLED = {
  bolt: "M13 2L5 13.5h6L10 22l8-11.5h-6L13 2z",
  play: "M8 5l11 7-11 7z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
};

export default function Icon({ name, size = 18 }) {
  const filled = FILLED[name];
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {filled ? <path d={filled} /> : P[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
