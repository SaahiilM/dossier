#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

repo_root=$(cd "$(dirname "$0")/.." && pwd)
libexec="$HOME/.local/libexec"
unit_dir="$HOME/.config/systemd/user"
root="$HOME/.local/share/dossier-auto-deploy"
config_dir="$HOME/.config/dossier-auto-deploy"
env_file="$config_dir/container.env"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
docker inspect dossier-app >/dev/null 2>&1 || { echo "Expected dossier-app container was not found." >&2; exit 1; }
mkdir -p "$libexec" "$unit_dir" "$root/state" "$config_dir"
chmod 700 "$root" "$root/state" "$config_dir"
install -m 700 "$repo_root/scripts/deploy-linux-main.py" "$libexec/dossier-auto-deploy"

# Capture the existing runtime environment without printing any secret values.
# Keep it private, outside git, and don't replace it on future installs.
if [[ ! -e "$env_file" ]]; then
  docker inspect dossier-app --format '{{json .Config.Env}}' | python3 -c '
import json,sys
for item in json.load(sys.stdin):
    key, sep, value = item.partition("=")
    if not sep or "\n" in value or "\r" in value:
        raise SystemExit("Cannot safely persist the current container environment.")
    if key == "HOSTNAME":
        continue
    print(key+"="+value)
' > "$env_file"
fi
chmod 600 "$env_file"

cat > "$unit_dir/dossier-auto-deploy.service" <<EOF
[Unit]
Description=Build and deploy Dossier from the personal fork's main branch
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=DOSSIER_AUTO_DEPLOY_ROOT=$root
Environment=DOSSIER_AUTO_DEPLOY_ENV_FILE=$env_file
ExecStart=$libexec/dossier-auto-deploy
TimeoutStartSec=45min
EOF

cat > "$unit_dir/dossier-auto-deploy.timer" <<'EOF'
[Unit]
Description=Check Dossier main for merged changes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true
Unit=dossier-auto-deploy.service

[Install]
WantedBy=timers.target
EOF
chmod 600 "$unit_dir/dossier-auto-deploy.service" "$unit_dir/dossier-auto-deploy.timer"

if [[ ! -s "$root/state/deploy.json" ]]; then
  python3 - "$root/state/deploy.json" <<'PY'
import json,os,sys
path=sys.argv[1]
state={"current_sha":"1b04e91e6979e896e919ff5ffa7cdac4a498f61c",
       "image":"dossier:linux-siwc-20261117",
       "deployed_at":"2026-11-17T00:00:00Z"}
with open(path,"w") as f: json.dump(state,f,indent=2); f.write("\n")
os.chmod(path,0o600)
PY
fi

systemctl --user daemon-reload
systemctl --user enable --now dossier-auto-deploy.timer
systemctl --user start dossier-auto-deploy.service
echo "Installed dossier-auto-deploy.timer; it checks fork main every two minutes."
