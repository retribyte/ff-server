// The slug rule is shared verbatim with ff-site (src/lib/slug.ts), the docx
// CLI (archive-to-markdown/story-docx-to-md.py) and the wiki
// (Final Frontier Wiki:Slugs). Keep these cases in step with those copies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSlug, slugify } from "../src/utils/slug.js";

const CASES: [string, string][] = [
    // Accented letters are transliterated, not dropped
    ["Volentinà Constantini", "volentina_constantini"],
    ["Touché", "touche"],
    ["Straße", "strasse"],
    ["Søren Ærø", "soren_aero"],
    ["Łukasz", "lukasz"],
    ["Œuvre", "oeuvre"],
    ["Þórr Đorđe", "thorr_dorde"],
    ["ﬁnal ﬂight", "final_flight"],
    ["İstanbul", "istanbul"],
    // Unchanged ASCII behavior
    ["Don't", "dont"],
    ["Mickey Mouse’s Ghost", "mickey_mouses_ghost"],
    ["-- a  b --", "a_b"],
    ["Shady Business", "shady_business"],
    ["Dr. Ka'lel", "dr_kalel"],
    ["Mr. T-1000", "mr_t_1000"],
    ["a__b", "a_b"],
    ["Truth & Lies", "truth_lies"],
    // No Latin form: still dropped (callers fall back when empty)
    ["日本", ""],
    ["Zion 🚀 Daybreaker", "zion_daybreaker"],
];

for (const [input, expected] of CASES) {
    test(`slugify(${JSON.stringify(input)}) = ${JSON.stringify(expected)}`, () => {
        const slug = slugify(input);
        assert.equal(slug, expected);
        if (slug) assert.ok(isValidSlug(slug), `${slug} matches SLUG_PATTERN`);
    });
}
