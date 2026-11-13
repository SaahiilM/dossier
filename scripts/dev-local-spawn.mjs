/** Spawn Next + Electron fully detached (survives parent shell / harness exit). */
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "data");
const logs = join(data, "logs");
const webPid = join(data, "next-dev.pid");
const deskPid = join(data, "electron-dev.pid");
const webLog = join(logs, "next-dev.log");
const deskLog = join(logs, "electron-dev.log");
const userData = join(data, "desktop-user-data");

function loadEnvFile() {
  const path = join(root, ".env");
  if (!existsSync(path)) {
    console.error(`Missing ${path} — run: scripts/dev-local.sh setup-env`);
    process.exit(1);
  }
  const env = { ...process.env };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i);
    let val = t.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function spawnDetached(cmd, args, { env, logPath }) {
  delete env.ELECTRON_RUN_AS_NODE;
  mkdirSync(logs, { recursive: true });
  const logFd = openSync(logPath, "a");
  const child = spawn(cmd, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  child.unref();
  return child.pid;
}

async function waitForHttp(url, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return res.status;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

function readPid(file) {
  if (!existsSync(file)) return null;
  const n = Number(readFileSync(file, "utf8").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findListenPid(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    }).trim();
    const pids = out.split("\n").filter(Boolean).map(Number);
    return pids[0] ?? null;
  } catch {
    return null;
  }
}

function findElectronPid() {
  const needle = userData;
  try {
    const out = execFileSync("pgrep", ["-fl", "MacOS/Electron"], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      if (line.includes(needle) && line.includes(join(root, "desktop"))) {
        const pid = Number(line.trim().split(/\s+/)[0]);
        if (pidAlive(pid)) return pid;
      }
    }
  } catch {
    /* none */
  }
  return null;
}

async function cmdStart() {
  const baseEnv = loadEnvFile();
  const port = String(baseEnv.DOSSIER_DEV_PORT ?? baseEnv.PORT ?? "3000");
  const origin = `http://127.0.0.1:${port}`;
  mkdirSync(userData, { recursive: true });

  const nextBin = join(root, "node_modules/next/dist/bin/next");
  const nextEnv = {
    ...baseEnv,
    HOSTNAME: "127.0.0.1",
    PORT: port,
  };
  const nextRootPid = spawnDetached(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", port], {
    env: nextEnv,
    logPath: webLog,
  });
  writeFileSync(webPid, String(nextRootPid));

  const status = await waitForHttp(`${origin}/login`);
  if (status == null) {
    console.error(`Next did not become ready at ${origin}/login (see ${webLog})`);
    process.exit(1);
  }

  const electronBin = join(
    root,
    "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  if (!existsSync(electronBin)) {
    console.error(`Missing Electron binary — run yarn in desktop/ (${electronBin})`);
    process.exit(1);
  }

  const deskEnv = {
    ...baseEnv,
    DOSSIER_DESKTOP_DEV_URL: origin,
    DOSSIER_DESKTOP_DEV_TOKEN: baseEnv.DOSSIER_DESKTOP_TOKEN ?? "",
    DOSSIER_DESKTOP_PRINT_PORT: "9473",
  };
  const electronRootPid = spawnDetached(
    electronBin,
    [join(root, "desktop"), `--user-data-dir=${userData}`],
    { env: deskEnv, logPath: deskLog },
  );
  writeFileSync(deskPid, String(electronRootPid));

  console.log(`Next: ${origin} (root pid ${nextRootPid}, log ${webLog})`);
  console.log(`Electron userData: ${userData} (root pid ${electronRootPid}, log ${deskLog})`);
  console.log(`Print service port: 9473`);
}

async function cmdVerify() {
  const baseEnv = loadEnvFile();
  const port = String(baseEnv.DOSSIER_DEV_PORT ?? baseEnv.PORT ?? "3000");
  const origin = `http://127.0.0.1:${port}`;

  let httpCode = "000";
  try {
    const res = await fetch(`${origin}/login`, { redirect: "manual" });
    httpCode = String(res.status);
  } catch {
    httpCode = "000";
  }

  const listenPid = findListenPid(port);
  const fileNextPid = readPid(webPid);
  const fileDeskPid = readPid(deskPid);
  const electronPid = findElectronPid();

  const nextRootAlive = fileNextPid != null && pidAlive(fileNextPid);
  const deskFileAlive = fileDeskPid != null && pidAlive(fileDeskPid);

  console.log(JSON.stringify({
    origin,
    loginHttp: httpCode,
    nextListenPid: listenPid,
    nextRootPid: fileNextPid,
    nextRootAlive,
    electronPidFromCmdline: electronPid,
    electronPidFile: fileDeskPid,
    electronPidFileAlive: deskFileAlive,
    printPort: 9473,
    webLog,
    deskLog,
  }, null, 2));

  if (httpCode !== "200" || listenPid == null || electronPid == null) {
    process.exit(1);
  }
}

function cmdStop() {
  for (const [label, file] of [
    ["next", webPid],
    ["electron", deskPid],
  ]) {
    const pid = readPid(file);
    if (pid == null) continue;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    if (existsSync(file)) unlinkSync(file);
    console.log(`stopped ${label} (pid file ${pid})`);
  }
}

const sub = process.argv[2] ?? "start";
if (sub === "start") await cmdStart();
else if (sub === "verify") await cmdVerify();
else if (sub === "stop") cmdStop();
else {
  console.error("Usage: dev-local-spawn.mjs {start|verify|stop}");
  process.exit(1);
}
