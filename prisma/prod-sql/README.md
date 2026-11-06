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

Review the SQL (a `DROP` or a data-losing `ALTER` needs a conscious decision),
then commit it. The PR check applies it to a scratch database and fails unless
the result matches `schema.prisma`.

Rules: backward-compatible with the code that is live until the deploy lands
(add, don't rename or drop in one step); no `CONCURRENTLY` (each file runs in a
transaction); never edit a file after it has merged; the filename is
`[0-9A-Za-z._-]+.sql`.
