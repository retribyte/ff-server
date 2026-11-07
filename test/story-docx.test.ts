// Golden test: the TypeScript docx converter must reproduce the reference
// Python (story-docx-to-md.py) output for the 23 Drive stories — markdown
// byte-for-byte and the same warnings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import { docxToManuscript, DocxError, frontmatter, loadDocument } from "../src/story/convert/docx.js";
import { parseManuscript } from "../src/story/convert/manuscript.js";

const DIR = new URL("./fixtures/stories/docx/", import.meta.url);
const slugs = readdirSync(DIR).filter((f) => f.endsWith(".docx")).map((f) => f.slice(0, -5));

test("fixture set is complete", () => assert.equal(slugs.length, 23));

for (const slug of slugs) {
    test(`docx → manuscript: ${slug}`, () => {
        const { meta, warnings } = JSON.parse(readFileSync(new URL(`${slug}.meta.json`, DIR), "utf8"));
        const expected = readFileSync(new URL(`${slug}.md`, DIR), "utf8");
        const result = docxToManuscript(new Uint8Array(readFileSync(new URL(`${slug}.docx`, DIR))), meta);
        assert.equal(result.markdown, expected);
        assert.deepStrictEqual(result.warnings, warnings);
        // and the manuscript it writes parses cleanly
        assert.ok(parseManuscript(result.markdown).chapters.length > 0);
    });
}

test("refuses things that aren't a usable docx", () => {
    assert.throws(() => loadDocument(new Uint8Array([1, 2, 3])), DocxError);
    assert.throws(() => loadDocument(zipSync({ "hello.txt": strToU8("hi") })), /not a \.docx/);
    const dtd = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
    assert.throws(() => loadDocument(zipSync({ "word/document.xml": strToU8(dtd) })), /DTD/);
});

test("frontmatter writes canon: no only for a non-canon story, and it round-trips", () => {
    const canon = frontmatter({ slug: "x", title: "T", colors: {} });
    assert.ok(!canon.some((line) => line.startsWith("canon")));
    const nonCanon = frontmatter({ slug: "x", title: "T", canon: false, colors: {} });
    assert.ok(nonCanon.includes("canon: no"));
    assert.equal(parseManuscript([...nonCanon, "Hi."].join("\n")).story.canon, false);
});
