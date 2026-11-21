import { prisma } from "../db.js";
import { queryLogs } from "../utils/logger.js";
import { summarizeTraffic } from "./traffic.js";

export type { Traffic, TrafficHour } from "./traffic.js";

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the admin dashboard charts, in one call. `days` is the views/jobs window. */
export async function getAdminMetrics(days: number) {
    const now = Date.now();
    const since = new Date(now - (days - 1) * DAY);
    since.setUTCHours(0, 0, 0, 0);
    const before = new Date(since.getTime() - days * DAY);

    const [viewDays, previous, jobs, episodes, messages, stories, characters, items, users, notes, portraits] = await Promise.all([
        prisma.viewCount.groupBy({ by: ["day"], where: { day: { gte: since } }, _sum: { member: true, anonymous: true } }),
        prisma.viewCount.aggregate({ where: { day: { gte: before, lt: since } }, _sum: { member: true, anonymous: true } }),
        prisma.jobRun.groupBy({ by: ["status", "dryRun"], where: { startedAt: { gte: since } }, _count: { _all: true } }),
        prisma.episode.count(),
        prisma.message.count(),
        prisma.story.count(),
        prisma.character.count(),
        prisma.item.count(),
        prisma.user.count(),
        prisma.commentary.count(),
        prisma.portrait.count(),
    ]);

    // One row per day, days with no views included
    const byDay = new Map(viewDays.map((v) => [dayKey(v.day), v._sum]));
    const views = Array.from({ length: days }, (_, i) => {
        const day = dayKey(new Date(since.getTime() + i * DAY));
        const s = byDay.get(day);
        return { day, member: s?.member ?? 0, anonymous: s?.anonymous ?? 0 };
    });

    const runs = { succeeded: 0, failed: 0, running: 0, dryRuns: 0 };
    for (const j of jobs) {
        const n = j._count._all;
        if (j.status === "FAILED") runs.failed += n;
        else if (j.status === "RUNNING") runs.running += n;
        else if (j.dryRun) runs.dryRuns += n;
        else runs.succeeded += n;
    }

    return {
        days,
        views,
        previousViews: (previous._sum.member ?? 0) + (previous._sum.anonymous ?? 0),
        runs,
        archive: { episodes, messages, stories, characters, items, users, notes, portraits },
        traffic: summarizeTraffic(queryLogs({ level: "debug", limit: 2000 }), now),
    };
}

export type AdminMetrics = Awaited<ReturnType<typeof getAdminMetrics>>;
