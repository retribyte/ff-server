#!/usr/bin/env bash
# PR check: flag what the scratch database in verify-schema-sql.sh can't show,
# because it has no rows. No database needed.
#
#   scripts/lint-prod-sql.sh <file.sql>...
#
# ERRORS need a person to look: statements that lose data, and ADD COLUMN ... NOT
# NULL without a DEFAULT, which fails on any table with rows and then blocks every
# deploy until it's recovered (docs/deploy-nfsn.md, "When a migration fails"). A
# file passes once it has a comment saying why it's fine:
#
#   -- reviewed: the column was only ever written by the retired importer
#
# WARNINGS never fail: statements that may or may not hold for the existing rows.
#
# Line-based on purpose, which suits what `prisma migrate diff` generates. It's a
# prompt for the reviewer, not a parser.
set -euo pipefail

status=0
report() { # report <error|warning> <file> <line number:text> <why>
    local line="${3%%:*}" text="${3#*:}"
    echo "::$1 file=$2,line=$line::$4: ${text#"${text%%[![:space:]]*}"}"
}
matches() { # matches <file> <regex>: "number:text" per matching line, comments stripped
    # (and the DROPs that only remove a property of a column, which lose no data)
    sed -E -e 's/--.*$//' -e 's/\bdrop[[:space:]]+(default|identity|expression)\b//Ig' "$1" | grep -Ein "$2" || true
}

for f in "$@"; do
    if ! grep -Eiq '^[[:space:]]*--[[:space:]]*reviewed:[[:space:]]*[^[:space:]]' "$f"; then
        reviewed=0
    else
        reviewed=1
    fi
    level=error
    [ "$reviewed" = 1 ] && level=warning

    while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        report "$level" "$f" "$hit" "Loses data"
        [ "$reviewed" = 1 ] || status=1
    done < <(matches "$f" '\bdrop[[:space:]]+(table|column|schema|type|view|materialized|"|[a-z_]+[[:space:]]*(,|;|$))|\btruncate\b|(^|;)[[:space:]]*(delete[[:space:]]+from|update[[:space:]])|\balter[[:space:]]+column\b.*\btype\b')

    while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        case "${hit,,}" in *default*) continue ;; esac
        report "$level" "$f" "$hit" "NOT NULL without DEFAULT fails on a table with rows"
        [ "$reviewed" = 1 ] || status=1
    done < <(matches "$f" '\badd[[:space:]]+column\b.*\bnot[[:space:]]+null\b')

    while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        report warning "$f" "$hit" "May fail on existing rows (the scratch database has none)"
    done < <(matches "$f" '\bset[[:space:]]+not[[:space:]]+null\b|\bcreate[[:space:]]+unique[[:space:]]+index\b|\badd[[:space:]]+constraint\b.*\b(unique|foreign[[:space:]]+key|check)\b')
done

if [ "$status" != 0 ]; then
    echo "::error::Check the lines above against production data. If they're fine, add a '-- reviewed: why' comment to the file." >&2
fi
exit "$status"
