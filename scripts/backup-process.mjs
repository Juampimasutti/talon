import { spawn } from "node:child_process";

/** El proceso acompaña al servidor; no instala servicios ni modifica el sistema. */
export function startBackupWorker() {
  const worker = spawn(process.execPath, ["scripts/backup-worker.mjs"], {
    stdio: "inherit",
    env: process.env,
  });
  worker.on("error", () =>
    console.error(
      "No se pudo iniciar el respaldo automático. Usá Respaldos → Guardar respaldo ahora.",
    ),
  );
  const stop = () => {
    if (!worker.killed) worker.kill();
  };
  process.once("exit", stop);
  return () => {
    stop();
    process.removeListener("exit", stop);
  };
}
