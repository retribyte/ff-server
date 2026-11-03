// Unnamed NPC voices: `[spoken]{?}` spans and `> ?:` lines parse to
// {npc: true} segments and {npcVoice: true} DIALOGUE lines with no speaker,
// identically to the reference Python (story-md-to-api.py), whose output for
// fixtures/stories/npc/npc_voices.md is npc_voices.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseManuscript } from "../src/story/convert/manuscript.js";

const DIR = new URL("./fixtures/stories/npc/", import.meta.url);

test("NPC voices parse like the Python reference", () => {
    const markdown = readFileSync(new URL("npc_voices.md", DIR), "utf8");
    const expected = JSON.parse(readFileSync(new URL("npc_voices.json", DIR), "utf8"));
    assert.deepStrictEqual(parseManuscript(markdown), expected);
});

test("an unnamed NPC voice carries no speaker", () => {
    const markdown = readFileSync(new URL("npc_voices.md", DIR), "utf8");
    const lines = parseManuscript(markdown).chapters[0].lines;
    const npcSegments = lines.flatMap((l) => l.segments ?? []).filter((s) => s.npc);
    assert.ok(npcSegments.length >= 3);
    assert.ok(npcSegments.every((s) => s.speaker === undefined));
    const npcLines = lines.filter((l) => l.npcVoice);
    assert.equal(npcLines.length, 2);
    assert.ok(npcLines.every((l) => l.type === "DIALOGUE" && l.speaker === undefined));
    assert.equal(npcLines[1].text, "Stay close. continued on a second line.");
});
