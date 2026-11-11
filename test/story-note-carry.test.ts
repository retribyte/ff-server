// A story revision rewrites every line; placeNote decides where each margin
// note lands on the new text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeNote, type PlacedLine } from "../src/story/note-carry.js";

const lines: PlacedLine[] = [
    { id: 1, chapterNo: 1, lineNo: 1, text: "The ship drifts." },
    { id: 2, chapterNo: 1, lineNo: 2, text: "Emmett wakes up." },
    { id: 3, chapterNo: 1, lineNo: 3, text: "A new line the revision added." },
    { id: 4, chapterNo: 1, lineNo: 4, text: "Emmett wakes up." },
    { id: 5, chapterNo: 2, lineNo: 1, text: "Chapter two opens." },
    { id: 6, chapterNo: 2, lineNo: 2, text: "Moved here from chapter one." },
];

test("unchanged text stays with its line, even when it moved down", () => {
    assert.deepEqual(placeNote({ chapterNo: 1, lineNo: 1, text: "The ship drifts." }, lines), { lineId: 1, sameText: true });
    assert.deepEqual(placeNote({ chapterNo: 2, lineNo: 5, text: "Chapter two opens." }, lines), { lineId: 5, sameText: true });
});

test("repeated text in the chapter: the copy closest to the note's old position", () => {
    assert.equal(placeNote({ chapterNo: 1, lineNo: 2, text: "Emmett wakes up." }, lines)?.lineId, 2);
    assert.equal(placeNote({ chapterNo: 1, lineNo: 5, text: "Emmett wakes up." }, lines)?.lineId, 4);
});

test("whitespace differences don't count as an edit", () => {
    assert.deepEqual(placeNote({ chapterNo: 1, lineNo: 9, text: "  The ship\ndrifts. " }, lines), { lineId: 1, sameText: true });
});

test("text that moved to another chapter follows it", () => {
    assert.deepEqual(placeNote({ chapterNo: 1, lineNo: 3, text: "Moved here from chapter one." }, lines), { lineId: 6, sameText: true });
});

test("edited text: the line at the same position, else the chapter's last", () => {
    assert.deepEqual(placeNote({ chapterNo: 1, lineNo: 3, text: "Reworded." }, lines), { lineId: 3, sameText: false });
    assert.deepEqual(placeNote({ chapterNo: 1, lineNo: 40, text: "Reworded." }, lines), { lineId: 4, sameText: false });
});

test("a chapter the revision removed: the story's last line", () => {
    assert.deepEqual(placeNote({ chapterNo: 3, lineNo: 1, text: "Gone." }, lines), { lineId: 6, sameText: false });
});

test("a story with no lines left has nowhere to put it", () => {
    assert.equal(placeNote({ chapterNo: 1, lineNo: 1, text: "x" }, []), null);
});
