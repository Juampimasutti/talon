import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import esbuild from "esbuild";

const root = process.cwd();
const screens = [
  "tablero/tablero-screen", "directorio/directorio-screen", "articulos/articulos-screen",
  "documentos/lista-screen", "documentos/editor-screen", "documentos/detalle-screen",
  "stock/stock-screen", "caja/caja-screen", "cuentas/cuentas-screen",
  "contabilidad/contabilidad-screen", "comprobantes/comprobantes-screen", "auditoria/auditoria-screen",
  "configuracion/configuracion-screen", "ingreso/ingreso-screen", "estacion/estacion-screen",
  "documentos/imprimir-screen",
].map((screen) => `src/components/${screen}.tsx`);

async function measure(contents) {
  const result = await esbuild.build({
    absWorkingDir: root,
    stdin: { contents, resolveDir: root, sourcefile: "bundle-entry.tsx", loader: "tsx" },
    bundle: true, write: false, metafile: true, splitting: true,
    format: "esm", platform: "browser", jsx: "automatic", minify: true,
    external: ["react", "react-dom", "next"], outdir: "out/bundle-measure",
    tsconfig: "tsconfig.json",
  });
  const outputs = result.metafile.outputs;
  const files = new Map(result.outputFiles.map((file) => [path.resolve(file.path), file.contents]));
  const entry = Object.keys(outputs).find((key) => key.endsWith("/stdin.js"));
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    initial.add(key);
    for (const item of outputs[key].imports) {
      if (!item.external && item.kind !== "dynamic-import") visit(item.path);
    }
  }
  visit(entry);
  const sizes = (keys) => keys.reduce((sum, key) => {
    const data = files.get(path.resolve(root, key));
    return { bytes: sum.bytes + data.length, gzip: sum.gzip + gzipSync(data).length };
  }, { bytes: 0, gzip: 0 });
  return { initial: sizes([...initial]), total: sizes(Object.keys(outputs)), chunks: files.size };
}

const monolith = await measure(screens.map((screen, i) => `import * as s${i} from "./${screen}";`).join("\n") + `\nexport const screens = [${screens.map((_, i) => `s${i}`).join(",")}];`);
const parts = [];
for (const screen of screens) {
  parts.push({ screen, ...await measure(`export * from "./${screen}";`) });
}
parts.sort((a, b) => b.initial.gzip - a.initial.gzip);
const report = {
  measurement: "Esbuild module graph, React/Next external. Initial includes static shared chunks; total includes deferred imports. This is not the full Next.js network payload. The monolith is a synthetic comparison.",
  monolithGzip: monolith.initial.gzip,
  monolithBytes: monolith.initial.bytes,
  largestScreen: parts[0].screen,
  largestGzip: parts[0].initial.gzip,
  tableroGzip: parts.find((part) => part.screen.includes("tablero"))?.initial.gzip,
  parts,
};
mkdirSync("docs", { recursive: true });
writeFileSync("docs/bundle.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
