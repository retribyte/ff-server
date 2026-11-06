#!/usr/bin/env bash
# Regression tests for apply-prod-sql.sh, which runs unattended against production.
# Needs a Postgres via PGHOST / PGUSER / PGPASSWORD (and PGPORT if not 5432). Uses a
# scratch database (ff_apply_test, dropped and recreated). Runs in CI's `schema` job.
set -uo pipefail
cd "$(dirname "$0")/.."

export PGDATABASE=ff_apply_test
APPLY="sh scripts/apply-prod-sql.sh"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT
failures=0

Q() { psql -X -At -c "$1"; }
fresh() {
    rm -f "$D"/*
    psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $PGDATABASE" -c "CREATE DATABASE $PGDATABASE" 2> /dev/null
    Q "CREATE TABLE t (id int); INSERT INTO t VALUES (1)" > /dev/null
}
check() { # check <description> <actual> <expected>
    if [ "$2" = "$3" ]; then
        echo "ok   - $1"
    else
        echo "FAIL - $1: got [$2], want [$3]"
        failures=$((failures + 1))
    fi
}
expect_fail() { # expect_fail <description> <text the output must contain>
    local out rc
    out="$($APPLY "$D" 2>&1)"; rc=$?
    check "$1: fails" "$([ "$rc" != 0 ] && echo yes || echo no)" yes
    check "$1: says why" "$(printf '%s' "$out" | grep -c "$2" | sed 's/[1-9][0-9]*/yes/')" yes
}
tracked() { Q "SELECT coalesce(string_agg(filename, ',' ORDER BY filename), '') FROM _sql_migrations"; }
has_column() { Q "SELECT count(*) FROM information_schema.columns WHERE table_name = 't' AND column_name = '$1'"; }

fresh
echo 'ALTER TABLE t ADD COLUMN a text;' > "$D/1_a.sql"
check "--pending lists it" "$($APPLY --pending "$D")" "1_a.sql"
check "--pending applies nothing" "$(has_column a)" 0
$APPLY "$D" > /dev/null
check "applied and recorded" "$(has_column a)/$(tracked)" "1/1_a.sql"
check "--pending is empty afterwards" "$($APPLY --pending "$D")" ""
check "a second run applies nothing" "$($APPLY "$D" | tail -1)" "== sql migrations: 0 applied, 1 already applied"

fresh
echo 'ALTER TABLE t ADD COLUMN a text;' > "$D/1_a.sql"
printf 'ALTER TABLE t ADD COLUMN b text;\nALTER TABLE t ADD COLUMN c text NOT NULL;\n' > "$D/2_bad.sql"
echo 'ALTER TABLE t ADD COLUMN d text;' > "$D/3_d.sql"
expect_fail "failing file" "contains null values"
check "the file before stays, the failed one rolls back, the file after doesn't run" \
    "$(has_column a)$(has_column b)$(has_column d)/$(tracked)" "100/1_a.sql"
expect_fail "failing file, retried" "contains null values"

for stmt in 'BEGIN;' 'COMMIT;' 'commit work ;' 'ROLLBACK;' 'START TRANSACTION;' 'ALTER TABLE t ADD COLUMN z text; COMMIT;'; do
    fresh
    echo 'ALTER TABLE t ADD COLUMN a text;' > "$D/1_a.sql"
    printf '%s\nALTER TABLE t ADD COLUMN b text;\n' "$stmt" > "$D/2_tx.sql"
    expect_fail "pending file with [$stmt]" "own BEGIN/COMMIT"
    check "[$stmt]: nothing ran" "$(has_column a)$(has_column b)" 00
done

fresh
cat > "$D/1_plpgsql.sql" <<'SQL'
-- A comment with COMMIT; in it is fine.
CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN
    IF NEW.id IS NULL THEN
        RAISE EXCEPTION 'no';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
SQL
$APPLY "$D" > /dev/null
check "plpgsql BEGIN/END is not transaction control" "$(tracked)" "1_plpgsql.sql"

fresh
echo 'SELECT 1;' > "$D/1_a.sql"
$APPLY "$D" > /dev/null
echo 'SELECT 2;' > "$D/1_a.sql"
echo 'ALTER TABLE t ADD COLUMN later text;' > "$D/2_later.sql"
expect_fail "applied file edited" "already applied but has changed"
check "edited file: the pending one doesn't run" "$(has_column later)" 0

fresh
printf 'BEGIN;\nSELECT 1;\nCOMMIT;\n' > "$D/1_old.sql"
$APPLY "$D" > /dev/null 2>&1
Q "INSERT INTO _sql_migrations (filename, sha256) VALUES ('1_old.sql', '$(sha256sum "$D/1_old.sql" | cut -d' ' -f1)')" > /dev/null
$APPLY "$D" > /dev/null 2>&1
check "an already-applied file isn't held to the BEGIN/COMMIT rule" "$?" 0

fresh
echo 'ALTER TABLE t ADD COLUMN gone text;' > "$D/1_gone.sql"
$APPLY "$D" > /dev/null
rm "$D/1_gone.sql"
out="$($APPLY "$D" 2>&1)"; rc=$?
check "recorded file gone: not an error" "$rc" 0
check "recorded file gone: warns" "$(printf '%s' "$out" | grep -c 'WARNING: 1_gone.sql')" 1

fresh
printf 'SELECT 1;\n' > "$D/bad name.sql"
expect_fail "bad file name" "bad file name"

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $PGDATABASE" 2> /dev/null
echo
if [ "$failures" != 0 ]; then
    echo "$failures failed"
    exit 1
fi
echo "all passed"
