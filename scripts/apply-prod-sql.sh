#!/bin/sh
# Apply the pending SQL files in a directory to a Postgres database, once each.
#
#   apply-prod-sql.sh <dir>             apply what's pending
#   apply-prod-sql.sh --pending <dir>   only run the checks and list what's pending
#
# Connection via the usual PG* environment. Plain POSIX sh + psql, so the same
# file runs on the NFSN host (FreeBSD, over the jobs queue), in CI against a
# scratch database, and on a dev machine.
#
# - Files are *.sql, applied in filename order (byte order). Name them
#   YYYYMMDDHHMM_what-it-does.sql so the order is the order they were written.
# - Applied files are recorded in table _sql_migrations (created on first run)
#   with their sha256. Each file and its record go in ONE transaction, so a
#   failed file changes nothing and is retried next time.
# - A pending file with its own BEGIN/COMMIT is an error, and nothing runs: its
#   COMMIT would end that transaction, leaving a half-applied file on failure.
# - An applied file that was edited afterwards is an error, and nothing runs:
#   fix forward with a new file instead.
# - A recorded file that's gone from the directory only warns: re-running an
#   older deploy (a rollback) legitimately has fewer files.
# - Statements that can't run in a transaction (CREATE INDEX CONCURRENTLY,
#   CREATE DATABASE, ...) are not supported here.
set -eu
PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"; export PGOPTIONS

MODE=apply
if [ "${1:-}" = "--pending" ]; then
    MODE=pending
    shift
fi
DIR="${1:?usage: apply-prod-sql.sh [--pending] <dir>}"
[ -d "$DIR" ] || { echo "no such directory: $DIR" >&2; exit 1; }

hash_of() {
    if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
    elif command -v sha256 > /dev/null 2>&1; then sha256 -q "$1"
    else shasum -a 256 "$1" | cut -d' ' -f1
    fi
}

# The semicolon matters: plpgsql's block BEGIN has none, and neither does the
# END that closes it (END isn't listed for that reason, though it means COMMIT).
has_transaction_control() {
    sed 's/--.*$//' "$1" | LC_ALL=C grep -Eiq \
        '(^|;)[[:space:]]*(begin|commit|rollback|abort|start[[:space:]]+transaction)([[:space:]]+(work|transaction))?[[:space:]]*;'
}

run_sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

run_sql -c 'CREATE TABLE IF NOT EXISTS _sql_migrations (
    filename   text PRIMARY KEY,
    sha256     text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)'

applied="$(psql -X -At -v ON_ERROR_STOP=1 -F ' ' -c 'SELECT filename, sha256 FROM _sql_migrations')"

files="$(cd "$DIR" && LC_ALL=C ls -1 | LC_ALL=C grep '\.sql$' | LC_ALL=C sort || true)"

# Split the lists below on newlines only, so a name with a space reaches the check
IFS='
'

# Pass 1: check everything before running anything
pending=""
for name in $files; do
    case "$name" in
        *[!0-9A-Za-z._-]*) echo "bad file name (letters, digits, . _ - only): $name" >&2; exit 1 ;;
    esac
    sum="$(hash_of "$DIR/$name")"
    old="$(printf '%s\n' "$applied" | awk -v n="$name" '$1 == n { print $2 }')"
    if [ -n "$old" ]; then
        if [ "$old" != "$sum" ]; then
            echo "$name was already applied but has changed since (recorded $old, now $sum)." >&2
            echo "Applied migrations are immutable: put the fix in a new file." >&2
            exit 1
        fi
    else
        if has_transaction_control "$DIR/$name"; then
            echo "$name has its own BEGIN/COMMIT. Remove those lines: Prisma generates them" >&2
            echo "for enum changes, but the whole file already runs in one transaction." >&2
            exit 1
        fi
        pending="$pending$name
"
    fi
done

if [ "$MODE" = pending ]; then
    for name in $pending; do echo "$name"; done
    exit 0
fi

printf '%s\n' "$applied" | while IFS=' ' read -r name _; do
    if [ -n "$name" ] && [ ! -e "$DIR/$name" ]; then
        echo "WARNING: $name is recorded as applied, but the file is gone. Its changes are still in the database." >&2
    fi
done

# Pass 2: apply what's pending
n_applied=0
for name in $pending; do
    sum="$(hash_of "$DIR/$name")"
    echo "== applying $name ($sum)"
    run_sql --single-transaction -f "$DIR/$name" \
        -c "INSERT INTO _sql_migrations (filename, sha256) VALUES ('$name', '$sum')"
    n_applied=$((n_applied + 1))
done

n_files=0
for name in $files; do n_files=$((n_files + 1)); done
echo "== sql migrations: $n_applied applied, $((n_files - n_applied)) already applied"
