// Build the standalone SQLite seed as ESM. The global require bridges dynamic
// CommonJS dependencies used by Prisma's generated client at runtime.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, ".next", "desktop-seed.mjs");
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(path.join(root, "node_modules", ".bin", "esbuild"), [
  path.join(root, "prisma", "seed.ts"), "--bundle", "--platform=node", "--format=esm", "--target=node24",
  "--external:pg-native", "--external:better-sqlite3", `--outfile=${output}`,
  '--banner:js=import { createRequire } from "node:module"; globalThis.require = createRequire(import.meta.url);',
], { cwd: root, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Built ${path.relative(root, output)}`);
