// Golden test: the TypeScript manuscript parser must produce exactly what the
// reference Python (story-md-to-api.py) produced for all 37 reviewed manuscripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseManuscript, ManuscriptError } from "../src/story/convert/manuscript.js";

const DIR = new URL("./fixtures/stories/manuscripts/", import.meta.url);
const slugs = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));

test("fixture set is complete", () => assert.equal(slugs.length, 37));

for (const slug of slugs) {
    test(`manuscript → payload: ${slug}`, () => {
        const markdown = readFileSync(new URL(`${slug}.md`, DIR), "utf8");
        const expected = JSON.parse(readFileSync(new URL(`${slug}.json`, DIR), "utf8"));
        assert.deepStrictEqual(parseManuscript(markdown), expected);
    });
}

test("frontmatter keeps a # inside a value; a spaced # starts a comment", () => {
    const { story } = parseManuscript("---\nslug: x\ntitle: A # comment\nthemeColor: '#e8b23b'\n---\n\nHi.\n");
    assert.equal(story.title, "A");
    assert.equal(story.themeColor, "#e8b23b");
});

test("errors are ManuscriptErrors", () => {
    assert.throws(() => parseManuscript("no frontmatter"), ManuscriptError);
    assert.throws(() => parseManuscript("---\nslug: x\ntitle: T\n---\n# Chapter 1\nA\n# Chapter 1\nB\n"), /duplicate chapter number 1/);
});

test("canon: no marks a story non-canon; omitted leaves it out of the payload", () => {
    assert.equal(parseManuscript("---\nslug: x\ntitle: T\ncanon: no\n---\n\nHi.\n").story.canon, false);
    assert.equal(parseManuscript("---\nslug: x\ntitle: T\ncanon: Yes\n---\n\nHi.\n").story.canon, true);
    assert.equal("canon" in parseManuscript("---\nslug: x\ntitle: T\n---\n\nHi.\n").story, false);
    assert.throws(() => parseManuscript("---\nslug: x\ntitle: T\ncanon: maybe\n---\n\nHi.\n"), /canon must be one of/);
});
