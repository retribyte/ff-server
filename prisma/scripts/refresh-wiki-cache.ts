/**
 * Whole-bucket refresh of the wiki cache (see docs/notes/PLAN-wiki-cache.md). One
 * `.limit(500).run()` pull per bucket retrieves every row given current
 * bucket sizes (characters 58, species 43, items 9 as of 2026-10) — no
 * pagination needed.
 * Upserts a positive entry for every row the wiki returns, and a negative
 * entry for every DB slug that didn't come back — negatives and positives
 * fall out of the same pass. Standalone script; cron/schedule wiring is a
 * separate future decision.
 */
import { prisma } from "../../src/db.js";
import { fetchFileUrl, fetchPageIntro, fetchWholeBucket, MAP_BUCKETS, WikiBucket } from "../../src/wiki/wiki.client.js";
import { sanitizeRow, upsertCacheEntry } from "../../src/wiki/wiki.service.js";


const BUCKETS: { bucket: WikiBucket; getDbSlugs: () => Promise<string[]> }[] = [
    {
        bucket: "characters",
        getDbSlugs: async () => (await prisma.character.findMany({ select: { slug: true } })).map((r) => r.slug),
    },
    {
        // Species have no DB table: the slugs already cached are the ones to
        // check, so a species deleted from the wiki turns into a negative entry
        bucket: "species",
        getDbSlugs: async () =>
            (await prisma.wikiCache.findMany({ where: { bucket: "species" }, select: { slug: true } })).map((r) => r.slug),
    },
    {
        bucket: "items",
        getDbSlugs: async () => (await prisma.item.findMany({ select: { slug: true } })).map((r) => r.slug),
    },
    // The galaxy map's buckets, like species, are read from the cache only: the slugs
    // already cached are the ones to check for pages deleted from the wiki
    ...MAP_BUCKETS.map((bucket) => ({
        bucket,
        getDbSlugs: async () => (await prisma.wikiCache.findMany({ where: { bucket }, select: { slug: true } })).map((r) => r.slug),
    })),
];
const isMapBucket = (bucket: WikiBucket) => (MAP_BUCKETS as readonly string[]).includes(bucket);

async function refreshBucket({ bucket, getDbSlugs }: (typeof BUCKETS)[number]) {
    console.log(`\n=== ${bucket} ===`);

    const rows = await fetchWholeBucket(bucket);
    const wikiSlugs = new Set<string>();
    let positives = 0;

    for (const row of rows) {
        const slug = row.slug;
        if (typeof slug !== "string" || !slug) {
            console.warn(`  Skipping ${bucket} row with no slug (page_name: ${row.page_name ?? "?"})`);
            continue;
        }
        wikiSlugs.add(slug);
        // The map shows each article's opening under the place's own description
        // and its picture, by the file host's address
        if (isMapBucket(bucket) && typeof row.page_name === "string") row.intro = await fetchPageIntro(row.page_name);
        if (isMapBucket(bucket)) row.image_url = typeof row.image === "string" && row.image ? await fetchFileUrl(row.image) : null;
        await upsertCacheEntry(bucket, slug, sanitizeRow(row));
        positives++;
    }
    console.log(`  ${positives} positive entr${positives === 1 ? "y" : "ies"} upserted.`);

    const dbSlugs = await getDbSlugs();
    let negatives = 0;
    for (const slug of dbSlugs) {
        if (wikiSlugs.has(slug)) continue;
        await upsertCacheEntry(bucket, slug, null);
        negatives++;
    }
    console.log(`  ${negatives} negative entr${negatives === 1 ? "y" : "ies"} upserted (of ${dbSlugs.length} DB slugs).`);
}

async function main() {
    for (const spec of BUCKETS) await refreshBucket(spec);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
