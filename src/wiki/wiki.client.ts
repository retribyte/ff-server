// Thin client for the wiki's Bucket extension (action=bucket on
// wiki.vortox.space). See PLAN-wiki-cache.md for the reverse-engineered wire
// format. Reads are anonymous — no bot credentials needed.
import { isValidSlug } from "../utils/slug.js";

const WIKI_API_URL = "https://wiki.vortox.space/w/api.php";
const FETCH_TIMEOUT_MS = 4000;

export type WikiBucket = "characters" | "species" | "items";

// Every non-reserved field the EntityStore vocab declares for each bucket
// (Module_EntityStore_vocab.json in the wiki/ project), confirmed live via
// curl. Selecting an undeclared field throws on the wiki side, so this list
// must track the vocab — re-check against it if the wiki schema changes.
// "page_name" is a reserved column, always selected, not in the vocab.
const BUCKET_FIELDS: Record<WikiBucket, string[]> = {
    characters: [
        "page_name", "slug", "fullname", "image", "imagecaption", "aliases",
        "faction", "birthdate", "birthplace", "deathdate", "deathcause",
        "relationship", "planet", "species", "class", "sex", "height",
        "weight", "hair", "eyes", "creator", "author", "season",
    ],
    species: [
        "page_name", "slug", "image1", "caption1", "union_name", "faction",
        "class", "lifespan", "diet", "procreation_method", "habitat",
        "homeworld", "religion", "government", "technology_progression",
        "season",
    ],
    items: [
        "page_name", "slug", "image", "imagecaption", "value",
        "market_value_free", "faction", "rarity", "type", "use", "damage",
        "armor", "character", "age", "location", "season",
    ],
};

// Bucket sizes (30/37/8 rows) are all well under this — a whole-bucket pull
// is always a single request, no pagination needed.
const WHOLE_BUCKET_LIMIT = 500;

type WikiRow = Record<string, unknown>;

// Thrown on transport/API failure (timeout, non-200, wiki-side error) — a
// distinct type from "queried successfully, no row found" so callers never
// mistake a transient outage for a confirmed absence.
export class WikiFetchError extends Error {}

function buildQuery(bucket: WikiBucket, whereSlug: string | undefined, limit: number): string {
    const fields = BUCKET_FIELDS[bucket].map((f) => `"${f}"`).join(",");
    const where = whereSlug !== undefined ? `.where("slug","=","${whereSlug}")` : "";
    // Dots, not colons — the shipped query-builder's __index metamethod
    // double-binds `self` under colon syntax. See PLAN-wiki-cache.md.
    return `mw.ext.bucket("${bucket}").select(${fields})${where}.limit(${limit}).run()`;
}

async function runQuery(bucket: WikiBucket, whereSlug: string | undefined, limit: number): Promise<WikiRow[]> {
    const query = buildQuery(bucket, whereSlug, limit);
    const url = `${WIKI_API_URL}?action=bucket&format=json&query=${encodeURIComponent(query)}`;

    // The whole request, including body parsing, is guarded: a stalled body
    // read can abort mid-stream, and a maintenance/CDN interstitial can come
    // back as 200 HTML instead of JSON — both must surface as WikiFetchError,
    // never propagate raw, so a down wiki can never 500 the API.
    let data: any;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) {
            throw new WikiFetchError(`Wiki request failed: HTTP ${response.status}`);
        }
        data = await response.json();
    } catch (err: any) {
        if (err instanceof WikiFetchError) throw err;
        throw new WikiFetchError(`Wiki request failed: ${err.message}`);
    }

    if (data.error) {
        throw new WikiFetchError(`Wiki bucket query error: ${data.error}`);
    }
    return (data.bucket ?? []) as WikiRow[];
}

// Single-slug lookup — used for cache misses and background refreshes.
// Returns null when the wiki has no matching row (a real negative), throws
// WikiFetchError on any transport/API failure (never a negative).
export async function fetchBucketRow(bucket: WikiBucket, slug: string): Promise<WikiRow | null> {
    if (!isValidSlug(slug)) {
        throw new Error(`Invalid slug for wiki query: '${slug}'`);
    }
    const rows = await runQuery(bucket, slug, 1);
    return rows[0] ?? null;
}

// Whole-bucket pull — used by the refresh script. One request retrieves
// every row given current bucket sizes.
export async function fetchWholeBucket(bucket: WikiBucket): Promise<WikiRow[]> {
    return runQuery(bucket, undefined, WHOLE_BUCKET_LIMIT);
}
