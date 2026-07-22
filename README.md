# FF site backend

The API server for the [Final Frontier site](https://vortox.space): an
Express / TypeScript / Prisma / Postgres API for the lore archive and campaign
reader — users, characters, species, seasons/episodes/messages, stories
(prose/CYOA), items, commentary. It's consumed by the `ff-site` Next.js
frontend and by any token-authenticated API client.

## Setup

1. Clone this repository and run `npm install` (Node 22).
2. Create a `.env` file in the root directory:

   ```
   POSTGRES_USER=vortox
   POSTGRES_PASSWORD=password
   POSTGRES_DB=final-frontier

   DATABASE_URL="postgresql://vortox:password@localhost:5432/final-frontier?schema=public"

   PORT=3000
   JWT_SECRET="change-me-in-production"
   JWT_EXPIRATION=86400
   SALT_ROUNDS=12
   ```

3. Start **only the Postgres container**. Running the full compose stack also
   binds host `:3000`, which collides with a locally-run `npm run dev`:

   ```bash
   npm run docker:up -- db
   ```

4. Generate the Prisma client and push the schema. This project uses
   `prisma db push` — it is **not** using versioned migrations day to day
   (`prisma/migrations/` is present but empty):

   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. (Optional) Seed the database:

   ```bash
   npm run seed
   ```

   > ⚠️ Seeding **wipes all data** before loading. Never run it against a
   > database that holds user-authored content you want to keep.

6. Start the dev server (`tsx watch` — auto-restarts on save):

   ```bash
   npm run dev
   ```

The API is served at `http://localhost:3000/api/`; Swagger docs at
`http://localhost:3000/api/docs`.

## Scripts

- `npm run dev` — dev server with watch
- `npm run lint` — ESLint
- `npm run format` / `npm run format:check` — Prettier
- `npm run docs` — lint the OpenAPI spec (`src/openapi.ts`)
- `npm run seed` — reseed the database (destructive; see above)

See `CLAUDE.md` for architecture and conventions, `FF design document.md` for
requirements (FR-*/NFR-*), and `api-tests/` (a Bruno collection) for
exercising endpoints manually.
