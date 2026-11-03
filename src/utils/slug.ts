// Slugs identify entities across sites and must match the wiki's derivation
// from an article title: accented letters are transliterated to plain Latin
// (à→a, é→e, ß→ss, æ→ae, ø→o, ł→l), not dropped; lowercase; each run of
// spaces or hyphens becomes a single underscore; apostrophes and periods (and
// other punctuation, plus anything with no Latin form, e.g. CJK or emoji) are
// dropped; doubled underscores collapse. Mirrored by ff-site's
// `src/lib/slug.ts` and `archive-to-markdown/story-docx-to-md.py` — keep all
// three identical.

export const SLUG_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

// Latin letters that NFKD doesn't decompose into a base letter + mark.
const TRANSLITERATIONS: Record<string, string> = {
    ß: "ss",
    æ: "ae",
    œ: "oe",
    ø: "o",
    ł: "l",
    đ: "d",
    ð: "d",
    þ: "th",
    ı: "i",
};

export function slugify(input: string): string {
    return input
        .normalize("NFKD") // à -> a + U+0300; ligatures like ﬁ -> fi
        .replace(/\p{M}+/gu, "") // drop the combining marks
        .toLowerCase()
        .replace(/[ßæœøłđðþı]/g, (c) => TRANSLITERATIONS[c])
        .replace(/[\s-]+/g, "_")
        .replace(/[^a-z0-9_]+/g, "")
        .replace(/_+/g, "_")
        .replace(/(^_|_$)/g, "");
}

export function isValidSlug(input: string): boolean {
    return SLUG_PATTERN.test(input);
}

/**
 * Normalizes a legacy hyphenated slug segment (pre-migration bookmark style)
 * to the current underscore convention, e.g. "shady-business" ->
 * "shady_business". Mirrors ff-site's `src/lib/slug.ts`.
 */
export function normalizeSlug(slug: string): string {
    return slug.replace(/-/g, "_");
}
