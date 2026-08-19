/**
 * Whole-bucket refresh of the wiki cache (see PLAN-wiki-cache.md). One
 * `.limit(500).run()` pull per bucket retrieves every row given current
 * bucket sizes (characters 30, species 37, items 8) — no pagination needed.
 * Upserts a positive entry for every row the wiki returns, and a negative
 * entry for every DB slug that didn't come back — negatives and positives
 * fall out of the same pass. Standalone script; cron/schedule wiring is a
 * separate future decision.
 */
import { PrismaClient } from "@prisma/client";
import { fetchWholeBucket, WikiBucket } from "../src/wiki/wiki.client.js";
import { sanitizeRow, upsertCacheEntry } from "../src/wiki/wiki.service.js";

const prisma = new PrismaClient();

const BUCKETS: { bucket: WikiBucket; getDbSlugs: () => Promise<string[]> }[] = [
    {
        bucket: "characters",
        getDbSlugs: async () => (await prisma.character.findMany({ select: { slug: true } })).map((r) => r.slug),
    },
    {
        bucket: "species",
        getDbSlugs: async () => (await prisma.species.findMany({ select: { slug: true } })).map((r) => r.slug),
    },
    {
        bucket: "items",
        getDbSlugs: async () => (await prisma.item.findMany({ select: { slug: true } })).map((r) => r.slug),
    },
];

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
