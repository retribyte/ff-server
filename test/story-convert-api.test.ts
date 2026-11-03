// The web importer's conversion entry points (src/story/convert/index.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeDocx, convertDocx, ManuscriptError } from "../src/story/convert/index.js";

const DIR = new URL("./fixtures/stories/docx/", import.meta.url);
const docx = (slug: string) => new Uint8Array(readFileSync(new URL(`${slug}.docx`, DIR)));
const fixture = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}.meta.json`, DIR), "utf8"));

test("analysis lists every color, most used first, and counts pictures", () => {
    const a = analyzeDocx(docx("bellows_journal_and_audio_logs"), "Bellow_s Journal and Audio Logs.docx");
    const { meta } = fixture("bellows_journal_and_audio_logs");
    assert.deepEqual(new Set(a.colors.map((c) => c.color)), new Set(Object.keys(meta.colors)));
    assert.ok(a.colors.every((c, i) => i === 0 || a.colors[i - 1].count >= c.count));
    assert.equal(a.pictures, 5);
    assert.equal(a.defaults.slug, "bellow_s_journal_and_audio_logs");
});

test("conversion matches the golden manuscript and parses into a payload", () => {
    const { meta, warnings } = fixture("still_waters");
    const result = convertDocx(docx("still_waters"), meta);
    assert.equal(result.markdown, readFileSync(new URL("still_waters.md", DIR), "utf8"));
    assert.deepEqual(result.warnings, warnings);
    assert.equal(result.payload.story.slug, "still_waters");
    assert.equal(result.payload.chapters.length, 2);
});

test("a color mapped to null or an empty name is narration", () => {
    const { meta } = fixture("still_waters");
    const colors = Object.fromEntries(Object.keys(meta.colors).map((c) => [c, null]));
    const { payload } = convertDocx(docx("still_waters"), { ...meta, colors: { ...colors, [Object.keys(colors)[0]]: "" } });
    const voiced = payload.chapters.flatMap((c) => c.lines).flatMap((l) => l.segments ?? []).filter((s) => s.speaker);
    assert.equal(voiced.length, 0);
});

test("refuses unmapped colors and markup in names or metadata", () => {
    const { meta } = fixture("still_waters");
    const [first, ...rest] = Object.keys(meta.colors);
    assert.throws(() => convertDocx(docx("still_waters"), { ...meta, colors: Object.fromEntries(rest.map((c) => [c, "X"])) }), /unmapped: #/);
    assert.throws(() => convertDocx(docx("still_waters"), { ...meta, colors: { ...meta.colors, [first]: "Zi]on" } }), ManuscriptError);
    assert.throws(() => convertDocx(docx("still_waters"), { ...meta, title: "Two\nlines" }), /one line/);
});
