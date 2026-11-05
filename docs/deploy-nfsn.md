# Production on NearlyFreeSpeech.NET

Site `vortox` (server type **Apache 2.4 Generic**), FreeBSD, Node 24,
PostgreSQL 17. SSH: `ssh -i ~/.ssh/booru -o IdentitiesOnly=yes
retri_vortox@ssh.nyc1.nearlyfreespeech.net`.

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

The API (`ffserver`) listens on `127.0.0.1:41730` (`HOST`/`PORT` in its `.env`).

## Proxies (site panel → Proxies)

| Protocol | Base Path | Document Root | Target Port |
|---|---|---|---|
| HTTP | `/api/` | `/api/` | `41730` |

The API is public through this proxy: `https://<site>/api/...` serves the
frontend, the bot and any other client alike, over NFSN's HTTPS. Binding
`127.0.0.1` only closes the side door of reaching the port directly and
skipping Apache. NFSN only admits HTTP(S) on 80/443 from outside anyway.

## Jobs: running things on the daemon machine

Write a shell script to `/home/private/jobs/<name>.tmp`, then rename it to
`<name>.sh` (so a half-written file is never picked up). Within ~5 s it runs
once as `me`, and its output lands in `jobs/done/<name>.<UTC stamp>.log`. Use
it for psql, pg_dump/pg_restore and one-off scripts.

## Deploying ff-server

```sh
scripts/deploy-nfsn.sh     # from a clean, committed checkout on Linux
```

It builds locally (the Prisma CLI can't run on FreeBSD), uploads `dist/` and
the generated client, reinstalls prod dependencies on the host when the
lockfile changed, and writes `REVISION`. Then restart the `ffserver` daemon
in the panel.

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
