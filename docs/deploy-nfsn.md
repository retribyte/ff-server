# Production on NearlyFreeSpeech.NET

**https://vortox.space** (behind Cloudflare). NFSN site `vortox` (server type
**Apache 2.4 Generic**), FreeBSD, Node 24, PostgreSQL 17. SSH: `ssh -i
~/.ssh/booru -o IdentitiesOnly=yes retri_vortox@ssh.nyc1.nearlyfreespeech.net`.
The host's `nfsn` CLI (over SSH) can `stop-daemon`/`start-daemon <tag>`,
`set-cron` (scheduled tasks) and `list-aliases`; TLS certificates come only from
the panel.

## Domain, Cloudflare and the canonical host

The `vortox.space` zone (apex, `www`, `wiki`, `booru`) is proxied by Cloudflare,
whose rules (a geoblock allowing only the US, with an `x-bypass-key` bypass that accepts two keys, the app's
`IMAGE_KEY` and a separate CI key;
"Block AI bots"; a managed `robots.txt`) apply to every proxied name. The apex is
a CNAME to `vortox.nfshost.com`; `vortox.space` and `www.vortox.space` are NFSN
site aliases with Let's Encrypt certificates that NFSN issues and renews.

- **Certificates need `/.well-known/acme-challenge/` to pass Cloudflare's WAF.**
  Let's Encrypt validates from abroad, so the geoblock must skip that path
  (a Skip rule at the top of the custom rules), or issuing and renewal fail. A
  failed attempt "won't retry": remove and re-add the alias in the panel.
- **The NFSN default names skip Cloudflare.** Both apps 308 any request by an
  `*.nfshost.com` name or `www.` to `CANONICAL_HOST` (ff-server's `.env` and
  the site's `run.sh` both set `vortox.space`; unset = off). Code:
  ff-server `src/utils/canonical-host.ts`, ff-site `src/lib/canonicalHost.ts`.
  The booru (separate NFSN site `vortox-booru`) does the same in its
  `.htaccess`, right after `RewriteEngine On`; backups of that file are in the
  booru's `/home/private/htaccess-backups/`.

## The one thing to know: SSH is a different machine

SSH sessions share the filesystem with the daemons but not the machine. Daemon
processes aren't visible from SSH, and the Postgres socket refuses SSH
connections. Anything that must talk to the database runs on the daemon
machine, through the **jobs** daemon (below). Processes started over SSH die
with the session, and SSH sessions have a 180 s CPU limit.

## Layout

| Path | What | Mode |
|---|---|---|
| `/home/private/pgdata` | Postgres cluster (superuser `postgres`) | me only |
| `/home/private/postgres-superuser.pw`, `ff-db.pw` | DB passwords (role `ff`, db `ff`) | me only |
| `/home/private/bin/postgres.sh`, `jobrunner.sh` | daemon run scripts | me only |
| `/home/private/jobs/` | job queue (see below) | me only |
| `/home/private/prod-sql/` | `files/` and the applier (deploy copies), `backups/` (last 3 pre-migration dumps) | me only |
| `/home/protected/pgsock/` | Postgres unix socket, group `web` | me + web |
| `/home/protected/ff-server/` | the API: deployed code, `.env`, `run.sh` | me + web |
| `/home/protected/ff-site/` | the site: `app/` (deployed standalone build), `run.sh` | me + web |
| `/home/logs/daemon_<tag>.log` | each daemon's stdout/stderr | |

Postgres listens on the socket only (no TCP), with scram passwords. App
`DATABASE_URL`: `postgresql://ff:<pw>@localhost/ff?host=/home/protected/pgsock`.

## Daemons (site panel → Daemons)

NFSN daemon command lines take no arguments, so each one is a run script.
Tags can't contain hyphens (hence `ffserver`).

| Tag | Command | Working dir | Run as |
|---|---|---|---|
| `postgres` | `/home/private/bin/postgres.sh` | `/home/private` | me |
| `jobs` | `/home/private/bin/jobrunner.sh` | `/home/private` | me |
| `ffserver` | `/home/protected/ff-server/run.sh` | `/home/protected/ff-server` | web |
| `ffsite` | `/home/protected/ff-site/run.sh` | `/home/protected/ff-site` | web |

The API (`ffserver`) listens on `127.0.0.1:41730` (`HOST`/`PORT` in its `.env`),
the site (`ffsite`, Next.js standalone) on `127.0.0.1:41731` (set in its
`run.sh`, which also points its server-side code at the API over loopback).
Both run with `--max-old-space-size=128`: measured ~140-160 MB each warm.

## Proxies (site panel → Proxies)

| Protocol | Base Path | Document Root | Target Port |
|---|---|---|---|
| HTTP | `/api/` | `/api/` | `41730` |
| HTTP | `/` | `/` | `41731` |

The API is public through this proxy: `https://<site>/api/...` serves the
frontend, the bot and any other client alike, over NFSN's HTTPS. Binding
`127.0.0.1` only closes the side door of reaching the port directly and
skipping Apache. NFSN only admits HTTP(S) on 80/443 from outside anyway.

## Jobs: running things on the daemon machine

Write a shell script to `/home/private/jobs/<name>.tmp`, then rename it to
`<name>.sh` (so a half-written file is never picked up). Within ~5 s it runs
once as `me`, and its output (stdout and stderr) lands in
`jobs/done/<name>.<UTC stamp>.log`. Jobs run one at a time. Use it for psql,
pg_dump/pg_restore and one-off scripts.

## Deploying

### Automatic (GitHub Actions): the normal way

Both repos have `.github/workflows/deploy.yml`. Work happens on feature branches
and goes to `main` by PR (`main` is protected; there is no `dev` branch).

- **On a PR:** `test` runs. ff-server: `prisma generate`, `tsc --noEmit`,
  `npm test`. ff-site: lint, tests, `tsc --noEmit`, `next build`. None need a
  database or a `.env`.
- **On a push to `main`:** `test`, then `deploy`, which runs the same
  `scripts/deploy-nfsn.sh` described below, from the runner. It only runs for
  `main` (a manual "Run workflow" from another branch does not deploy), one deploy
  at a time per repo, never cancelled midway. "Run workflow" on `main` redeploys.
- **Secrets** are in each repo's `production` Environment: `NFSN_DEPLOY_KEY` (a
  CI-only SSH private key, public half in the NFSN member profile; NFSN keys are
  per member, so it can reach every site on the account) and `NFSN_KNOWN_HOSTS`
  (the host's ed25519 key, pinned, from `ssh-keyscan -t ed25519
  ssh.nyc1.nearlyfreespeech.net`). Rotate by replacing both ends. Optional
  variable `NFSN_SSH` overrides the user@host.
- **The health check has two steps.** First `https://vortox.nfshost.com/...`, not
  vortox.space: Cloudflare's Bot Fight Mode challenges GitHub's runners (`403`,
  `cf-mitigated: challenge`), and custom-rule skips don't cover that toggle. The
  NFSN name skips Cloudflare, and the app answers it with a 308 to the canonical
  host (200 if `CANONICAL_HOST` is unset), so a 308 means the daemon is up, and
  nothing more: it comes from the first middleware. Override with `HEALTH_URL`.
  Then a job on the daemon machine GETs real routes over loopback, which skips the
  redirect, and wants a 200 from each: ff-server's read the database, and ff-site's
  render pages. If this fails, **the new code is live**: see "Rolling back".
- **Schema changes are automatic too** (ff-server): a PR that changes
  `prisma/schema.prisma` includes a SQL file in `prisma/prod-sql/`, CI checks it
  on a scratch Postgres, and the deploy backs up the database and applies the SQL on
  the host *before* uploading the new code (see "Schema changes"). Keep it
  backward-compatible with the code that is live until the deploy lands. A change
  that needs both repos merges ff-server first.
- **Still by hand:** new environment variables. Add them to the host's `.env`
  (ff-server) or `run.sh` (ff-site) before merging; CI never touches those.
- A push to `main` is a deploy, so everything on `main` goes live, not just your
  commit. Check unreleased commits (`REVISION` on the host) before the first push
  after a manual deploy.

### Manual

The scripts still work from a Linux checkout with the SSH key (`~/.ssh/booru` by
default, or `NFSN_KEY`), for emergencies or when Actions is down.

Both deploy scripts end by restarting their daemon through `nfsn` and waiting
until the daemon answers on the NFSN name (~5 s of downtime).

ff-site: `scripts/deploy-nfsn.sh` in ff-site (builds HEAD in a temp worktree,
uploads the standalone server to `ff-site/app/`, restarts `ffsite`). Its own
route handlers live under `/site/`, since `/api/` belongs to ff-server.

ff-server:

```sh
scripts/deploy-nfsn.sh     # from a clean, committed checkout on Linux
```

It builds locally (the Prisma CLI can't run on FreeBSD), uploads `dist/` and
the generated client, reinstalls prod dependencies on the host when the
lockfile changed, writes `REVISION` and restarts `ffserver`.

## Schema changes

`prisma db push` can't reach prod (no TCP, and no Prisma CLI on FreeBSD), so
production only gets reviewed SQL. Develop with `db push` on dev as usual, then:

1. **Generate the SQL** from the old to the new schema, into
   `prisma/prod-sql/`, named `YYYYMMDDHHMM_what-it-does.sql`:
   ```sh
   git show origin/main:prisma/schema.prisma > /tmp/old.prisma
   npx prisma migrate diff --from-schema-datamodel /tmp/old.prisma \
       --to-schema-datamodel prisma/schema.prisma --script \
       > prisma/prod-sql/$(date -u +%Y%m%d%H%M)_what-it-does.sql
   ```
   Read it. A `DROP`, a `NOT NULL` without a default, or a rename (which Prisma
   writes as drop + add) needs hand-written SQL that keeps the data. Delete any
   `BEGIN;`/`COMMIT;` lines, which Prisma generates when an enum loses a value:
   the file already runs in one transaction, and the applier refuses them.
2. **Check it locally** (optional; CI does the same): with a throwaway Postgres
   reachable via `PGHOST`/`PGUSER`/`PGPASSWORD`, run
   `scripts/verify-schema-sql.sh origin/main`. It builds the base schema and the
   hand-written triggers and indexes in a scratch database, applies the PR's new SQL
   and fails if the result differs from `schema.prisma` or lost one of those.
3. **Commit it in the same PR.** The `schema` job (a required check) runs that
   check on the PR, and fails if an already-merged file was edited or removed.
   It also runs `scripts/lint-prod-sql.sh`, because **the scratch database has no
   rows** and so can't show what the SQL does to real data. The lint fails on
   statements that lose data and on `NOT NULL` without a `DEFAULT`, until the file
   has a `-- reviewed: why` comment; it warns about constraints that existing rows
   might break. A trigger whose body uses a dropped column is still caught by
   nobody: Postgres doesn't track those.
4. **Merge.** `scripts/deploy-nfsn.sh` rsyncs `prisma/prod-sql/` and
   `scripts/apply-prod-sql.sh` to `/home/private/prod-sql/` and queues a job
   (`migrate-<stamp>-<rev>`). If anything is pending, the job dumps the database
   to `backups/<job>.dump` (the last 3 are kept), then applies each pending file in
   order, as role `ff`, each in a transaction together with its row in
   `_sql_migrations` (filename + sha256). The job's log is printed in the deploy
   output. **If a file fails, the deploy stops before uploading,** with the old code
   still live. That file rolled back, but files before it stay applied. An applied
   file that was edited later is refused. The first file,
   `0000_tracker-smoke.sql`, does nothing; it marks the baseline. Everything before
   it was applied by hand.

Rules for these files: backward-compatible with the code that is live until the
deploy lands (add columns, don't rename or drop in one step; drop in a later PR
once nothing reads them); no `CONCURRENTLY` and nothing else that can't run in a
transaction, including `BEGIN`/`COMMIT`; no `CREATE EXTENSION` (role `ff` isn't a
superuser); never edit a file after it has merged, add a new one.

### When a migration fails

A merged file that fails on prod fails again on every deploy, so nothing in ff-server
ships until it's dealt with, hotfixes included. Prod is fine meanwhile: old code,
and the file rolled back. Fixing it in a PR doesn't work the obvious ways: a new file
can't get past the failing one (the applier stops there), and editing or deleting
the failing one is refused by the required `schema` check. So:

1. Find the file name and sha256 in the deploy log (`== applying <file> (<sha256>)`)
   and work out why it failed. To try the fix on real data, restore a backup locally.
2. Mark that file as dealt with, with a job, so the applier skips it (the `PG*`
   exports are in the restore example below):
   ```sh
   psql -v ON_ERROR_STOP=1 -c "INSERT INTO _sql_migrations (filename, sha256) VALUES ('<file>', '<sha256>')"
   ```
   Do this only for a file whose log shows it failed: it changed nothing, and it now
   never will.
3. Open a PR with a new file that does what the failed one should have. `main`'s
   `schema.prisma` already includes the change, so CI starts from a database that
   has it and prod doesn't. **Write the new file to work on both**:
   ```sql
   ALTER TABLE items ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
   ALTER TABLE items ALTER COLUMN note DROP DEFAULT;
   ```
   Merging it deploys everything held up since the failure.

### Rolling back

- **Code only, no SQL in the PR:** revert the PR. Merging the revert deploys it.
- **A PR with SQL:** the revert PR fails `schema`, since it removes a merged file.
  Keep the file and revert the rest by hand, adding a new file that undoes the SQL if
  `schema.prisma` goes back too (it must keep matching the database; if that drops a
  column, the `-- reviewed:` rule applies).
- **Prod is down right now:** in Actions, re-run the last good run on `main`. That
  deploys its commit, which works because migrations stay backward-compatible with
  the code before them. It warns about any applied file that commit doesn't have, and
  leaves the database alone. Revert on `main` too: the next merge deploys `main`.
- **A migration damaged data:** take the site down (`nfsn stop-daemon ffserver`),
  then restore the job's `/home/private/prod-sql/backups/<job>.dump` as in "Restoring
  the site DB" below, into an empty `ff`. Anything written since the dump is lost.

**Not automated:**
- The hand-written triggers and GIN indexes (`npm run db:triggers`,
  `db:search-indexes`). They live outside `schema.prisma`, and additive changes
  don't touch them. A migration that rebuilds `messages`, `story_lines` or
  `personas` must re-create the affected ones in its own SQL (copy the statements
  from `prisma/scripts/create-triggers.ts` / `create-search-indexes.ts`).
- Data backfills that need the app (e.g. `npm run backfill:*`). Write those as
  SQL in the migration, or run them by hand through a job.
- Restores, seeds, and anything else that touches data wholesale: prod is the
  source of truth.

Running the migrator by hand on the host (e.g. Actions is down and you deploy
manually): the deploy script does it; otherwise queue a job that exports the `PG*`
variables as in the restore example below and runs
`sh /home/private/prod-sql/apply-prod-sql.sh /home/private/prod-sql/files`.

## Building and restoring the database

Prod data is built locally and restored on the host, never seeded there:

```sh
git -C ../ff-site worktree add --detach /tmp/ff-site-prod main
scripts/build-prod-db.sh /tmp/ff-site-prod      # -> backups/prod-<date>.dump
```

The script runs the full seed into a scratch `ff_prod` DB, refreshes the wiki
cache, uploads every story manuscript as the admin, gives admin accounts
random passwords (printed to `~/ff-prod-admin-passwords-<date>.txt`, mode
600; players keep the hands-off default) and dumps it. Copy the dump to
`/home/private/` and restore it into an **empty** `ff` database with a job:

```sh
export PGHOST=/home/protected/pgsock PGUSER=ff PGDATABASE=ff PGPASSWORD="$(cat /home/private/ff-db.pw)"
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d ff /home/private/prod-<date>.dump
psql -c ANALYZE
```

Once players are using the site, prod is the source of truth: never restore
over it, since that would wipe their changes (passwords, stories, edits).
First restore: 2026-11-05, ff-server 18ab201 + ff-site 017b77e.

## Backups (weekly, pulled by the home NAS)

Nothing is backed up *on* NFSN (storage costs money there). The home NAS
("watcher", UGOS Pro) runs `scripts/nas-backup.sh`, installed as
`/home/trey/scripts/vortox-backup.sh`, from the user's crontab every Sunday at
04:30 (US/Central). It pulls over SSH with its own key (`~/.ssh/nfsn_backup`,
authorized in the NFSN member profile):

- **site:** a `pg_dump -Fc` of `ff` (made by a jobs-queue job, pulled, then
  deleted from the host) plus the host-only config (`.env`, run scripts,
  Postgres config, DB passwords).
- **booru:** a `sqlite3 .dump` of the Shimmie DB (streamed, consistent) plus an
  rsync mirror of `/home/public`. That excludes the live `.sqlite` file (the
  dump replaces it), cache/temp and `data/thumbs` (regenerable, and the web
  user's thumbnails aren't readable over SSH).

Latest mirror: `/home/trey/vortox/{site,booru}`. Dated archives:
`/volume1/media/backup/vortox/{site,booru}/vortox-<name>-<date>.tar.gz` (26
site, 8 booru). Log: `/home/trey/vortox/logs/`. Changing the NAS crontab needs
`sudo` (`crontab` isn't setuid on UGOS).

**Restoring the site DB** (into an empty `ff` database; for a fresh host,
recreate the cluster, the `ff` role and the database first, as in "Building and
restoring the database"): copy `site/db/ff.dump` from an archive to
`/home/private/` and run, as a job:

```sh
export PGHOST=/home/protected/pgsock PGUSER=ff PGDATABASE=ff PGPASSWORD="$(cat /home/private/ff-db.pw)"
pg_restore --no-owner --exit-on-error --single-transaction -d ff /home/private/ff.dump
psql -c ANALYZE
```

Host config to put back is under `site/config/home/...`, at the same paths.

**Restoring the booru:** stop writes (maintenance), then rsync
`booru/public/` back to `/home/public/` and rebuild the DB at the filename the
booru's `data/config` DSN expects (`data/shimmie.<hash>.sqlite`):
`zcat booru/db/shimmie.sql.gz | sqlite3 data/shimmie.<hash>.sqlite` (move the
old file aside first). Then regenerate thumbnails from Shimmie's admin page.

Both restores were tested on 2026-11-05: the site dump restored into
PostgreSQL 17 with every row count matching prod, and the booru dump rebuilt
with a passing integrity check and every image's file present.
