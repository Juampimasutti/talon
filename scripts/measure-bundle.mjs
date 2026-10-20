import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("docs", { recursive: true });
import esbuild from "esbuild";

const screens = [
  "src/components/tablero/tablero-screen.tsx",
  "src/components/directorio/directorio-screen.tsx",
  "src/components/articulos/articulos-screen.tsx",
  "src/components/documentos/lista-screen.tsx",
  "src/components/documentos/editor-screen.tsx",
  "src/components/documentos/detalle-screen.tsx",
  "src/components/stock/stock-screen.tsx",
  "src/components/caja/caja-screen.tsx",
  "src/components/cuentas/cuentas-screen.tsx",
  "src/components/contabilidad/contabilidad-screen.tsx",
  "src/components/comprobantes/comprobantes-screen.tsx",
  "src/components/auditoria/auditoria-screen.tsx",
  "src/components/configuracion/configuracion-screen.tsx",
  "src/components/ingreso/ingreso-screen.tsx",
];

const external = ["react", "react-dom", "react/jsx-runtime", "next", "next/navigation", "next/link", "next/image", "next/font/google"];

async function sizeOf(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    minify: true,
    external,
    outfile: "out.js",
  });
  const file = result.outputFiles[0];
  return { bytes: file.contents.length, gzip: gzipSync(file.contents).length };
}

mkdirSync("scripts/entries", { recursive: true });
const monolithPath = "scripts/entries/monolith.tsx";
writeFileSync(
  monolithPath,
  screens.map((screen, index) => `import * as screen${index} from "../../${screen}";`).join("\n") +
    "\nexport const screens = [" +
    screens.map((_, index) => `screen${index}`).join(", ") +
    "];\n",
);

const monolith = await sizeOf(monolithPath);
const parts = [];
for (const screen of screens) {
  const entry = `scripts/entries/${screen.split("/").at(-1)}`;
  writeFileSync(entry, `export { } from "../../${screen.replace(/\.tsx$/, "")}";\nimport * as screen from "../../${screen}";\nexport default screen;\n`);
  parts.push({ screen, ...(await sizeOf(entry)) });
}
parts.sort((a, b) => b.gzip - a.gzip);
const largest = parts[0];
const report = {
  monolithGzip: monolith.gzip,
  monolithBytes: monolith.bytes,
  largestScreen: largest.screen,
  largestGzip: largest.gzip,
  tableroGzip: parts.find((part) => part.screen.includes("tablero"))?.gzip,
  parts: parts.map((part) => ({ screen: part.screen.split("/").at(-1), gzip: part.gzip })),
};
writeFileSync("docs/bundle.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
