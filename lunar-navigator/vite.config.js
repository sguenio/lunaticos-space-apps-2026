import { defineConfig } from "vite";

// El navegador no puede pedir estos recursos de NASA directamente (CORS),
// así que Vite hace de puente:
//   /horizons?...   ->  https://ssd.jpl.nasa.gov/api/horizons.api?...   (datos de Sol y Tierra)
//   /nasa-svs/...   ->  https://svs.gsfc.nasa.gov/...                   (mapa y relieve de la Luna)
const proxy = {
  "/horizons": {
    target: "https://ssd.jpl.nasa.gov",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/horizons/, "/api/horizons.api"),
  },
  "/nasa-svs": {
    target: "https://svs.gsfc.nasa.gov",
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/nasa-svs/, ""),
  },
};

export default defineConfig({
  esbuild: { jsx: "automatic" },
  server: { proxy },
  preview: { proxy },
});
