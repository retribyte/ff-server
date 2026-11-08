import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger, queryLogs, resetLogs, sanitize, errorFields, pruneLogFiles, setLogLevel } from "../src/utils/logger.js";

// Entries also print to stdout/stderr; the test runner shows that as noise only.
test("sanitize redacts secret-looking keys, deeply, and truncates long strings", () => {
    const out = sanitize({ user: "a", password: "hunter2", nested: { Authorization: "Bearer x", ok: 1 }, long: "x".repeat(900) }) as any;
    assert.equal(out.password, "[redacted]");
    assert.equal(out.nested.Authorization, "[redacted]");
    assert.equal(out.nested.ok, 1);
    assert.ok(out.long.length < 510);
});

test("errorFields keeps type, code and the message's last line; the stack has frames only", () => {
    const err = Object.assign(new Error("Invalid `prisma.user.create()` invocation:\n\nUnique constraint failed (email=a@b.c)"), { code: "P2002" });
    const f = errorFields(err);
    assert.equal(f.errCode, "P2002");
    assert.equal(f.errMessage, "Unique constraint failed (email=a@b.c)");
    assert.ok(!String(f.stack).includes("Invalid `prisma"));
    assert.match(String(f.stack), /^at /);
});

test("queryLogs filters by level, event prefix, user, text and limit, newest first", () => {
    resetLogs();
    logger.info("http", { url: "/api/a" });
    logger.warn("auth.login_failed", { attempted: "zach" });
    logger.info("auth.login", { username: "zach" });
    logger.error("app.error", { msg: "boom" });
    assert.deepEqual(queryLogs().map((e) => e.event), ["app.error", "auth.login", "auth.login_failed", "http"]);
    assert.deepEqual(queryLogs({ level: "warn" }).map((e) => e.event), ["app.error", "auth.login_failed"]);
    assert.deepEqual(queryLogs({ event: "auth" }).map((e) => e.event), ["auth.login", "auth.login_failed"]);
    assert.equal(queryLogs({ event: "au" }).length, 0, "prefix means whole dotted segments");
    assert.deepEqual(queryLogs({ user: "zach" }).map((e) => e.event), ["auth.login"]);
    assert.deepEqual(queryLogs({ q: "BOOM" }).map((e) => e.event), ["app.error"]);
    assert.equal(queryLogs({ limit: 2 }).length, 2);
    assert.equal(queryLogs({ since: new Date(Date.now() + 60_000).toISOString() }).length, 0);
});

test("the ring buffer keeps the newest 2000 entries", () => {
    resetLogs();
    setLogLevel("debug");
    for (let i = 0; i < 2100; i++) logger.debug("n", { i });
    const kept = queryLogs({ limit: 5000 });
    setLogLevel("info");
    assert.equal(kept.length, 2000);
    assert.equal(kept[0].i, 2099);
    assert.equal(kept[1999].i, 100);
});

test("pruneLogFiles deletes only app-*.log files older than the cutoff", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-logs-"));
    for (const name of ["app-2026-01-01.log", "app-2026-08-10.log", "app-2026-11-06.log", "notes.txt"]) fs.writeFileSync(path.join(dir, name), "x");
    const removed = pruneLogFiles(dir, 90, new Date("2026-11-07T12:00:00Z"));
    assert.deepEqual(removed, ["app-2026-01-01.log"]); // cutoff is 2026-08-09
    assert.deepEqual(fs.readdirSync(dir).sort(), ["app-2026-08-10.log", "app-2026-11-06.log", "notes.txt"]);
    fs.rmSync(dir, { recursive: true });
});
