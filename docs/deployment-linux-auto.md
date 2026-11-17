# Linux automatic deployment

The Linux host checks the SaahiilM/dossier GitHub main branch every two
minutes with a systemd user timer. It fetches Git refs only; it does not use
GitHub webhooks, a public listener, or a privileged hosted runner. Candidate
images are built from a fresh archive of the exact fetched commit, tagged with
the package version, full commit prefix, and UTC build time, and labeled with
the full source revision.

Install or refresh the user service from this checkout with:

    bash scripts/install-linux-main-deploy.sh

The installer preserves the current container's full environment in a mode
0600 file outside the repository and does not print it. The updater retains
dossier-data, DOSSIER_SUBSCRIPTION_LOOPBACK, the localhost-only port, the
simfin_backend network alias, and the unless-stopped restart policy.
ChatGPT sign-in files under /data/siwc remain in the same volume.

Before cutover, the updater:

1. Skips a commit that is already deployed and refuses to retry a failed SHA
   until main changes or DOSSIER_DEPLOY_FORCE=1 is set for a manual retry.
2. Stops for manual migration review if the commit changes prisma/migrations.
   Do not remove this guard without a reviewed schema and rollback plan.
3. Builds and health-checks the candidate with a disposable SQLite volume and
   isolated network, then takes a consistent SQLite online backup.
4. Stops the old instance before starting the new one, so only one process can
   own the production SQLite database and its in-process schedules.
5. Verifies local and public health, including the exact deployed revision.
   On failure it restores the old container. On success the old container and
   image remain available as the rollback target.

Build metadata appears in Settings → About as Version, Build, and Built,
and in /api/health as version, build, and builtAt. The package semver remains
the product version; the commit SHA and build time uniquely identify each
deployment.

Inspect or manually run the service:

    systemctl --user status dossier-auto-deploy.timer dossier-auto-deploy.service
    journalctl --user -u dossier-auto-deploy.service
    systemctl --user start dossier-auto-deploy.service

The state ledger lives at
~/.local/share/dossier-auto-deploy/state/deploy.json; runtime environment
secrets live at ~/.config/dossier-auto-deploy/container.env. Both are outside
the git checkout and protected by private directory/file permissions.
