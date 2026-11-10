import { Prisma } from "@prisma/client";

// Options for the paginated search categories (GET /search?category=...).
// sort "relevance" ranks by ts_rank; "appearance" walks the archive in order:
// campaigns FF1, FF2, ... first (by number), then the rest by title, then
// episode/story position. `dir` only applies to "appearance".
export type SearchSort = "relevance" | "appearance";
export type SearchOptions = {
    sort?: SearchSort;
    dir?: "asc" | "desc";
    /** Season slugs to leave out */
    exclude?: string[];
};

export function parseSearchOptions(query: Record<string, unknown>): SearchOptions {
    const sort = query.sort === "appearance" ? "appearance" : "relevance";
    const dir = query.dir === "desc" ? "desc" : "asc";
    const exclude =
        typeof query.exclude === "string"
            ? query.exclude
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
            : [];
    return { sort, dir, exclude };
}

/**
 * ORDER BY keys for a season title column, in seasonOrder() terms (ff-site
 * src/lib/seasons.ts): FF campaigns by number, then others by title, no
 * season last. `col` is trusted SQL (a column reference), never user input.
 */
export function seasonOrderKeys(col: string, dir: "asc" | "desc"): Prisma.Sql {
    const d = Prisma.raw(dir === "desc" ? "DESC" : "ASC");
    const c = Prisma.raw(col);
    return Prisma.sql`(CASE WHEN ${c} IS NULL THEN 2 WHEN ${c} ~ '^FF[0-9]+$' THEN 0 ELSE 1 END) ${d},
        (substring(${c} from '^FF([0-9]+)$'))::int ${d} NULLS LAST,
        ${c} ${d}`;
}

export function direction(dir: "asc" | "desc" | undefined): Prisma.Sql {
    return Prisma.raw(dir === "desc" ? "DESC" : "ASC");
}
