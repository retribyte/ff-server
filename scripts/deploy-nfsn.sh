#!/usr/bin/env bash
# Build ff-server on this (Linux) machine and upload it to the NearlyFreeSpeech
# host. Prisma's CLI can't run on FreeBSD, so the client is generated here and
# copied over; everything the server runs is plain JS + wasm.
#
#   scripts/deploy-nfsn.sh            build, back up + run pending SQL, upload, install deps
#
# It ends by restarting the "ffserver" daemon (the host's `nfsn` CLI) and waiting
# until the daemon answers again (~5 s of downtime), then has the host read from
# the database through it.
#
# On the host (see docs/deploy-nfsn.md):
#   /home/protected/ff-server/   dist/, package*.json, node_modules/, REVISION
#                                plus .env and run.sh, which this never touches
# Env: NFSN_SSH (user@host), NFSN_KEY (ssh key path) override the defaults.
set -euo pipefail

SSH_TARGET="${NFSN_SSH:-retri_vortox@ssh.nyc1.nearlyfreespeech.net}"
KEY="${NFSN_KEY:-$HOME/.ssh/booru}"
DEST=/home/protected/ff-server
SSH_OPTS="-i $KEY -o IdentitiesOnly=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"
# shellcheck disable=SC2206 # the options are meant to split
SSH=(ssh $SSH_OPTS "$SSH_TARGET")
RSYNC_SSH="ssh $SSH_OPTS"
JOBS=/home/private/jobs

# run_job <name> <max polls>, job script on stdin: run it on the daemon machine
# (the jobs queue; SSH can't reach Postgres or the daemons) and print its log.
# Returns 0 if the job exited 0, 1 if it failed, 2 if it never finished.
run_job() {
    local job="$1" polls="$2" status=""
    "${SSH[@]}" "cat > $JOBS/$job.tmp && mv $JOBS/$job.tmp $JOBS/$job.sh" || return 2  # .tmp, then rename: the runner only picks up complete *.sh files
    for _ in $(seq 1 "$polls"); do
        sleep 3
        status="$("${SSH[@]}" "tail -1 $JOBS/done/$job.*.log 2>/dev/null" < /dev/null || true)"
        case "$status" in "== exit"*) break ;; esac
    done
    # nobody will log in to read it, so always put the job's log in the output
    "${SSH[@]}" "cat $JOBS/done/$job.*.log 2>/dev/null" < /dev/null || true
    case "$status" in
        "== exit 0"*) return 0 ;;
        "== exit"*) return 1 ;;
    esac
    # still queued: don't let it run later with nobody watching (a running job has left this path)
    "${SSH[@]}" "rm -f $JOBS/$job.sh" < /dev/null || true
    return 2
}

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
# Pending SQL from prisma/prod-sql/ runs on the host, as `me`, BEFORE the new code
# goes up, after a dump of the database (the last 3 are kept). If a file fails we
# stop here with the old code still live. That file rolled back; any file before it
# stays applied, which the old code tolerates since migrations stay backward-compatible.
SQL_DIR=/home/private/prod-sql
"${SSH[@]}" "mkdir -p $SQL_DIR/files"
rsync -a --delete --include='*.sql' --exclude='*' -e "$RSYNC_SSH" prisma/prod-sql/ "$SSH_TARGET:$SQL_DIR/files/"
rsync -a -e "$RSYNC_SSH" scripts/apply-prod-sql.sh "$SSH_TARGET:$SQL_DIR/"
JOB="migrate-$(date -u +%Y%m%d%H%M%S)-$REVISION"
rc=0
run_job "$JOB" 200 <<JOBEOF || rc=$?  # the job starts within ~5 s; allow ~10 min
set -e
umask 077
export PGHOST=/home/protected/pgsock PGUSER=ff PGDATABASE=ff PGPASSWORD="\$(cat /home/private/ff-db.pw)"
pending="\$(sh $SQL_DIR/apply-prod-sql.sh --pending $SQL_DIR/files)"
if [ -n "\$pending" ]; then
    mkdir -p $SQL_DIR/backups
    pg_dump -Fc -f $SQL_DIR/backups/$JOB.tmp
    mv $SQL_DIR/backups/$JOB.tmp $SQL_DIR/backups/$JOB.dump
    echo "== backup: $SQL_DIR/backups/$JOB.dump"
    ls -1t $SQL_DIR/backups/*.dump | tail -n +4 | xargs rm -f
fi
sh $SQL_DIR/apply-prod-sql.sh $SQL_DIR/files
JOBEOF
case "$rc" in
    0) ;;
    1) echo "migration job failed; NOT deploying. Prod is still on the previous code. See \"When a migration fails\" in docs/deploy-nfsn.md." >&2; exit 1 ;;
    *) echo "migration job never finished (is the jobs daemon running?); NOT deploying" >&2; exit 1 ;;
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
# Is the daemon up? Ask through the NFSN name, which skips Cloudflare (its bot checks
# challenge CI runners). The app answers there with a 308 to CANONICAL_HOST (or a
# 200 if that's unset); a daemon that is down gives Apache's 502/503 instead.
HEALTH_URL="${HEALTH_URL:-https://vortox.nfshost.com/api/register}"
code=000
up=0
for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$HEALTH_URL" || true)"
    case "$code" in 200|308) up=1; break ;; esac
    sleep 2
done
if [ "$up" != 1 ]; then
    echo "deployed $REVISION, but $HEALTH_URL answered $code (want 308); check /home/logs/daemon_ffserver.log" >&2
    exit 1
fi

# That 308 comes from the first middleware, before any route or query. Do the new
# code and the migrated schema work together? Loopback from the daemon machine
# skips the redirect, and these routes read the database.
echo "== check database reads"
rc=0
run_job "health-$(date -u +%Y%m%d%H%M%S)-$REVISION" 40 <<'JOBEOF' || rc=$?
fail=0
for path in /api/seasons '/api/characters?limit=1' '/api/stories?limit=1'; do
    code="$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "http://127.0.0.1:41730$path" || true)"
    echo "$path -> $code"
    [ "$code" = 200 ] || fail=1
done
exit $fail
JOBEOF
case "$rc" in
    0) echo "== deployed $REVISION, live" ;;
    1) echo "$REVISION IS LIVE, but reads through it failed; check /home/logs/daemon_ffserver.log" >&2; exit 1 ;;
    *) echo "$REVISION is up, but its database reads went unchecked (is the jobs daemon running?)" >&2; exit 1 ;;
esac
