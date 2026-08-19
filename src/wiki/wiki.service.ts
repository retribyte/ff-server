// Cache-aside read path over the wiki's Bucket data. See PLAN-wiki-cache.md.
import { Prisma, PrismaClient } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { fetchBucketRow, WikiBucket, WikiFetchError } from "./wiki.client.js";

const prisma = new PrismaClient();

const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(fetchedAt: Date, isNegative: boolean): boolean {
    const ttl = isNegative ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
    return Date.now() - fetchedAt.getTime() > ttl;
}

// Wiki text fields carry raw wikitext debris (`{{Icon|Duckett}}`,
// `<small>`, stray `[[...]]`) — sanitizeText only strips HTML tags, not
// wikitext syntax, so template invocations and page links need their own
// pass. This is deliberately a couple of regexes, not a wikitext parser
// (out of scope per PLAN-wiki-cache.md) — good enough to keep debris out of
// display strings, not a faithful render.
function stripWikitextDebris(text: string): string {
    return text
        .replace(/\{\{[^{}]*\}\}/g, "")
        // File/Image embeds (e.g. the rendered {{Icon|Duckett}} in
        // items.value) carry no display text worth keeping — the general
        // [[A|B]] -> B unwrap below would otherwise turn them into
        // "16px|link=|alt=Duckett" garbage.
        .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1");
}

function sanitizeValue(value: unknown): unknown {
    if (typeof value === "string") return sanitizeText(stripWikitextDebris(value)).trim();
    if (Array.isArray(value)) return value.map(sanitizeValue);
    return value;
}

// Applied once, at cache-write time (here and in refresh-wiki-cache.ts) —
// not on every read.
export function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) clean[key] = sanitizeValue(value);
    return clean;
}

// Exported for the refresh script, which does its own bulk upserts rather
// than going through getWikiData's single-slug cache-aside path.
export async function upsertCacheEntry(bucket: WikiBucket, slug: string, data: Record<string, unknown> | null) {
    const jsonData = data === null ? Prisma.DbNull : (data as Prisma.InputJsonValue);
    await prisma.wikiCache.upsert({
        where: { bucket_slug: { bucket, slug } },
        create: { bucket, slug, data: jsonData },
        update: { data: jsonData, fetchedAt: new Date() },
    });
}

// Fire-and-forget refresh of a single slug. Never throws — a down wiki must
// never take out the API server (Node kills the process on an unhandled
// rejection), and a transient failure should leave the existing cache entry
// (stale or not) untouched rather than being mistaken for a confirmed
// absence.
async function refreshSlug(bucket: WikiBucket, slug: string): Promise<void> {
    try {
        const row = await fetchBucketRow(bucket, slug);
        await upsertCacheEntry(bucket, slug, row ? sanitizeRow(row) : null);
    } catch (err) {
        if (err instanceof WikiFetchError) {
            console.error(`Wiki refresh failed for ${bucket}/${slug}: ${err.message}`);
            return;
        }
        throw err;
    }
}

// Cache-aside read: never blocks a response on a live wiki refresh.
//   - Cached (even if stale): return immediately; kick a background refresh
//     if stale, don't await it.
//   - True miss (row never seen): one live fetch with a short timeout,
//     upsert the result (or a negative entry on a confirmed empty result —
//     never on a transport failure), return it.
export async function getWikiData(bucket: WikiBucket, slug: string): Promise<Record<string, unknown> | null> {
    const cached = await prisma.wikiCache.findUnique({ where: { bucket_slug: { bucket, slug } } });

    if (cached) {
        if (isStale(cached.fetchedAt, cached.data === null)) {
            refreshSlug(bucket, slug).catch((err) => console.error(`Unexpected error refreshing ${bucket}/${slug}:`, err));
        }
        return cached.data as Record<string, unknown> | null;
    }

    try {
        const row = await fetchBucketRow(bucket, slug);
        const data = row ? sanitizeRow(row) : null;
        await upsertCacheEntry(bucket, slug, data);
        return data;
    } catch (err) {
        if (err instanceof WikiFetchError) {
            console.error(`Wiki fetch failed for ${bucket}/${slug}: ${err.message}`);
            return null;
        }
        throw err;
    }
}
