#!/usr/bin/env bash
# Build the complete production database locally, then dump it for the NFSN
# host (restore it there with a pg_restore job; see docs/deploy-nfsn.md).
#
#   scripts/build-prod-db.sh <ff-site checkout>
#
# The ff-site checkout should be a clean worktree at the commit to ship: its
# archive-to-markdown/api/ build folder is deleted and rebuilt (md-to-api.py
# --all), because seed-legacy reads every file there and stale ones break it.
#
# Steps, all against a scratch database "ff_prod" in the local docker Postgres
# (dropped and recreated; dev is never touched):
#   1. db push + the full seed (fails fast)
#   2. refresh the wiki cache from wiki.vortox.space
#   3. upload every manuscript in md/stories/ as the admin, through a local
#      ff-server on :3099 (admins aren't auto-added as authors; the
#      manuscripts' own authors: lines are credited)
#   4. give each admin account a random password (written to a private file
#      in $HOME, mode 600) and keep mustChangePassword; players keep the
#      hands-off default (src/user/default-password.ts)
#   5. pg_dump -Fc into backups/ (git-ignored; holds account data)
set -euo pipefail

FF_SITE="$(realpath "${1:?usage: scripts/build-prod-db.sh <ff-site checkout>}")"
cd "$(dirname "$0")/.."
FF_SERVER="$PWD"
FF_SITE_OLD="${FF_SITE_OLD_DIR:-$(realpath "$FF_SERVER/../ff-site-old")}"
DB=ff_prod
PORT=3099
STAMP="$(date +%F)"
OUT="backups/prod-$STAMP.dump"
PW_FILE="$HOME/ff-prod-admin-passwords-$STAMP.txt"
CONTAINER=ff-server-db-1

DEV_URL="$(grep '^DATABASE_URL=' .env | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
PG_USER="$(echo "$DEV_URL" | sed -E 's|^postgresql://([^:]+):.*|\1|')"
PROD_URL="$(echo "$DEV_URL" | sed -E "s|/[^/?]+\?|/$DB?|")"
case "$PROD_URL" in *"/$DB?"*) ;; *) echo "couldn't derive the $DB URL from .env" >&2; exit 1 ;; esac
mkdir -p backups
git check-ignore -q "$OUT" || { echo "$OUT isn't git-ignored; refusing to write account data there" >&2; exit 1; }
psql_db() { docker exec -i "$CONTAINER" psql -U "$PG_USER" -d "$DB" -v ON_ERROR_STOP=1 -AtX "$@"; }

echo "== 0. episode JSON from $FF_SITE ($(git -C "$FF_SITE" rev-parse --short HEAD))"
rm -rf "$FF_SITE/archive-to-markdown/api"
(cd "$FF_SITE/archive-to-markdown" && python3 md-to-api.py --all > /dev/null)
echo "   $(find "$FF_SITE/archive-to-markdown/api" -name '*.json' | wc -l) episode files"

echo "== 1. fresh $DB: schema + seed"
docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
DATABASE_URL="$PROD_URL" npx prisma db push --skip-generate > /dev/null
DATABASE_URL="$PROD_URL" FF_SITE_DIR="$FF_SITE" FF_SITE_OLD_DIR="$FF_SITE_OLD" npm run -s seed > "backups/prod-$STAMP-seed.log" 2>&1 \
    || { echo "seed failed; see backups/prod-$STAMP-seed.log" >&2; exit 1; }

echo "== 2. wiki cache"
DATABASE_URL="$PROD_URL" npm run -s refresh:wiki-cache | tail -2

echo "== 3. stories"
ADMIN="$(psql_db -c "SELECT username FROM \"User\" WHERE role = 'ADMIN' ORDER BY id LIMIT 1")"
ADMIN_DEFAULT="$(npx tsx -e "import { defaultPassword } from './src/user/default-password.ts'; console.log(defaultPassword(process.argv[1]))" "$ADMIN")"
# The upload logs in with the seeded default, so lift the forced change for now
psql_db -c "UPDATE \"User\" SET \"mustChangePassword\" = false WHERE username = '$ADMIN'" > /dev/null
DATABASE_URL="$PROD_URL" PORT=$PORT HOST=127.0.0.1 npx tsx src/server.ts > "backups/prod-$STAMP-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/api/register" && break; sleep 1; done
: > "backups/prod-$STAMP-upload.log"
FAILED=()
for manuscript in "$FF_SITE"/archive-to-markdown/md/stories/*.md; do
    if FF_USERNAME="$ADMIN" FF_PASSWORD="$ADMIN_DEFAULT" python3 "$FF_SITE/archive-to-markdown/story-md-to-api.py" \
        "$manuscript" --upload --api "http://127.0.0.1:$PORT/api" >> "backups/prod-$STAMP-upload.log" 2>&1; then
        echo "   ok    $(basename "$manuscript")"
    else
        echo "   FAIL  $(basename "$manuscript"): $(tail -1 "backups/prod-$STAMP-upload.log")"
        FAILED+=("$(basename "$manuscript")")
    fi
done
kill $SERVER_PID; trap - EXIT
[ ${#FAILED[@]} -eq 0 ] || { echo "story uploads failed: ${FAILED[*]}" >&2; exit 1; }
DATABASE_URL="$PROD_URL" npm run -s backfill:story-hashes | tail -1

echo "== 4. admin passwords"
umask 077
: > "$PW_FILE"
for admin in $(psql_db -c "SELECT username FROM \"User\" WHERE role = 'ADMIN' ORDER BY id"); do
    PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
    HASH="$(npx tsx -e "import { hashSync } from 'bcryptjs'; console.log(hashSync(process.argv[1], 12))" "$PW")"
    psql_db -c "UPDATE \"User\" SET password = '$HASH', \"mustChangePassword\" = true, \"passwordChangedAt\" = now() WHERE username = '$admin'" > /dev/null
    echo "$admin  $PW" >> "$PW_FILE"
done
echo "   written to $PW_FILE"

echo "== 5. dump"
docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$DB" -Fc --no-owner --no-privileges > "$OUT"
psql_db -c "SELECT 'users ' || (SELECT count(*) FROM \"User\") || ', characters ' || (SELECT count(*) FROM characters)
    || ', episodes ' || (SELECT count(*) FROM episodes) || ', messages ' || (SELECT count(*) FROM messages)
    || ', stories ' || (SELECT count(*) FROM stories) || ', wiki_cache ' || (SELECT count(*) FROM wiki_cache)"
echo "== done: $OUT ($(du -h "$OUT" | cut -f1))"
