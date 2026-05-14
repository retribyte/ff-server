# Backend Style Guide

This guide documents the architectural patterns and conventions used throughout this Express/TypeScript backend. Follow these patterns when adding or modifying routes, services, and middleware.

---

## Table of Contents

1. [Directory Structure](#directory-structure)
2. [Naming Conventions](#naming-conventions)
3. [Routes (Controllers)](#routes-controllers)
4. [Services](#services)
5. [Middleware](#middleware)
6. [Error Handling](#error-handling)
7. [Response Format](#response-format)
8. [Authentication & Authorization](#authentication--authorization)
9. [Database Access (Prisma)](#database-access-prisma)
10. [TypeScript Conventions](#typescript-conventions)
11. [Environment Variables](#environment-variables)

---

## Directory Structure

The project is organized into **feature modules** under `src/`. Each module owns its controller, service, and tests.

```
src/
├── server.ts                       # Entry point — creates App, starts listener
├── app.ts                          # Express configuration, route registration
├── prisma.ts                       # Singleton PrismaClient instance
│
├── [feature]/
│   ├── [feature].controller.ts     # Route definitions
│   ├── [feature].service.ts        # Business logic and DB access
│   ├── [feature].controller.spec.ts
│   └── [feature].service.spec.ts
│
└── auth/
    ├── security.middleware.ts      # authenticate, isAdmin, isListener, rate limiters
    └── token.service.ts            # JWT generation and verification
```

Feature module names are **lowercase singular** (e.g., `song`, `playlist`, `mood`, `zone`).

---

## Naming Conventions

### Files

| Type | Pattern | Example |
|------|---------|---------|
| Controller | `[feature].controller.ts` | `song.controller.ts` |
| Service | `[feature].service.ts` | `song.service.ts` |
| Middleware | `[purpose].middleware.ts` | `security.middleware.ts` |
| Test | `[file].spec.ts` | `song.service.spec.ts` |

### Functions

| Category | Pattern | Example |
|----------|---------|---------|
| Route initializer | `initialize[Feature]Routes` | `initializeSongRoutes` |
| Fetch all | `getAll[Resources]` | `getAllSongs` |
| Fetch one | `get[Resource]By[Property]` | `getSongByIsrc` |
| Create | `create[Resource]` | `createPlaylist` |
| Update | `update[Resource][Field]` | `updateSongDetails` |
| Delete | `delete[Resource]` | `deleteSong` |
| Middleware | descriptive verb phrase | `authenticate`, `isAdmin`, `isListener` |

### Imports

Name imported modules with the `[entity]Service` / `[entity]Controller` suffix:

```typescript
import songService from "../song/song.service.js";
import playlistController from "../playlist/playlist.controller.js";
```

### Constants

Use `UPPER_SNAKE_CASE` for module-level constants:

```typescript
const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MULTIPLIER = 2;
```

---

## Routes (Controllers)

### Structure

Each controller exports a single default object with one `initialize[Feature]Routes` function that returns a configured `Router`.

```typescript
// song.controller.ts
import { Router, Request, Response } from "express";
import songService from "../song/song.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";

const initializeSongRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/songs: Return all songs
    router.get("/songs", authenticate, async (req: Request, res: Response) => {
        // ...
    });

    // DELETE /api/songs/:isrc: Delete a song
    router.delete("/songs/:isrc", authenticate, isAdmin, async (req: Request, res: Response) => {
        // ...
    });

    return router;
};

export default { initializeSongRoutes };
```

### Registration in `app.ts`

All routers are mounted at `/api` in `app.ts`:

```typescript
private routes(): void {
    this.app.use("/api", songController.initializeSongRoutes());
    this.app.use("/api", playlistController.initializePlaylistRoutes());
    // ...
}
```

Login routes that need auth-specific rate limiting are mounted directly:

```typescript
this.app.post("/api/login", authSpeedLimiter, authLimiter, userController.initializeUserRoutes());
```

### Handler Anatomy

For simple routes, wrap the entire body in a single `try/catch`. Use `async (req: Request, res: Response)` with explicit type annotations. Check for a missing result inside the `try` block and return early, then send the success response at the end.

```typescript
router.get('/moods/:name', authenticate, async (req: Request, res: Response) => {
    const { name } = req.params;

    try {
        const mood = await moodService.getMoodByName(name);
        if (!mood) {
            return res.status(404).json({ status: "error", message: `Mood with name '${name}' not found` });
        }
        res.status(200).json({ status: "success", data: mood });
    } catch (error) {
        console.error('Error fetching mood by name:', error);
        res.status(500).json({ status: "error", message: 'Failed to fetch mood' });
    }
});
```

When the route requires input validation, do it with early returns **before** the `try/catch`:

```typescript
router.post('/register', async (req: Request, res: Response) => {
    if (!req.body?.username || !req.body?.password) {
        return res.status(400).json({ status: "error", message: "Missing username or password" });
    }

    try {
        const result = await userService.createNewListener(req.body.username, req.body.password);

        if ('error' in result) {
            return res.status(400).json({ status: "error", message: result.error });
        }

        return res.status(201).json({ status: "success", data: result });
    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ status: "error", message: "Internal server error" });
    }
});
```

### HTTP Status Codes

| Code | When to use |
|------|-------------|
| `200` | Successful read or generic success |
| `201` | Resource created |
| `202` | Request accepted (e.g., async action queued) |
| `204` | Success with no body |
| `400` | Bad request / missing or invalid input |
| `401` | Not authenticated (missing or invalid token) |
| `403` | Authenticated but not authorized (wrong role) |
| `404` | Resource not found |
| `409` | Conflict (duplicate resource) |
| `500` | Unexpected server error |

### Request Data Sources

| Source | Access pattern |
|--------|----------------|
| URL params | `req.params.id`, `req.params.name` |
| Query string | `req.query.status`, `req.query.lat` |
| Body | `req.body.zone`, `req.body.isrc` |
| Authenticated user | `req.user` (set by `authenticate` middleware) |

---

## Services

### Structure

Each service exports a default object whose values are async functions. There are no classes.

```typescript
// song.service.ts
async function getAllSongs(): Promise<Song[]> {
    return await prisma.song.findMany();
}

async function createSong(isrc: string): Promise<Song | null> {
    if (isrc.length !== 12) throw Error("Invalid ISRC");
    // ...
}

export default {
    getAllSongs,
    getSongByIsrc,
    createSong,
    updateSongDetails,
    deleteSong,
};
```

### Responsibilities

Services own all business logic and all database interaction. Controllers should not call Prisma directly.

Service functions:
- Throw `Error` with a descriptive message on known failure conditions
- Return `null` (not throw) when a record simply does not exist
- Return the domain object (or array) on success
- Use `Type | null` return types when absence is a valid outcome

```typescript
async function getSongByIsrc(isrc: string): Promise<Song | null> {
    return await prisma.song.findUnique({ where: { isrc } });
}
```

### Service-to-Service Calls

Services may call other services. Import them the same way controllers do:

```typescript
import songService from "../song/song.service.js";

const songs = await songService.getSongsWithinRange(tags, minScore, maxScore);
```

---

## Middleware

Middleware lives in `src/auth/`. Export each function as a named export.

```typescript
export async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ status: "error", message: "No authorization header" });
        return;
    }
    const token = authHeader.split(" ")[1];
    const decoded = await verifyAccessToken(token);
    if (!decoded) {
        res.status(401).json({ status: "error", message: "Invalid or expired token" });
        return;
    }
    req.user = decoded;
    next();
}
```

### Available Middleware

| Middleware | Purpose | Applied at |
|------------|---------|------------|
| `authenticate` | Verifies JWT access token; sets `req.user` | Per route |
| `isAdmin` | Requires `req.user.role === "admin"` | Per route, after `authenticate` |

### Applying Middleware

List middleware between the path and the handler, in order:

```typescript
router.get("/songs", authenticate, async (...) => { ... });
router.post("/songs", authenticate, isAdmin, async (...) => { ... });
router.post("/playlists", authenticate, isAdmin, async (...) => { ... });
```

---

## Error Handling

### Three Layers

**1. Service layer** — throw descriptive errors for known bad states:

```typescript
if (isrc.length !== 12) throw Error("Invalid ISRC");
if (!song) throw Error("Failed to get song from Spotify");
```

**2. Controller layer** — catch and map to HTTP status codes:

```typescript
try {
    const song = await songService.createSong(req.body.isrc);
    res.status(200).json({ status: "success", data: song });
} catch (e: any) {
    if (e.message === "Invalid ISRC") {
        res.status(400).json({ status: "error", message: e.message });
    } else {
        res.status(500).json({ status: "error", message: e.message });
    }
}
```

**3. Global fallback** in `app.ts` — catches anything that slips through:

```typescript
private errorHandlers(): void {
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
        console.error(err.stack);
        res.status(500).send("L, 500 server error");
    });
    this.app.use((req: Request, res: Response) => {
        res.status(404).send("Resource not found");
    });
}
```

### Prisma Error Codes

Check Prisma error codes when the database can produce known failures:

```typescript
if (error instanceof Error && "code" in error && error.code === "P2025") {
    throw new Error(`Time with name "${name}" not found.`);
}
```

---

## Response Format

All JSON responses follow the same shape:

**Success:**
```json
{ "status": "success", "data": <resource or array> }
```

**Error:**
```json
{ "status": "error", "message": "Human-readable description" }
```

Never return raw Prisma objects, internal error stacks, or unformatted strings as JSON responses.

---

## Authentication & Authorization

### Token Lifecycle

Access tokens are short-lived JWTs, sent as an `Authorization: Bearer <token>` header.

### Login Flow

1. Validate that `username` and `password` are present; return `400` if either is missing
2. Find user by `username`
3. Compare password with `bcrypt.compareSync`
4. On failure: return `null`; controller responds `400`
5. On success: generate and return the JWT access token

### Roles

Only two roles exist: `"user"` and `"admin"`. New users default to `"user"`. Apply the appropriate middleware to every protected route:

```typescript
router.get("/admin/requests", authenticate, isAdmin, async (...) => { ... });
router.post("/playlists", authenticate, async (...) => { ... });
```

---

## Database Access (Prisma)

### Common Patterns

```typescript
// Read many with relations
const songs = await prisma.song.findMany({
    include: {
        zones: { select: { weight: true, zoneId: true } },
        moods: { select: { weight: true, moodId: true } },
    },
});

// Read one (returns null if missing)
const user = await prisma.user.findUnique({ where: { username } });

// Create
const created = await prisma.user.create({
    data: { username, password: hash, role: "listener" },
});

// Update
const updated = await prisma.playlist.update({
    where: { id: playlistId },
    data: { rated: true },
});

// Delete
await prisma.song.delete({ where: { isrc } });
```

---

## TypeScript Conventions


### Return Types

Always annotate service function return types:

```typescript
async function getSongByIsrc(isrc: string): Promise<Song | null>
async function getAllSongs(): Promise<Song[]>
async function createSong(isrc: string): Promise<Song>
```

### Async/Await

Use `async/await` exclusively. Do not use `.then()` chains.

### Type Assertions

Explicit type definitions are preferred. Use `as` only at boundaries where TypeScript cannot infer the type (e.g., after middleware sets `req.user`). Avoid `any` except where Prisma dynamic delegates require it.

---

## Environment Variables

All environment variables are loaded via `dotenv`. Provide a safe default when the variable is optional:

```typescript
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET ?? "secret";
```

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MongoDB connection string |
| `JWT_SECRET` | Access token signing secret |
| `JWT_EXPIRATION` | Access token TTL (seconds) |
| `PORT` | Server port |
| `NODE_ENV` | `"production"` enables secure cookies |
| `CLIENT_ID` / `CLIENT_SECRET` | Spotify API credentials |
| `REDIRECT_URI` | Spotify OAuth callback |
| `SPOTIFY_USER_ID` | Spotify account for playlist management |
| `PLAYLIST_SIZE` | Number of songs per generated playlist |
| `DEFAULT_WEIGHT` | Initial tag weight for new associations |
| `WEIGHT_INCREMENT` | Weight adjustment on playlist rating |
