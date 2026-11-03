// Species live on the wiki (wiki.vortox.space), not in this DB. These reads
// serve what the wiki cache holds for the "species" bucket, for clients like
// a future bot. Cache-only on purpose: getWikiData's live fetch on a miss is
// safe for characters/items, whose slugs come from DB rows, but species have
// no table, so a miss here would let any request write a cache row.
// `npm run refresh:wiki-cache` keeps the rows fresh.
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BUCKET = "species";

type CachedSpecies = { slug: string; data: Prisma.JsonValue; fetchedAt: Date };

function toSpecies(row: CachedSpecies) {
    const data = row.data as Record<string, unknown>;
    const name = typeof data.page_name === "string" ? data.page_name : row.slug;
    return { slug: row.slug, name, fetchedAt: row.fetchedAt, data };
}

// Every cached species with wiki data (negative entries left out), by slug.
// `search` matches the slug or the wiki page name, case-insensitively.
async function getAllSpecies(search?: string) {
    const rows = await prisma.wikiCache.findMany({
        where: { bucket: BUCKET, data: { not: Prisma.DbNull } },
        orderBy: { slug: "asc" },
    });
    const species = rows.map(toSpecies);
    const query = search?.trim().toLowerCase();
    if (!query) return species;
    return species.filter((s) => s.slug.includes(query) || s.name.toLowerCase().includes(query));
}

// null when the slug isn't cached, or is cached as absent from the wiki
async function getSpeciesBySlug(slug: string) {
    const row = await prisma.wikiCache.findUnique({ where: { bucket_slug: { bucket: BUCKET, slug } } });
    if (!row || row.data === null) return null;
    return toSpecies(row);
}

export default { getAllSpecies, getSpeciesBySlug };
