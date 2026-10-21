import { spawn } from "node:child_process";
import { startBackupWorker } from "./backup-process.mjs";
import { loadEnv } from "./load-env";

loadEnv();

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} ${args.join(" ")} salió con código ${code}`),
        );
    });
  });
}

async function main() {
  await run(process.execPath, ["--import", "tsx", "scripts/migrate.ts"]);
  await run(process.execPath, ["--import", "tsx", "scripts/seed.ts"]);
  const stopBackups = startBackupWorker();
  try {
    await run(process.execPath, [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "0.0.0.0",
      "--port",
      "4317",
    ]);
  } finally {
    stopBackups();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
