import { ViewKind } from "@prisma/client";
import { prisma } from "../db.js";

export const VIEW_KINDS: Record<string, ViewKind> = { episode: ViewKind.EPISODE, story: ViewKind.STORY };

/** Whether an episode or story with this slug exists. */
async function targetExists(kind: ViewKind, slug: string): Promise<boolean> {
    const where = { slug };
    const row =
        kind === ViewKind.EPISODE
            ? await prisma.episode.findUnique({ where, select: { slug: true } })
            : await prisma.story.findUnique({ where, select: { slug: true } });
    return row !== null;
}

/**
 * Adds one view to today's (UTC) counter for an episode or story: `member` when a
 * signed-in user viewed it, `anonymous` otherwise. Returns false when there is no
 * such episode or story. One atomic upsert, so concurrent views don't lose counts.
 */
async function recordView(kind: ViewKind, slug: string, signedIn: boolean): Promise<boolean> {
    if (!(await targetExists(kind, slug))) return false;
    const member = signedIn ? 1 : 0;
    await prisma.$executeRaw`
        INSERT INTO view_counts (kind, slug, day, member, anonymous)
        VALUES (${kind}::"ViewKind", ${slug}, (now() AT TIME ZONE 'utc')::date, ${member}, ${1 - member})
        ON CONFLICT (kind, slug, day)
        DO UPDATE SET member = view_counts.member + ${member}, anonymous = view_counts.anonymous + ${1 - member}`;
    return true;
}

export type ViewTotal = { kind: ViewKind; slug: string; title: string; member: number; anonymous: number };

/** Views per episode and story over the last `days` days (UTC), most viewed first. */
async function getViewTotals(days: number, kind?: ViewKind, limit = 50): Promise<ViewTotal[]> {
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const sums = await prisma.viewCount.groupBy({
        by: ["kind", "slug"],
        where: { day: { gte: since }, ...(kind ? { kind } : {}) },
        _sum: { member: true, anonymous: true },
    });
    const totals = sums
        .map((s) => ({ kind: s.kind, slug: s.slug, member: s._sum.member ?? 0, anonymous: s._sum.anonymous ?? 0 }))
        .sort((a, b) => b.member + b.anonymous - (a.member + a.anonymous) || a.slug.localeCompare(b.slug))
        .slice(0, limit);
    const [episodes, stories] = await Promise.all([
        prisma.episode.findMany({ where: { slug: { in: totals.filter((t) => t.kind === ViewKind.EPISODE).map((t) => t.slug) } }, select: { slug: true, title: true } }),
        prisma.story.findMany({ where: { slug: { in: totals.filter((t) => t.kind === ViewKind.STORY).map((t) => t.slug) } }, select: { slug: true, title: true } }),
    ]);
    const titles = new Map([
        ...episodes.map((e) => [`${ViewKind.EPISODE}:${e.slug}`, e.title] as const),
        ...stories.map((s) => [`${ViewKind.STORY}:${s.slug}`, s.title] as const),
    ]);
    return totals.map((t) => ({ ...t, title: titles.get(`${t.kind}:${t.slug}`) ?? t.slug }));
}

export default { recordView, getViewTotals };
