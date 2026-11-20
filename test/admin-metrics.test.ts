import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTraffic } from "../src/admin/metrics.js";
import type { LogEntry } from "../src/utils/logger.js";

const NOW = Date.parse("2026-11-20T15:30:00Z");
const http = (time: string, status: number, ms: number, url = "/api/stories/12?x=1"): LogEntry => ({ time, level: status >= 500 ? "error" : status >= 400 ? "warn" : "info", event: "http", method: "GET", url, status, ms });

test("summarizeTraffic buckets requests by hour and outcome over the last 24 hours", () => {
    const t = summarizeTraffic(
        [
            http("2026-11-19T15:10:00Z", 200, 5), // the hour before the first bucket: left out
            http("2026-11-20T15:05:00Z", 200, 10),
            http("2026-11-20T15:06:00Z", 404, 20),
            http("2026-11-20T15:07:00Z", 500, 30),
            http("2026-11-19T14:59:00Z", 200, 999), // before the window: left out
            { time: "2026-11-20T15:08:00Z", level: "error", event: "app.error" },
            { time: "2026-11-20T15:09:00Z", level: "warn", event: "auth.login" },
        ],
        NOW,
    );
    assert.equal(t.hours.length, 24);
    assert.equal(t.hours[0].hour, "2026-11-19T16:00:00.000Z");
    assert.deepEqual(t.hours[23], { hour: "2026-11-20T15:00:00.000Z", ok: 1, clientErrors: 1, serverErrors: 1 });
    assert.equal(t.requests, 3);
    assert.equal(t.serverErrors, 1);
    assert.equal(t.clientErrors, 1);
    assert.equal(t.errors, 1);
    assert.equal(t.warnings, 1);
    assert.equal(t.coveredSince, "2026-11-19T14:59:00Z");
});

test("summarizeTraffic folds ids out of routes and reports percentiles", () => {
    const entries = Array.from({ length: 20 }, (_, i) => http("2026-11-20T15:00:00Z", 200, i + 1, `/api/stories/${i}/chapters/3?p=${i}`));
    const t = summarizeTraffic(entries, NOW);
    assert.deepEqual(t.topRoutes, [{ route: "GET /api/stories/:id/chapters/:id", count: 20 }]);
    assert.equal(t.p50, 11);
    assert.equal(t.p95, 20);
});

test("summarizeTraffic with no requests has null percentiles", () => {
    const t = summarizeTraffic([], NOW);
    assert.equal(t.requests, 0);
    assert.equal(t.p50, null);
    assert.equal(t.coveredSince, null);
});
