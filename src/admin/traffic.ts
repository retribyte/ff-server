import type { LogEntry } from "../utils/logger.js";

// Request metrics from the log buffer. Pure and free of the database, so CI (which has no
// DATABASE_URL) can test it: keep db.js out of this module's imports.

const HOUR = 3_600_000;

export type TrafficHour = { hour: string; ok: number; clientErrors: number; serverErrors: number };

export type Traffic = {
    /** Oldest entry still in the log buffer: the hourly series is only complete after this */
    coveredSince: string | null;
    hours: TrafficHour[];
    requests: number;
    clientErrors: number;
    serverErrors: number;
    /** Response time percentiles over the window, ms; null with no requests */
    p50: number | null;
    p95: number | null;
    /** Busiest routes, numeric ids folded to :id and query strings dropped */
    topRoutes: { route: string; count: number }[];
    /** Non-request warnings and errors (caught errors, auth, jobs...) */
    warnings: number;
    errors: number;
};

const percentile = (sorted: number[], p: number) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;

const routeOf = (method: unknown, url: unknown) =>
    `${String(method)} ${String(url).split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id")}`;

/**
 * The last `hours` hours of the log buffer as request metrics: requests per hour by
 * outcome, response time percentiles, busiest routes. Pure, so tests feed it entries.
 */
export function summarizeTraffic(entries: LogEntry[], now: number, hours = 24): Traffic {
    const end = Math.floor(now / HOUR) * HOUR + HOUR; // the end of the current hour
    const start = end - hours * HOUR;
    const buckets: TrafficHour[] = Array.from({ length: hours }, (_, i) => ({
        hour: new Date(start + i * HOUR).toISOString(),
        ok: 0,
        clientErrors: 0,
        serverErrors: 0,
    }));
    const ms: number[] = [];
    const routes = new Map<string, number>();
    let warnings = 0;
    let errors = 0;
    let oldest: string | null = null;

    for (const e of entries) {
        if (!oldest || e.time < oldest) oldest = e.time;
        const t = Date.parse(e.time);
        if (!(t >= start && t < end)) continue;
        if (e.event !== "http") {
            if (e.level === "warn") warnings++;
            else if (e.level === "error") errors++;
            continue;
        }
        const b = buckets[Math.floor((t - start) / HOUR)];
        const status = Number(e.status);
        if (status >= 500) b.serverErrors++;
        else if (status >= 400) b.clientErrors++;
        else b.ok++;
        if (typeof e.ms === "number") ms.push(e.ms);
        const route = routeOf(e.method, e.url);
        routes.set(route, (routes.get(route) ?? 0) + 1);
    }

    ms.sort((a, b) => a - b);
    const sum = (k: keyof Omit<TrafficHour, "hour">) => buckets.reduce((n, b) => n + b[k], 0);
    return {
        coveredSince: oldest,
        hours: buckets,
        requests: sum("ok") + sum("clientErrors") + sum("serverErrors"),
        clientErrors: sum("clientErrors"),
        serverErrors: sum("serverErrors"),
        p50: percentile(ms, 50),
        p95: percentile(ms, 95),
        topRoutes: [...routes]
            .map(([route, count]) => ({ route, count }))
            .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
            .slice(0, 6),
        warnings,
        errors,
    };
}
