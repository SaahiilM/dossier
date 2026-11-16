#!/usr/bin/env bash
# Local dev: Next on 127.0.0.1 + Electron against it (separate userData, token sign-in).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${NVM_NODE:-$HOME/.nvm/versions/node/v24.14.1/bin}:$PATH"
DATA="$ROOT/data"
LOGS="$DATA/logs"
PID_DIR="$DATA"
WEB_PID="$PID_DIR/next-dev.pid"
DESK_PID="$PID_DIR/electron-dev.pid"
WEB_LOG="$LOGS/next-dev.log"
DESK_LOG="$LOGS/electron-dev.log"
USER_DATA="$DATA/desktop-user-data"
PORT="${DOSSIER_DEV_PORT:-3000}"
ORIGIN="http://127.0.0.1:${PORT}"

mkdir -p "$LOGS" "$USER_DATA"

stop_one() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
    rm -f "$pidfile"
  fi
}

cmd="${1:-start}"

case "$cmd" in
  stop)
    node "$ROOT/scripts/dev-local-spawn.mjs" stop 2>/dev/null || true
    stop_one "$WEB_PID"
    stop_one "$DESK_PID"
    echo "Stopped dev processes (if they were running)."
    ;;
  status)
    node "$ROOT/scripts/dev-local-spawn.mjs" verify || true
    ;;
  start)
    if [[ ! -f "$ROOT/.env" ]]; then
      echo "Missing $ROOT/.env — run: scripts/dev-local.sh setup-env" >&2
      exit 1
    fi
    # shellcheck disable=SC1091
    set -a && source "$ROOT/.env" && set +a
    stop_one "$WEB_PID"
    stop_one "$DESK_PID"
    # Fully detached spawn (not nohup &) so processes survive harness/session exit.
    node "$ROOT/scripts/dev-local-spawn.mjs" start
    # Independent verify after launcher exits (truthful persistence check).
    node "$ROOT/scripts/dev-local-spawn.mjs" verify
    ;;
  setup-env)
    REPO="$ROOT" node --input-type=module <<'NODE'
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const root = process.env.REPO;
const data = path.join(root, "data");
const db = path.join(data, "dev.db");
mkdirSync(path.join(data, "logs"), { recursive: true });
const secret = randomBytes(32).toString("base64");
const desktopToken = randomBytes(32).toString("base64url");
const pw = randomBytes(24).toString("base64url");
const hash = execSync("yarn hash-password", {
  cwd: root,
  input: `${pw}\n`,
  encoding: "utf8",
  env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v24.14.1/bin:${process.env.PATH}` },
}).trim();
const lines = [
  "# Local development only — gitignored",
  `DATABASE_URL=file:${db}`,
  `DOSSIER_DATA_DIR=${data}`,
  `DOSSIER_SECRET=${secret}`,
  `DOSSIER_PASSWORD=${hash}`,
  `DOSSIER_DESKTOP_TOKEN=${desktopToken}`,
  "DOSSIER_DESKTOP_PRINT_URL=http://127.0.0.1:9473",
  "DOSSIER_TELEMETRY=off",
  "",
];
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  console.error(".env already exists; not overwriting.");
  process.exit(1);
}
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
console.error("Wrote .env (secrets not printed).");
NODE
    ;;
  *)
    echo "Usage: $0 {setup-env|start|stop|status}" >&2
    exit 1
    ;;
esac
