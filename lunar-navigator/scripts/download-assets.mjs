// Descarga el mapa y el relieve de la Luna (NASA SVS, CGI Moon Kit) a public/,
// para que la demo funcione sin internet. Uso: npm run assets
import { writeFile, mkdir } from "node:fs/promises";

const BASE = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/";
const FILES = { "moon.jpg": "lroc_color_2k.jpg", "moon-bump.jpg": "ldem_3_8bit.jpg" };

await mkdir("public", { recursive: true });
for (const [local, remote] of Object.entries(FILES)) {
  const res = await fetch(BASE + remote);
  if (!res.ok) throw new Error(`No se pudo descargar ${remote}: HTTP ${res.status}`);
  await writeFile(`public/${local}`, Buffer.from(await res.arrayBuffer()));
  console.log(`public/${local}  <-  ${BASE + remote}`);
}
