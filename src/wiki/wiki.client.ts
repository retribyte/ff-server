// Thin client for the wiki's Bucket extension (action=bucket on
// wiki.vortox.space). See PLAN-wiki-cache.md for the reverse-engineered wire
// format. Reads are anonymous — no bot credentials needed.
import { isValidSlug } from "../utils/slug.js";

const WIKI_API_URL = "https://wiki.vortox.space/w/api.php";
const FETCH_TIMEOUT_MS = 4000;

export type WikiBucket = "characters" | "species" | "items";

// Which fields to pull comes from the wiki itself: each bucket's schema is a
// public JSON page, Bucket:<name> ({field: {type, repeated?, ...}}), which
// is exactly what Bucket validates a query's .select() against. Adding,
// removing, or renaming a wiki field needs no change here.
//
// Fields never cached, whatever bucket they turn up in — the site has its
// own images for every record. Everything else is pulled.
const EXCLUDED_FIELDS = new Set(["image", "image1", "imagecaption", "caption1"]);

// Schemas change rarely; re-read at most this often
const SCHEMA_TTL_MS = 60 * 60 * 1000;
// Field names get interpolated into a Lua query run on the wiki
const FIELD_NAME = /^[a-z0-9_]+$/i;

const schemaCache = new Map<WikiBucket, { fields: string[]; fetchedAt: number }>();
const schemaFetches = new Map<WikiBucket, Promise<string[]>>();

async function fetchSchemaFields(bucket: WikiBucket): Promise<string[]> {
    const url = new URL(WIKI_API_URL);
    url.search = new URLSearchParams({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        formatversion: "2",
        format: "json",
        titles: `Bucket:${bucket}`,
    }).toString();

    let content: string | undefined;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!response.ok) throw new WikiFetchError(`Bucket schema request failed: HTTP ${response.status}`);
        const data: any = await response.json();
        content = data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
    } catch (err: any) {
        if (err instanceof WikiFetchError) throw err;
        throw new WikiFetchError(`Bucket schema request failed: ${err.message}`);
    }
    if (typeof content !== "string") throw new WikiFetchError(`No schema page for bucket '${bucket}'`);

    let schema: Record<string, unknown>;
    try {
        schema = JSON.parse(content);
    } catch {
        throw new WikiFetchError(`Bucket '${bucket}' schema isn't valid JSON`);
    }
    // slug is how every row is matched to a DB record
    if (!("slug" in schema)) throw new WikiFetchError(`Bucket '${bucket}' has no slug field`);

    const fields = Object.keys(schema).filter((field) => FIELD_NAME.test(field) && !EXCLUDED_FIELDS.has(field));
    // page_name is a reserved column on every bucket, not in the schema page
    return ["page_name", ...fields];
}

/**
 * The fields to select from a bucket, from its schema page (cached for an
 * hour). If the wiki can't be asked, the last list read is reused; with
 * none yet, this throws WikiFetchError like any other wiki outage.
 */
async function getBucketFields(bucket: WikiBucket): Promise<string[]> {
    const cached = schemaCache.get(bucket);
    if (cached && Date.now() - cached.fetchedAt < SCHEMA_TTL_MS) return cached.fields;

    let pending = schemaFetches.get(bucket);
    if (!pending) {
        pending = fetchSchemaFields(bucket).finally(() => schemaFetches.delete(bucket));
        schemaFetches.set(bucket, pending);
    }
    try {
        const fields = await pending;
        schemaCache.set(bucket, { fields, fetchedAt: Date.now() });
        return fields;
    } catch (err) {
        if (cached) {
            console.warn(`Using last known fields for bucket '${bucket}': ${(err as Error).message}`);
            return cached.fields;
        }
        throw err;
    }
}

// Bucket sizes (58/43/9 rows as of 2026-10) are all well under this — a whole-bucket pull
// is always a single request, no pagination needed.
const WHOLE_BUCKET_LIMIT = 500;

type WikiRow = Record<string, unknown>;

// Thrown on transport/API failure (timeout, non-200, wiki-side error) — a
// distinct type from "queried successfully, no row found" so callers never
// mistake a transient outage for a confirmed absence.
export class WikiFetchError extends Error {}

function buildQuery(bucket: WikiBucket, fieldNames: string[], whereSlug: string | undefined, limit: number): string {
    const fields = fieldNames.map((f) => `"${f}"`).join(",");
    const where = whereSlug !== undefined ? `.where("slug","=","${whereSlug}")` : "";
    // Dots, not colons — the shipped query-builder's __index metamethod
    // double-binds `self` under colon syntax. See PLAN-wiki-cache.md.
    return `mw.ext.bucket("${bucket}").select(${fields})${where}.limit(${limit}).run()`;
}

async function runQuery(bucket: WikiBucket, whereSlug: string | undefined, limit: number): Promise<WikiRow[]> {
    const query = buildQuery(bucket, await getBucketFields(bucket), whereSlug, limit);
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
