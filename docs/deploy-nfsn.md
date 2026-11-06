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
once as `me`, and its output lands in `jobs/done/<name>.<UTC stamp>.log`. Use
it for psql, pg_dump/pg_restore and one-off scripts.

## Deploying

**Automatic:** a push to `main` in either repo runs GitHub Actions
(`.github/workflows/deploy.yml`): typecheck/tests, then the same
`scripts/deploy-nfsn.sh`. The SSH key and pinned host key are Environment
secrets (`NFSN_DEPLOY_KEY`, `NFSN_KNOWN_HOSTS`) in each repo's `production`
environment; revoke the key in the NFSN member profile. Run schema SQL on the
host *before* merging, since CI deploys code only.

Both deploy scripts end by restarting their daemon through `nfsn` and waiting
until https://vortox.space answers (~5 s of downtime).

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

`prisma db push` can't reach prod (no TCP, and no Prisma CLI on FreeBSD).
Develop with `db push` on dev as usual, then generate the SQL for prod and
review it:

```sh
npx prisma migrate diff --from-schema-datasource <old schema> \
    --to-schema-datamodel prisma/schema.prisma --script > change.sql
```

Run `change.sql` on prod through a job (`psql -v ON_ERROR_STOP=1 -f`), then
re-run the idempotent `db:search-indexes` and `db:triggers` SQL the same way.
Deploy the code that needs the new schema after the SQL has run.

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
