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
```

3. Start the Postgres container (requires Docker):

```bash
sudo docker compose up -d
```

4. Generate the Prisma client and apply the schema:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

5. (Optional) Seed the database with sample data:

```bash
npx prisma db seed
```

6. Start the dev server:

```bash
npm run dev
```

The API is accessible at `http://localhost:3000/api/`. API docs are served at `http://localhost:3000/api/docs`.
