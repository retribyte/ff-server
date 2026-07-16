// Slugs identify entities across sites and must match the wiki's derivation
// from an article title: lowercase; each run of spaces or hyphens becomes a
// single underscore; apostrophes and periods (and other punctuation) are
// dropped; doubled underscores collapse. Note this diverges from ff-site's
// hyphenated URL slugs in `src/lib/seasons.ts`; the frontend will be updated.

export const SLUG_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/[^a-z0-9_]+/g, "")
        .replace(/_+/g, "_")
        .replace(/(^_|_$)/g, "");
}

export function isValidSlug(input: string): boolean {
    return SLUG_PATTERN.test(input);
}
