// Pictures in stories: the docx converter's `![alt](docx:N)` lines (behind
// meta.images, so the golden manuscripts stay the Python CLI's), and the
// manuscript syntax for IMAGE lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertDocx } from "../src/story/convert/index.js";
import { parseManuscript } from "../src/story/convert/manuscript.js";

const DIR = new URL("./fixtures/stories/docx/", import.meta.url);
const docx = (slug: string) => new Uint8Array(readFileSync(new URL(`${slug}.docx`, DIR)));
const fixture = (slug: string) => JSON.parse(readFileSync(new URL(`${slug}.meta.json`, DIR), "utf8"));
const imageLines = (payload: ReturnType<typeof parseManuscript>) =>
    payload.chapters.flatMap((c) => c.lines).filter((l) => l.type === "IMAGE");

test("without meta.images, pictures are left out (the CLI's output)", () => {
    const { meta } = fixture("bellows_journal_and_audio_logs");
    const result = convertDocx(docx("bellows_journal_and_audio_logs"), meta);
    assert.equal(imageLines(result.payload).length, 0);
    assert.deepEqual(result.pictures, []);
    assert.equal(result.markdown, readFileSync(new URL("bellows_journal_and_audio_logs.md", DIR), "utf8"));
});

test("with meta.images, each picture becomes an IMAGE line, with its bytes alongside", () => {
    const { meta } = fixture("bellows_journal_and_audio_logs");
    const result = convertDocx(docx("bellows_journal_and_audio_logs"), { ...meta, images: true });
    const images = imageLines(result.payload);
    assert.deepEqual(images.map((l) => l.docxPicture), [1, 2, 3, 4, 5]);
    assert.equal(result.pictures.length, 5);
    for (const picture of result.pictures) {
        assert.ok(picture.contentType?.startsWith("image/"), `picture ${picture.n} type`);
        assert.ok(picture.data && Buffer.from(picture.data, "base64").length > 1000);
    }
    // text lines are unchanged: only IMAGE lines were added
    const plain = convertDocx(docx("bellows_journal_and_audio_logs"), meta);
    const strip = (r: typeof result) => r.payload.chapters.map((c) => c.lines.filter((l) => l.type !== "IMAGE"));
    assert.deepEqual(strip(result), strip(plain));
});

test("Deafening Silence ends on its picture", () => {
    const { meta } = fixture("deafening_silence");
    const result = convertDocx(docx("deafening_silence"), { ...meta, images: true });
    const lines = result.payload.chapters.at(-1)!.lines;
    assert.equal(lines.at(-1)!.type, "IMAGE");
    assert.match(lines.at(-2)!.text, /nothing but silence/);
});

test("manuscript image lines: booru posts and docx placeholders", () => {
    const payload = parseManuscript(
        ["---", "slug: pics", "title: Pics", "---", "", "Before.", "![A star chart](booru:1234)", "", "![](docx:2)", "After."].join("\n")
    );
    assert.deepEqual(payload.chapters[0].lines, [
        { type: "NARRATION", text: "Before." },
        { type: "IMAGE", text: "A star chart", booruId: 1234 },
        { type: "IMAGE", text: "", docxPicture: 2 },
        { type: "NARRATION", text: "After." },
    ]);
});
