// Puts the top bar, the start screen, their fonts and the icon next to the compiled code.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const desktop = path.join(import.meta.dirname, "..");
const fonts = path.join(desktop, "..", "src", "fonts");
const out = path.join(desktop, "dist", "start");

mkdirSync(path.join(out, "fonts"), { recursive: true });
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: desktop, encoding: "utf8" });
writeFileSync(path.join(desktop, "dist", "revision.txt"), revision.status === 0 ? revision.stdout.trim() : "");
cpSync(path.join(desktop, "start"), out, { recursive: true });
cpSync(path.join(desktop, "bar"), path.join(desktop, "dist", "bar"), { recursive: true });
cpSync(path.join(desktop, "assets", "icon.png"), path.join(desktop, "dist", "icon.png"));
for (const file of ["geist/Geist-Regular.woff2", "geist/Geist-Medium.woff2", "geist/Geist-SemiBold.woff2", "newsreader/Newsreader-Regular.woff2"]) {
  cpSync(path.join(fonts, file), path.join(out, "fonts", path.basename(file)));
}
