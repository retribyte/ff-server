# FF site backend

The backend for the [Final Frontier site](https://vortox.space). This server is responsible for serving the site's static files and handling the API requests. The server is built using Node.js and Express.js.

The backend uses a SQLite database to store user data, such as user accounts and user-generated content such as characters, weapons, items, etc. We use the Prisma ORM to interact with the database.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)

## Installation

1. Clone this repository and run `npm install`.
2. Create a `.env` file in the root directory of the project and add the following environment variables:

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-here"
```

3. Run `npx prisma migrate dev` to create the SQLite database.
    
    3.1. You may need to seed the database with some initial data. You can do this by running `npx prisma db seed --preview-feature`.
4. Run `npm start` to start the server.