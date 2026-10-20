import { mkdirSync } from "node:fs";
import sharp from "sharp";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
  <rect width="960" height="1280" fill="#16352d"/>
  <rect x="70" y="90" width="820" height="1100" fill="none" stroke="#d7c4a3" stroke-width="2"/>
  <text x="110" y="180" fill="#f3efe4" font-family="Georgia, serif" font-size="64">Talón</text>
  <text x="110" y="230" fill="#d7c4a3" font-family="sans-serif" font-size="22">mostrador · depósito · caja</text>
  <g fill="#1f4a3e" stroke="#d7c4a3" stroke-width="1">
    <rect x="110" y="300" width="740" height="72"/>
    <rect x="110" y="390" width="740" height="72"/>
    <rect x="110" y="480" width="740" height="72"/>
    <rect x="110" y="570" width="740" height="72"/>
    <rect x="110" y="660" width="740" height="72"/>
  </g>
  <text x="140" y="346" fill="#f3efe4" font-family="sans-serif" font-size="22">Factura A  0004-00000048</text>
  <text x="140" y="436" fill="#f3efe4" font-family="sans-serif" font-size="22">Yerba mate 1 kg Litoral</text>
  <text x="140" y="526" fill="#f3efe4" font-family="sans-serif" font-size="22">Tornillo 8 mm Oficio</text>
  <text x="140" y="616" fill="#f3efe4" font-family="sans-serif" font-size="22">IVA 21%</text>
  <text x="140" y="706" fill="#e4c36a" font-family="sans-serif" font-size="22">Total $ 186.000,00</text>
  <circle cx="760" cy="1040" r="70" fill="#c4a15a"/>
</svg>`;

mkdirSync("public/marca", { recursive: true });
await sharp(Buffer.from(svg)).webp({ quality: 68 }).toFile("public/marca/mostrador.webp");
const info = await sharp("public/marca/mostrador.webp").metadata();
console.log(info.format, info.width, info.height);
