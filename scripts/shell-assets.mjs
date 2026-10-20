import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.(js|css)$/.test(name)) acc.push(path);
  }
  return acc;
}

const root = ".next/static";
const files = walk(root).map((path) => `/_next/static/${path.slice(root.length + 1).split("\\").join("/")}`);
writeFileSync("public/shell-assets.json", JSON.stringify(files));
console.log(`shell-assets.json: ${files.length} archivos`);
