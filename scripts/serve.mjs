import { spawn } from "node:child_process";
import { loadEnv } from "./load-env-runtime.mjs";
import { startBackupWorker } from "./backup-process.mjs";
loadEnv();
const stopBackups = startBackupWorker();
const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stopping = true;
    stopBackups();
    server.kill(signal);
  });
server.on("error", () => {
  stopBackups();
  console.error("No se pudo iniciar Talón");
  process.exitCode = 1;
});
server.on("exit", (code) => {
  stopBackups();
  process.exitCode = stopping ? 0 : (code ?? 1);
});
