#!/usr/bin/env python3
"""Safe pull-based deployment of fork/main to the single-instance Linux host."""
from __future__ import annotations

import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

APP = "dossier-app"
VOLUME = "dossier-data"
NETWORK = "simfin_backend"
IMAGE_REPO = "dossier"
PUBLIC_HEALTH = "https://dossier.sahmai.party/api/health"
SOURCE_URL = "https://github.com/SaahiilM/dossier.git"
ROOT = Path(os.environ.get("DOSSIER_AUTO_DEPLOY_ROOT", Path.home() / ".local/share/dossier-auto-deploy"))
STATE_DIR = ROOT / "state"
STATE_FILE = STATE_DIR / "deploy.json"
ENV_FILE = Path(os.environ.get("DOSSIER_AUTO_DEPLOY_ENV_FILE", Path.home() / ".config/dossier-auto-deploy/container.env"))


def run(args: list[str]) -> str:
    result = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE)
    return result.stdout.strip()


def docker(*args: str) -> str:
    return run(["docker", *args])


def save_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix="deploy.", dir=STATE_DIR, text=True)
    try:
        with os.fdopen(fd, "w") as file:
            json.dump(state, file, indent=2)
            file.write("\n")
        os.chmod(name, 0o600)
        os.replace(name, STATE_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def get_state() -> dict:
    return json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}


def health(name: str) -> str:
    result = subprocess.run(
        ["docker", "inspect", name, "--format",
         "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "missing"


def wait_health(name: str, seconds: int) -> bool:
    for _ in range(seconds // 5):
        status = health(name)
        if status == "healthy":
            return True
        if status in ("unhealthy", "exited", "dead", "missing"):
            return False
        time.sleep(5)
    return False


def read_json_health(url: str, timeout: int = 15) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read())
    except Exception:
        return None


def record_failure(state: dict, sha: str, reason: str) -> None:
    state["last_failed_sha"] = sha
    state["last_failure"] = reason
    save_state(state)


def acquire_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_file = path.open("a")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return lock_file
    except BlockingIOError:
        lock_file.close()
        return None


def restore(previous_name: str, failed_sha: str, state: dict, reason: str) -> None:
    print("Dossier deployment failed; restoring the previous container.")
    subprocess.run(["docker", "rm", "-f", APP], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if health(previous_name) != "missing":
        subprocess.run(["docker", "network", "connect", "--alias", "dossier-app", NETWORK, previous_name],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(["docker", "rename", previous_name, APP])
        run(["docker", "start", APP])
        if not wait_health(APP, 120):
            print("WARNING: previous Dossier container did not become healthy after rollback.")
    else:
        print("WARNING: previous Dossier rollback container is missing.")
    record_failure(state, failed_sha, reason)


def verify_health(payload: dict | None, sha: str) -> bool:
    return bool(payload and payload.get("status") == "ok" and payload.get("db") == "ok"
                and payload.get("build") == sha)


def deployment_decision(candidate: str, current: str, failed: str, force: bool) -> str:
    if candidate == current:
        return "unchanged"
    if candidate == failed and not force:
        return "failed-before"
    return "deploy"


def deploy() -> int:
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(ROOT, 0o700)
    os.chmod(STATE_DIR, 0o700)
    lock_path = ROOT / "deploy.lock"
    lock_file = acquire_lock(lock_path)
    if lock_file is None:
        print("Dossier deployment skipped: another run holds the deployment lock.")
        return 0

    if not ENV_FILE.is_file() or ENV_FILE.stat().st_mode & 0o077:
        print("Dossier deployment cannot continue: protected container environment file is missing or has loose permissions.")
        return 1

    repo = ROOT / "repository.git"
    if not repo.exists():
        run(["git", "clone", "--bare", "--filter=blob:none", SOURCE_URL, str(repo)])
    run(["git", f"--git-dir={repo}", "fetch", "--quiet", "--no-tags",
         "origin", "refs/heads/main:refs/remotes/origin/main"])
    sha = run(["git", f"--git-dir={repo}", "rev-parse", "refs/remotes/origin/main"])
    if len(sha) != 40:
        print("Dossier deployment cannot continue: fetched main did not resolve to a commit.")
        return 1
    short = sha[:12]
    state = get_state()
    current_sha = state.get("current_sha", "")
    decision = deployment_decision(
        sha, current_sha, state.get("last_failed_sha", ""),
        os.environ.get("DOSSIER_DEPLOY_FORCE") == "1",
    )
    if decision == "unchanged":
        print(f"Dossier is already on main {short}.")
        return 0
    if decision == "failed-before":
        print(f"Dossier main {short} previously failed; waiting for a new commit or DOSSIER_DEPLOY_FORCE=1.")
        return 1
    if health(APP) != "healthy":
        print("Dossier deployment stopped: the current app container is missing or unhealthy.")
        return 1

    if current_sha:
        migrations = run(["git", f"--git-dir={repo}", "diff", "--name-only", current_sha, sha,
                          "--", "prisma/migrations"])
        if migrations:
            record_failure(state, sha, "database-migration-review-required")
            print(f"Dossier main {short} adds database migrations; automatic deployment stopped for manual migration review.")
            return 1

    version = json.loads(run(["git", f"--git-dir={repo}", "show", f"{sha}:package.json"]))["version"]
    built_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    image = f"{IMAGE_REPO}:{version}-{short}-{built_at.replace('-', '').replace(':', '')}"
    source = Path(tempfile.mkdtemp(prefix="source.", dir=ROOT))
    test_volume = f"dossier-deploy-test-{short}"
    test_container = f"dossier-candidate-test-{short}"
    rollback_name = f"dossier-rollback-{short}"
    cutover = False
    try:
        archive = subprocess.Popen(["git", f"--git-dir={repo}", "archive", sha], stdout=subprocess.PIPE)
        with (source / "archive.tar").open("wb") as archive_file:
            shutil.copyfileobj(archive.stdout, archive_file)
        if archive.wait() != 0:
            raise subprocess.CalledProcessError(archive.returncode, archive.args)
        run(["tar", "-xf", str(source / "archive.tar"), "-C", str(source)])
        (source / "archive.tar").unlink()
        run(["docker", "build", "--pull", "--target", "production",
             "--build-arg", f"DOSSIER_BUILD_SHA={sha}",
             "--build-arg", f"DOSSIER_BUILD_TIME={built_at}",
             "--build-arg", f"DOSSIER_VERSION={version}",
             "--label", f"org.opencontainers.image.revision={sha}",
             "--label", f"org.opencontainers.image.version={version}",
             "--label", f"org.opencontainers.image.created={built_at}",
             "--tag", image, str(source)])

        # Validate the candidate against an empty, disposable DB on no network.
        run(["docker", "volume", "create", test_volume])
        run(["docker", "run", "-d", "--name", test_container, "--env-file", str(ENV_FILE),
             "--env", f"DOSSIER_BUILD_SHA={sha}", "--env", f"DOSSIER_BUILD_TIME={built_at}",
             "--mount", f"type=volume,source={test_volume},target=/data",
             "--network", "none", image])
        if not wait_health(test_container, 180):
            record_failure(state, sha, "candidate-smoke-health")
            print("Dossier candidate failed its isolated health check; the running app was left unchanged.")
            return 1
        run(["docker", "rm", "-f", test_container])
        run(["docker", "volume", "rm", test_volume])

        # SQLite online backup is consistent while requests continue. It remains
        # in the protected dossier-data volume, alongside prior app backups.
        build_stamp = built_at.replace("-", "").replace(":", "")
        snapshot = f"/data/backups/predeploy-{short}-{build_stamp}.db"
        script = ("const Database=require('/app/tools/node_modules/better-sqlite3');"
                  "const db=new Database('/data/dossier.db');"
                  f"db.backup('{snapshot}').then(()=>db.close()).catch(e=>{{"
                  "console.error('SQLite snapshot failed:',e.message);process.exit(1)})")
        run(["docker", "exec", APP, "node", "-e", script])
        docker("exec", APP, "chmod", "600", snapshot)

        if health(APP) != "healthy":
            record_failure(state, sha, "current-container-not-healthy-before-cutover")
            print("Dossier deployment stopped because the current container is not healthy.")
            return 1
        subprocess.run(["docker", "rm", "-f", rollback_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        old_rollback = state.get("previous_container")
        run(["docker", "stop", "--time", "30", APP])
        run(["docker", "rename", APP, rollback_name])
        cutover = True
        run(["docker", "network", "disconnect", NETWORK, rollback_name])
        run(["docker", "run", "-d", "--name", APP, "--restart", "unless-stopped",
             "--env-file", str(ENV_FILE), "--mount", f"type=volume,source={VOLUME},target=/data",
             "--publish", "127.0.0.1:3002:3000", "--network", NETWORK,
             "--network-alias", "dossier-app", image])

        if not wait_health(APP, 180):
            restore(rollback_name, sha, state, "replacement-health-check")
            cutover = False
            return 1
        if not verify_health(read_json_health("http://127.0.0.1:3002/api/health"), sha):
            restore(rollback_name, sha, state, "local-health-metadata")
            cutover = False
            return 1

        public_ok = False
        for _ in range(12):
            if verify_health(read_json_health(PUBLIC_HEALTH), sha):
                public_ok = True
                break
            time.sleep(5)
        if not public_ok:
            restore(rollback_name, sha, state, "public-health-check")
            cutover = False
            return 1

        state.update(current_sha=sha, image=image, deployed_at=built_at, previous_container=rollback_name)
        state.pop("last_failed_sha", None)
        state.pop("last_failure", None)
        save_state(state)
        cutover = False
        if old_rollback and old_rollback != rollback_name:
            subprocess.run(["docker", "rm", "-f", old_rollback],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"Dossier deployed main {short} as {image}; local and public health checks passed.")
        return 0
    except subprocess.CalledProcessError as error:
        print(f"Dossier deployment command failed ({error.cmd[0]} exit {error.returncode}).")
        if cutover:
            restore(rollback_name, sha, state, "cutover-command-failure")
            cutover = False
        else:
            record_failure(state, sha, "build-or-preflight-failure")
        return 1
    finally:
        subprocess.run(["docker", "rm", "-f", test_container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "volume", "rm", test_volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(source, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(deploy())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Dossier deployment stopped: {error}")
        raise SystemExit(1)
