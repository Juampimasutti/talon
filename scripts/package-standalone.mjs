#!/usr/bin/env node
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const runtimeScripts = join(standalone, "scripts");

await mkdir(join(standalone, ".next"), { recursive: true });
await mkdir(runtimeScripts, { recursive: true });
await cp(join(root, "public"), join(standalone, "public"), {
  recursive: true,
  force: true,
});
await cp(join(root, ".next", "static"), join(standalone, ".next", "static"), {
  recursive: true,
  force: true,
});
await cp(join(root, "drizzle"), join(standalone, "drizzle"), {
  recursive: true,
  force: true,
});

await build({
  absWorkingDir: root,
  entryPoints: {
    migrate: "scripts/migrate.ts",
    "empresa-autorizar": "scripts/company-operator.ts",
    "backup-worker": "scripts/backup-worker.mjs",
    "prueba-doble-cobro": "scripts/prueba-doble-cobro.mjs",
  },
  outdir: runtimeScripts,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outExtension: { ".js": ".js" },
  legalComments: "none",
  sourcemap: false,
});

await Promise.all([
  cp(join(root, "scripts", "load-env-runtime.mjs"), join(runtimeScripts, "load-env-runtime.mjs")),
  cp(join(root, "scripts", "run-standalone.mjs"), join(runtimeScripts, "run-standalone.mjs")),
]);
await writeFile(join(runtimeScripts, "package.json"), '{"type":"module"}\n');

// Next puede copiar los archivos usados durante el build. La configuración real
// se entrega por TALON_ENV_FILE y nunca debe quedar dentro del paquete.
for (const name of await readdir(standalone)) {
  if (name === ".env" || name.startsWith(".env.")) {
    await rm(join(standalone, name), { force: true, recursive: true });
  }
}

console.log(`Standalone preparado en ${standalone}`);
