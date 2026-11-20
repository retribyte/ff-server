#!/usr/bin/env bash
# Build ff-server and deploy it on THIS machine: the home server, where the
# self-hosted GitHub Actions runner runs it (see docs/migrate-home-server.md).
# The NFSN equivalent is scripts/deploy-nfsn.sh, kept for failover.
#
#   scripts/deploy-local.sh     build, back up + run pending SQL, install, restart
#
# Run it as a member of group `ff` (the `runner` user) from a clean checkout. It
# needs sudo for exactly `systemctl restart ffserver` (a sudoers drop-in).
#
# On the host:
#   /srv/ff/ff-server/   dist/, package*.json, node_modules/, REVISION
#                        plus .env and run.sh, which this never touches
#   /srv/ff/prod-sql/    files/ + the applier (copies), backups/ (last 3 dumps)
#   /srv/ff/ff-db.pw     role ff's password (group ff readable)
# Env: FF_ROOT (default /srv/ff) overrides the base directory.
set -euo pipefail
umask 027   # group ff (the service) reads what we write; nobody else does

FF_ROOT="${FF_ROOT:-/srv/ff}"
DEST="$FF_ROOT/ff-server"
SQL_DIR="$FF_ROOT/prod-sql"
PORT=41730

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
node scripts/write-version.mjs   # dist/version.json (version from the release tags)

echo "== database migrations"
# Pending SQL from prisma/prod-sql/ runs BEFORE the new code goes in, after a dump
# of the database (the last 3 are kept). If a file fails we stop here with the old
# code still live. That file rolled back; any file before it stays applied, which
# the old code tolerates since migrations stay backward-compatible.
export PGHOST=/var/run/postgresql PGUSER=ff PGDATABASE=ff
PGPASSWORD="$(cat "$FF_ROOT/ff-db.pw")"; export PGPASSWORD
mkdir -p "$SQL_DIR/files" "$SQL_DIR/backups"
rsync -rt --delete --include='*.sql' --exclude='*' prisma/prod-sql/ "$SQL_DIR/files/"
cp scripts/apply-prod-sql.sh "$SQL_DIR/"
pending="$(sh "$SQL_DIR/apply-prod-sql.sh" --pending "$SQL_DIR/files")"
if [ -n "$pending" ]; then
    BACKUP="$SQL_DIR/backups/migrate-$(date -u +%Y%m%d%H%M%S)-$REVISION"
    pg_dump -Fc -f "$BACKUP.tmp"
    mv "$BACKUP.tmp" "$BACKUP.dump"
    echo "== backup: $BACKUP.dump"
    ls -1t "$SQL_DIR"/backups/*.dump | tail -n +4 | xargs -r rm -f --
fi
if ! sh "$SQL_DIR/apply-prod-sql.sh" "$SQL_DIR/files"; then
    echo "migration failed; NOT deploying. Prod is still on the previous code. See \"When a migration fails\" in docs/deploy-nfsn.md." >&2
    exit 1
fi

echo "== install"
# Only the named entries are mirrored, so .env and run.sh next to them stay put.
rsync -rlpt --delete --chmod=D2750,F640 dist package.json package-lock.json "$DEST/"

# Reinstall dependencies only when the lockfile changed. --ignore-scripts: the
# generated client is copied in below, as on NFSN.
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat "$DEST/node_modules/.lock-hash" 2>/dev/null)" != "$LOCK_HASH" ]; then
    echo "== npm ci --omit=dev (lockfile changed)"
    (cd "$DEST" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && echo "$LOCK_HASH" > node_modules/.lock-hash)
else
    echo "== dependencies unchanged"
fi
# The generated client (npm ci wipes it, so always copy)
rsync -rlpt --delete --chmod=D2750,F640 node_modules/.prisma/ "$DEST/node_modules/.prisma/"
echo "$REVISION" > "$DEST/REVISION"

echo "== restart ffserver"
sudo -n systemctl restart ffserver
# Straight to loopback: no Cloudflare in the way, and no canonical-host redirect
# (that only fires for *.nfshost.com and www. names).
code=000
up=0
for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "http://127.0.0.1:$PORT/api/register" || true)"
    [ "$code" = 200 ] && { up=1; break; }
    sleep 2
done
if [ "$up" != 1 ]; then
    echo "deployed $REVISION, but /api/register answered $code; check: journalctl -u ffserver -n 50" >&2
    exit 1
fi

# Do the new code and the migrated schema work together? These routes read the database.
echo "== check database reads"
fail=0
for path in /api/seasons '/api/characters?limit=1' '/api/stories?limit=1'; do
    code="$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "http://127.0.0.1:$PORT$path" || true)"
    echo "$path -> $code"
    [ "$code" = 200 ] || fail=1
done
if [ "$fail" != 0 ]; then
    echo "$REVISION IS LIVE, but reads through it failed; check: journalctl -u ffserver -n 50" >&2
    exit 1
fi
echo "== deployed $REVISION, live"
