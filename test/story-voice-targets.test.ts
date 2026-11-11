// Re-voicing a quote a character already speaks is admin-only and logged:
// targetsCharacterVoice decides which requests that covers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { targetedLines, targetsCharacterVoice, type StoredVoices } from "../src/story/voice-targets.js";

const stored: StoredVoices[] = [
    // a DIALOGUE line Emmett (id 7) speaks
    { chapterNo: 1, lineNo: 3, characterId: 7, segments: [] },
    // an NPC DIALOGUE line (an NPC persona, no character)
    { chapterNo: 1, lineNo: 4, characterId: null, segments: [] },
    // narration with a character span (segment 1) and an NPC span (segment 3)
    {
        chapterNo: 2,
        lineNo: 9,
        characterId: null,
        segments: [
            { position: 0, characterId: null },
            { position: 1, characterId: 7 },
            { position: 2, characterId: null },
            { position: 3, characterId: null },
        ],
    },
];

test("a line a character speaks counts", () => {
    assert.equal(targetsCharacterVoice([{ chapterNo: 1, lineNo: 3, speaker: "Guard" }], stored), true);
});

test("a segment a character speaks counts", () => {
    assert.equal(targetsCharacterVoice([{ chapterNo: 2, lineNo: 9, segment: 1, characterId: 8 }], stored), true);
});

test("NPC lines and NPC segments don't", () => {
    assert.equal(
        targetsCharacterVoice(
            [
                { chapterNo: 1, lineNo: 4, speaker: "Guard" },
                { chapterNo: 2, lineNo: 9, segment: 3, characterId: 7 },
            ],
            stored
        ),
        false
    );
});

test("one character target among NPC ones is enough", () => {
    assert.equal(
        targetsCharacterVoice(
            [
                { chapterNo: 1, lineNo: 4, speaker: "Guard" },
                { chapterNo: 2, lineNo: 9, segment: 1, speaker: "Guard" },
            ],
            stored
        ),
        true
    );
});

test("a segment's own speaker decides, not its line's", () => {
    // line 3 is Emmett's as a whole line; it has no segment 0 to target
    assert.equal(targetsCharacterVoice([{ chapterNo: 1, lineNo: 3, segment: 0 }], stored), false);
});

test("unknown lines and malformed targets don't count", () => {
    assert.equal(targetsCharacterVoice([{ chapterNo: 5, lineNo: 1 }], stored), false);
    assert.equal(targetsCharacterVoice([null, "x", { chapterNo: "1", lineNo: 3 }], stored), false);
    assert.equal(targetsCharacterVoice("not a list", stored), false);
});

test("targetedLines keeps only whole-number chapter/line pairs", () => {
    assert.deepEqual(targetedLines([{ chapterNo: 1, lineNo: 3, segment: 2 }, { chapterNo: 1.5, lineNo: 2 }, null, { lineNo: 4 }]), [
        { chapterNo: 1, lineNo: 3 },
    ]);
    assert.deepEqual(targetedLines(undefined), []);
});
