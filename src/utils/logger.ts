// Structured logging: one JSON object per line.
//
// Every entry goes to stdout (stderr for warn/error; NFSN keeps both in the
// daemon's log), into an in-memory ring buffer the /admin page reads, and, once
// `initLogging()` has run, into a daily file `<LOG_DIR>/app-YYYY-MM-DD.log`.
// Files older than LOG_RETENTION_DAYS (default 90) are deleted.
//
// Env: LOG_LEVEL (debug|info|warn|error, default info), LOG_DIR (default
// ./logs; empty string turns the file sink off), LOG_RETENTION_DAYS.
//
// Never log passwords, tokens, or request bodies: field names that look like
// secrets are redacted as a backstop, and errors are summarized (name, code,
// last line of the message, stack frames only) because Prisma error messages
// quote the query's values.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";

export type Level = "debug" | "info" | "warn" | "error";
export type LogEntry = { time: string; level: Level; event: string; msg?: string } & Record<string, unknown>;

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const RING_SIZE = 2000;
const SECRET_KEY = /pass(word)?|token|authorization|secret|cookie|jwt/i;
const MAX_STRING = 500;

/** The request being handled; set by `requestLogger` so any log line can say which request it belongs to. */
export type RequestContext = { reqId: string; req: Request };
export const requestContext = new AsyncLocalStorage<RequestContext>();

const ring: LogEntry[] = [];
let fileDir: string | null = null;
let fileFailed = false;
let minLevel: Level = parseLevel(process.env.LOG_LEVEL);

function parseLevel(value: string | undefined): Level {
    return value && value in RANK ? (value as Level) : "info";
}

/** Redacts secret-looking keys and truncates long strings, a few levels deep. */
export function sanitize(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    if (value === null || typeof value !== "object") return value;
    if (depth >= 3) return "[object]";
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? "[redacted]" : sanitize(v, depth + 1);
    return out;
}

/**
 * What to record about a caught error: its type, code and message's last line,
 * never the whole message (Prisma's quotes the values being written) or props.
 */
export function errorFields(error: unknown, withStack = true): Record<string, unknown> {
    if (!(error instanceof Error)) return { errMessage: String(error).slice(0, 300) };
    const lines = error.message.split("\n").map((l) => l.trim()).filter(Boolean);
    const fields: Record<string, unknown> = { errName: error.name, errMessage: (lines[lines.length - 1] ?? "").slice(0, 300) };
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") fields.errCode = code;
    if (withStack && error.stack) {
        fields.stack = error.stack.split("\n").filter((l) => /^\s+at /.test(l)).slice(0, 8).map((l) => l.trim()).join("\n");
    }
    return fields;
}

function today(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

function fileFor(day: string): string | null {
    return fileDir ? path.join(fileDir, `app-${day}.log`) : null;
}

function writeFile(line: string, now: Date): void {
    const file = fileFor(today(now));
    if (!file || fileFailed) return;
    try {
        fs.appendFileSync(file, line + "\n");
    } catch (error) {
        // Disk full or not writable: keep serving, and say so once
        fileFailed = true;
        process.stderr.write(JSON.stringify({ time: now.toISOString(), level: "error", event: "log.file_failed", ...errorFields(error, false) }) + "\n");
    }
}

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
    if (RANK[level] < RANK[minLevel]) return;
    const now = new Date();
    const ctx = requestContext.getStore();
    const user = ctx?.req.user as { id?: number; username?: string } | undefined;
    const entry: LogEntry = {
        time: now.toISOString(),
        level,
        event,
        ...(ctx ? { reqId: ctx.reqId } : {}),
        ...(user?.id !== undefined ? { userId: user.id, username: user.username } : {}),
        ...(sanitize(fields) as Record<string, unknown>),
    };
    ring.push(entry);
    if (ring.length > RING_SIZE) ring.shift();
    const line = JSON.stringify(entry);
    (RANK[level] >= RANK.warn ? process.stderr : process.stdout).write(line + "\n");
    writeFile(line, now);
}

export const logger = {
    debug: (event: string, fields: Record<string, unknown> = {}) => emit("debug", event, fields),
    info: (event: string, fields: Record<string, unknown> = {}) => emit("info", event, fields),
    warn: (event: string, fields: Record<string, unknown> = {}) => emit("warn", event, fields),
    error: (event: string, fields: Record<string, unknown> = {}) => emit("error", event, fields),
    /** A route's catch block: `msg` says what failed, the error is summarized (stack included). */
    caught: (msg: string, error: unknown, fields: Record<string, unknown> = {}) =>
        emit("error", "app.error", { msg, ...errorFields(error), ...fields }),
};

export type LogQuery = {
    /** Minimum level */
    level?: Level;
    /** Event name or prefix: "auth" matches "auth.login" */
    event?: string;
    /** Username or user id */
    user?: string;
    /** Substring of the whole entry, case-insensitive */
    q?: string;
    /** Only entries at or after this ISO time */
    since?: string;
    limit?: number;
};

/** Recent entries from the ring buffer, newest first. */
export function queryLogs(query: LogQuery = {}): LogEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), RING_SIZE);
    const min = RANK[query.level ?? "debug"];
    const q = query.q?.toLowerCase();
    const out: LogEntry[] = [];
    for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
        const e = ring[i];
        if (RANK[e.level] < min) continue;
        if (query.since && e.time < query.since) break; // the ring is in time order
        if (query.event && !(e.event === query.event || e.event.startsWith(`${query.event}.`))) continue;
        if (query.user && String(e.username) !== query.user && String(e.userId) !== query.user) continue;
        if (q && !JSON.stringify(e).toLowerCase().includes(q)) continue;
        out.push(e);
    }
    return out;
}

/** Empties the ring buffer (tests). */
export function resetLogs(): void {
    ring.length = 0;
}

/** Sets the minimum level (tests). */
export function setLogLevel(level: Level): void {
    minLevel = level;
}

const TAIL_BYTES = 1_000_000;

/** Last lines of a log file, parsed; unparseable lines are skipped. */
function readTail(file: string): LogEntry[] {
    let fd: number | undefined;
    try {
        fd = fs.openSync(file, "r");
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - TAIL_BYTES);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        const lines = buf.toString("utf8").split("\n");
        if (start > 0) lines.shift(); // cut mid-line
        return lines.flatMap((l) => {
            try {
                return l.trim() ? [JSON.parse(l) as LogEntry] : [];
            } catch {
                return [];
            }
        });
    } catch {
        return [];
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/** Deletes app-YYYY-MM-DD.log files older than `days` days. Returns the names removed. */
export function pruneLogFiles(dir: string, days: number, now = new Date()): string[] {
    const cutoff = today(new Date(now.getTime() - days * 86_400_000));
    const removed: string[] = [];
    let names: string[] = [];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return removed;
    }
    for (const name of names) {
        const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (!m || m[1] >= cutoff) continue;
        try {
            fs.unlinkSync(path.join(dir, name));
            removed.push(name);
        } catch {
            /* leave it for next time */
        }
    }
    return removed;
}

/**
 * Starts the file sink and reloads the last day or so of entries into the ring
 * buffer, so /admin still has history after a restart. Call once at startup.
 */
export function initLogging(): void {
    minLevel = parseLevel(process.env.LOG_LEVEL);
    const dir = process.env.LOG_DIR ?? "logs";
    if (!dir) return;
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        fileFailed = true;
        process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: "error", event: "log.file_failed", ...errorFields(error, false) }) + "\n");
        return;
    }
    fileDir = dir;
    const days = Number(process.env.LOG_RETENTION_DAYS) || 90;
    const now = new Date();
    const yesterday = today(new Date(now.getTime() - 86_400_000));
    const history = [yesterday, today(now)].flatMap((day) => readTail(path.join(dir, `app-${day}.log`)));
    ring.unshift(...history.slice(-RING_SIZE));
    const removed = pruneLogFiles(dir, days, now);
    logger.info("log.start", { dir, retentionDays: days, restored: Math.min(history.length, RING_SIZE), pruned: removed.length });
    // Prune again daily; the timer must not keep the process alive
    setInterval(() => pruneLogFiles(dir, days), 86_400_000).unref();
}
