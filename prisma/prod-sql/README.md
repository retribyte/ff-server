# Production SQL migrations

Every `*.sql` file here is applied to the production database, once each, by
`scripts/deploy-nfsn.sh` (so by CI when a PR merges to `main`) **before** the
new code is uploaded. See "Schema changes" in `docs/deploy-nfsn.md`.

Add a file in the same PR as any `prisma/schema.prisma` change:

```sh
git show origin/main:prisma/schema.prisma > /tmp/old.prisma
npx prisma migrate diff --from-schema-datamodel /tmp/old.prisma \
    --to-schema-datamodel prisma/schema.prisma --script \
    > prisma/prod-sql/$(date -u +%Y%m%d%H%M)_what-it-does.sql
```

Review the SQL, then commit it. The PR check lints it, applies it to a scratch
database and fails unless the result matches `schema.prisma`. **That database has
no rows**, so the check can't tell you whether the SQL works on real data or what
it does to it.

The lint fails on statements that lose data (`DROP COLUMN`, `DELETE`, `UPDATE`, a
column type change, ...) and on `ADD COLUMN ... NOT NULL` without a `DEFAULT`, which
fails on any table with rows. Fix the SQL, or if it really is fine, say why in a
comment in the file:

```sql
-- reviewed: the column was only ever written by the retired importer
```

Rules: backward-compatible with the code that is live until the deploy lands
(add, don't rename or drop in one step); no `CONCURRENTLY` and no `BEGIN`/`COMMIT`
(each file already runs in one transaction; Prisma generates these lines for enum
changes, so delete them); never edit a file after it has merged; the filename is
`[0-9A-Za-z._-]+.sql`.

If a merged file fails on production, every deploy stops until it's recovered: see
"When a migration fails" in `docs/deploy-nfsn.md`.
