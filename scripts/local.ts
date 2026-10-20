import { spawn } from "node:child_process";
import { loadEnv } from "./load-env";

loadEnv();

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} salió con código ${code}`));
    });
  });
}

async function main() {
  await run("npx", ["tsx", "scripts/migrate.ts"]);
  await run("npx", ["tsx", "scripts/seed.ts"]);
  await run("npx", ["next", "dev", "--hostname", "0.0.0.0", "--port", "4317"]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
