# FF site backend

The backend for the [Final Frontier site](https://vortox.space). This server is responsible for serving the site's static files and handling the API requests. The server is built using Node.js and Express.js.

The backend uses a PostgreSQL database to store user data, such as user accounts and user-generated content such as characters, weapons, items, etc. We use the Prisma ORM to interact with the database.

## Installation

1. Clone this repository and run `npm install`.
2. Create a `.env` file in the root directory. Fill in credentials as you see fit:

```
POSTGRES_USER=vortox
POSTGRES_PASSWORD=password
POSTGRES_DB=final-frontier

DATABASE_URL="postgresql://vortox:password@localhost:5432/final-frontier?schema=public"

PORT=3000
JWT_SECRET="change-me-in-production"
JWT_EXPIRATION=86400
SALT_ROUNDS=12

# Optional
# Self-registration is closed unless this is "true" (accounts are pre-seeded)
REGISTRATION_OPEN=false
PASSWORD_MIN_LENGTH=8
BOORU_URL="https://booru.vortox.space"
# Sent as the x-bypass-key header to get past the booru's Cloudflare bot challenge
IMAGE_KEY=
# Only if the booru stops serving posts anonymously (HTTP Basic auth)
BOORU_USER=
BOORU_PASSWORD=
```

3. Start the Postgres container (requires Docker). Only the `db` service: the
   compose file's `ff-api` service would fight `npm run dev` for port 3000.

```bash
npm run docker:up -- db
```

4. Generate the Prisma client and apply the schema (this project uses
   `db push`, not migrations), then the search indexes and triggers that
   `db push` can't express:

```bash
npx prisma generate
npx prisma db push
npm run db:search-indexes
npm run db:triggers
```

**Updating an existing database** (e.g. after pulling onto another machine):
some schema changes need a one-shot SQL script in `prisma/scripts/` run
*before* `npx prisma db push`, or `db push` drops data. See "Schema changes" in
`CLAUDE.md` for the list and the run command.

5. (Optional) Seed the database with the real archive. This wipes it first.
   The episodes come from ff-site's build step, so run that first:

```bash
(cd ../ff-site/archive-to-markdown && python3 md-to-api.py --all)
npm run seed
```

6. Start the dev server:

```bash
npm run dev
```

The API is accessible at `http://localhost:3000/api/`. API docs are served at `http://localhost:3000/api/docs`.

## Production

The live site is https://vortox.space (NearlyFreeSpeech.NET, FreeBSD, behind
Cloudflare). **Read [`docs/deploy-nfsn.md`](docs/deploy-nfsn.md) first**: it has
the host layout, daemons, proxies, and how to run anything that touches the
production database.

Merging to `main` deploys automatically (GitHub Actions: tests, then
`scripts/deploy-nfsn.sh`; see "Deploying" in the runbook, including the PR flow
and the secrets). To deploy by hand instead, from a clean, committed, pushed
checkout on Linux (needs the NFSN SSH key, `~/.ssh/booru` by default, or set
`NFSN_KEY`):

```bash
scripts/deploy-nfsn.sh               # ff-server: build, upload, restart, health check
(cd ../ff-site && scripts/deploy-nfsn.sh)   # the site, if it changed too
```

- **Schema changes ship as reviewed SQL** in `prisma/prod-sql/`, in the same PR as
  the `schema.prisma` change (see "Schema changes" in the deploy notes). CI checks
  it, and the deploy applies it on the host before the new code. Never `prisma db
  push` against prod: the Prisma CLI can't run on FreeBSD, and the production
  database is the source of truth.
- Prisma runs without native engines (`engineType = "client"` +
  `@prisma/adapter-pg`, in `src/db.ts`), which is why it works on FreeBSD.
- Production-only env (in the host's `.env`, not deployed): `HOST=127.0.0.1`,
  `PORT=41730`, `CANONICAL_HOST=vortox.space` (308s requests by any other
  host name to it), plus fresh secrets.
