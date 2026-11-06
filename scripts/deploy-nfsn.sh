#!/usr/bin/env bash
# Build ff-server on this (Linux) machine and upload it to the NearlyFreeSpeech
# host. Prisma's CLI can't run on FreeBSD, so the client is generated here and
# copied over; everything the server runs is plain JS + wasm.
#
#   scripts/deploy-nfsn.sh            build, run pending SQL, upload, install deps
#
# It ends by restarting the "ffserver" daemon (the host's `nfsn` CLI) and waiting
# until the daemon answers again (~5 s of downtime).
#
# On the host (see docs/deploy-nfsn.md):
#   /home/protected/ff-server/   dist/, package*.json, node_modules/, REVISION
#                                plus .env and run.sh, which this never touches
# Env: NFSN_SSH (user@host), NFSN_KEY (ssh key path) override the defaults.
set -euo pipefail

SSH_TARGET="${NFSN_SSH:-retri_vortox@ssh.nyc1.nearlyfreespeech.net}"
KEY="${NFSN_KEY:-$HOME/.ssh/booru}"
DEST=/home/protected/ff-server
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes "$SSH_TARGET")
RSYNC_SSH="ssh -i $KEY -o IdentitiesOnly=yes"

cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
    echo "ff-server has uncommitted changes; commit them first so REVISION means something" >&2
    exit 1
fi
REVISION="$(git rev-parse --short HEAD)"

echo "== build $REVISION"
npm ci --no-audit --no-fund
npx prisma generate
rm -rf dist
npx tsc

echo "== database migrations"
# Pending SQL from prisma/prod-sql/ runs on the host (through the jobs queue, as
# `me`: SSH can't reach Postgres) BEFORE the new code goes up. If it fails we stop
# here, with the old code still live against the old schema (each file runs in a
# transaction that rolled back).
SQL_DIR=/home/private/prod-sql
"${SSH[@]}" "mkdir -p $SQL_DIR/files"
rsync -a --delete --include='*.sql' --exclude='*' -e "$RSYNC_SSH" prisma/prod-sql/ "$SSH_TARGET:$SQL_DIR/files/"
rsync -a -e "$RSYNC_SSH" scripts/apply-prod-sql.sh "$SSH_TARGET:$SQL_DIR/"
JOB="migrate-$(date -u +%Y%m%d%H%M%S)-$REVISION"
# (write .tmp, then rename: the job runner only picks up complete *.sh files)
"${SSH[@]}" "cat > /home/private/jobs/$JOB.tmp && mv /home/private/jobs/$JOB.tmp /home/private/jobs/$JOB.sh" <<JOBEOF || { echo "couldn't queue the migration job" >&2; exit 1; }
set -e
export PGHOST=/home/protected/pgsock PGUSER=ff PGDATABASE=ff PGPASSWORD="\$(cat /home/private/ff-db.pw)"
sh $SQL_DIR/apply-prod-sql.sh $SQL_DIR/files
JOBEOF
status=""
for _ in $(seq 1 200); do      # the job starts within ~5 s; allow ~10 min
    sleep 3
    status="$("${SSH[@]}" "tail -1 /home/private/jobs/done/$JOB.*.log 2>/dev/null" || true)"
    case "$status" in "== exit"*) break ;; esac
done
# nobody will log in to read it, so always put the job's log in the output
"${SSH[@]}" "cat /home/private/jobs/done/$JOB.*.log 2>/dev/null" || true
case "$status" in
    "== exit 0"*) ;;
    "") echo "migration job never finished (is the jobs daemon running?); NOT deploying" >&2; exit 1 ;;
    *) echo "migration job failed ($status); NOT deploying. Prod is still on the previous code." >&2; exit 1 ;;
esac

echo "== upload"
"${SSH[@]}" "mkdir -p $DEST"
rsync -a --delete -e "$RSYNC_SSH" dist package.json package-lock.json "$SSH_TARGET:$DEST/"

# Reinstall dependencies only when the lockfile changed. --ignore-scripts:
# Prisma's install hooks would try (and fail) to fetch FreeBSD engines.
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
"${SSH[@]}" "cd $DEST && if [ \"\$(cat node_modules/.lock-hash 2>/dev/null)\" != '$LOCK_HASH' ]; then
    echo '== npm ci on host (lockfile changed)'
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund && echo '$LOCK_HASH' > node_modules/.lock-hash
else
    echo '== dependencies unchanged'
fi"

# The generated client (npm ci on the host wipes it, so always copy)
rsync -a --delete -e "$RSYNC_SSH" node_modules/.prisma/ "$SSH_TARGET:$DEST/node_modules/.prisma/"
"${SSH[@]}" "echo $REVISION > $DEST/REVISION"
# New files take the uploader's group here, not the directory's; the daemon
# runs as web and needs group read
"${SSH[@]}" "chgrp -R web $DEST && chmod -R g+rX,o-rwx $DEST"

echo "== restart ffserver"
"${SSH[@]}" "nfsn stop-daemon ffserver > /dev/null; sleep 2; nfsn start-daemon ffserver > /dev/null"
# Check the daemon through the NFSN name, which skips Cloudflare (its bot checks
# challenge CI runners). The app answers there with a 308 to CANONICAL_HOST (or a
# 200 if that's unset); a daemon that is down gives Apache's 502/503 instead.
HEALTH_URL="${HEALTH_URL:-https://vortox.nfshost.com/api/register}"
code=000
for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL")"
    case "$code" in 200|308) echo "== deployed $REVISION, live"; exit 0;; esac
    sleep 2
done
echo "deployed $REVISION, but $HEALTH_URL answered $code (want 308); check /home/logs/daemon_ffserver.log" >&2
exit 1
