#!/usr/bin/env bash
# PR check: prove that the SQL in prisma/prod-sql/ turns the schema as it was on
# the base branch into the schema in this branch. No production access involved.
#
#   scripts/verify-schema-sql.sh origin/main
#
# Needs a Postgres you may create databases in, via PGHOST / PGUSER / PGPASSWORD
# (and PGPORT if not 5432), plus `npm ci` done. It makes a scratch database
# (ff_schema_verify, dropped and recreated), so never point it at real data.
#
# Steps: lint the new SQL (scripts/lint-prod-sql.sh), db push the BASE
# schema.prisma into the scratch DB and add the hand-written triggers and indexes
# (what prod looks like before this PR), apply only the SQL files this PR adds
# with the same applier the deploy uses, check those triggers and indexes survived,
# then `prisma migrate diff` that database against this branch's schema.prisma:
# anything left over means the SQL is missing or wrong.
#
# The scratch DB has no rows, so this can't prove the SQL works on real data. See
# "Schema changes" in docs/deploy-nfsn.md.
set -euo pipefail

BASE="${1:?usage: verify-schema-sql.sh <base ref, e.g. origin/main>}"
cd "$(dirname "$0")/.."

SQL_GLOB='prisma/prod-sql/*.sql'
added="$(git diff --name-only --diff-filter=A "$BASE"...HEAD -- "$SQL_GLOB")"
changed="$(git diff --name-only --diff-filter=MDR "$BASE"...HEAD -- "$SQL_GLOB")"
if git diff --quiet "$BASE"...HEAD -- prisma/schema.prisma; then schema_changed=0; else schema_changed=1; fi

if [ -n "$changed" ]; then
    echo "::error::Merged migrations can't be changed or removed. These were:" >&2
    echo "$changed" >&2
    echo "Add a new file instead. A merged file that FAILED on prod needs the recovery in docs/deploy-nfsn.md, \"When a migration fails\"." >&2
    exit 1
fi
if [ "$schema_changed" = 0 ] && [ -z "$added" ]; then
    echo "No schema change and no new SQL: nothing to verify."
    exit 0
fi

if bad="$(printf '%s\n' "$added" | grep -Ev '^(prisma/prod-sql/[0-9A-Za-z._-]+\.sql)?$')"; then
    echo "::error::Bad SQL file name (letters, digits, . _ - only):" >&2
    echo "$bad" >&2
    exit 1
fi

if [ -n "$added" ]; then
    echo "== lint"
    # shellcheck disable=SC2086 # names checked above
    scripts/lint-prod-sql.sh $added
fi

TMP="$(mktemp -d)"
BASE_TRIGGERS=prisma/scripts/.verify-base-create-triggers.ts
BASE_INDEXES=prisma/scripts/.verify-base-create-search-indexes.ts
trap 'rm -rf "$TMP" "$BASE_TRIGGERS" "$BASE_INDEXES"' EXIT
SCRATCH=ff_schema_verify
export DATABASE_URL="postgresql://${PGUSER:?}:${PGPASSWORD:?}@${PGHOST:?}:${PGPORT:-5432}/$SCRATCH"

psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"

echo "== base schema ($BASE) -> scratch database"
git show "$BASE:prisma/schema.prisma" > "$TMP/base.prisma"
npx prisma db push --schema "$TMP/base.prisma" --skip-generate > "$TMP/push.log" 2>&1 || { cat "$TMP/push.log"; exit 1; }

# Triggers and indexes that schema.prisma can't express, also as of the base branch
snapshot_objects() {
    psql -X -At -d "$SCRATCH" -v ON_ERROR_STOP=1 -c "
        SELECT 'index ' || indexname FROM pg_indexes WHERE schemaname = 'public'
        UNION ALL SELECT 'trigger ' || tgname FROM pg_trigger WHERE NOT tgisinternal" | LC_ALL=C sort
}
snapshot_objects > "$TMP/objects-prisma"
git show "$BASE:prisma/scripts/create-triggers.ts" > "$BASE_TRIGGERS"
git show "$BASE:prisma/scripts/create-search-indexes.ts" > "$BASE_INDEXES"
npx prisma generate > "$TMP/generate.log" 2>&1 || { cat "$TMP/generate.log"; exit 1; }
npx tsx "$BASE_TRIGGERS" > "$TMP/objects.log" 2>&1 || { cat "$TMP/objects.log"; exit 1; }
npx tsx "$BASE_INDEXES" >> "$TMP/objects.log" 2>&1 || { cat "$TMP/objects.log"; exit 1; }
snapshot_objects > "$TMP/objects-before"
LC_ALL=C comm -13 "$TMP/objects-prisma" "$TMP/objects-before" > "$TMP/objects-handmade"

echo "== what this PR changes in the schema (for the reviewer)"
npx prisma migrate diff --from-schema-datamodel "$TMP/base.prisma" \
    --to-schema-datamodel prisma/schema.prisma --script | tee "$TMP/expected.sql"

mkdir "$TMP/new-sql"
for f in $added; do cp "$f" "$TMP/new-sql/"; done
echo "== applying the PR's SQL files: ${added:-none}"
PGDATABASE=$SCRATCH sh scripts/apply-prod-sql.sh "$TMP/new-sql"
# the applier's own bookkeeping table isn't part of the schema
psql -X -q -d "$SCRATCH" -c 'DROP TABLE IF EXISTS _sql_migrations'

echo "== did the hand-written triggers and indexes survive?"
snapshot_objects > "$TMP/objects-after"
lost="$(LC_ALL=C comm -23 "$TMP/objects-handmade" "$TMP/objects-after")"
if [ -n "$lost" ]; then
    echo "::error::The SQL removed objects that schema.prisma doesn't know about. Re-create them in the same file (see prisma/scripts/create-triggers.ts and create-search-indexes.ts):" >&2
    echo "$lost" >&2
    exit 1
fi

echo "== does the result match schema.prisma?"
set +e
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script --exit-code > "$TMP/remaining.sql"
rc=$?
set -e
case "$rc" in
    0) echo "OK: the SQL produces exactly the schema in this branch." ;;
    2)
        echo "::error::The SQL in prisma/prod-sql/ does not produce schema.prisma. Still missing:" >&2
        cat "$TMP/remaining.sql" >&2
        if [ "$schema_changed" = 1 ] && [ -z "$added" ]; then
            echo "schema.prisma changed but no new file was added to prisma/prod-sql/. See prisma/prod-sql/README.md." >&2
        fi
        exit 1 ;;
    *) echo "::error::prisma migrate diff failed (exit $rc)" >&2; cat "$TMP/remaining.sql" >&2; exit 1 ;;
esac
