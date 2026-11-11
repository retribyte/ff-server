// Vortox Machina GM entries -> story lines (src/jobs/vm-parse.ts), as the
// admin import and the CLI read #cyoa-vm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { messagesFromExport, newEntries, parseEntry, snowflakeDate, VM_CHANNEL_ID } from "../src/jobs/vm-parse.js";

const fence = "```";

test("a heading, narration, and dialogue with a continued line", () => {
    const entry = `**Open the hatch ==>**\n${fence}\nThe hatch groans open.\nDust everywhere.\n\nE: Hello?\nanyone there?\n?: Who goes there!\n${fence}`;
    assert.deepEqual(parseEntry(entry), [
        { type: "ACTION", text: "Open the hatch ⇒" },
        { type: "NARRATION", text: "The hatch groans open.\nDust everywhere." },
        { type: "DIALOGUE", text: "Hello?\nanyone there?", code: "E" },
        { type: "DIALOGUE", text: "Who goes there!", code: "?" },
    ]);
});

test("an empty heading is a bare arrow", () => {
    assert.deepEqual(parseEntry(`**==>**\n${fence}\nOnward.\n${fence}`)[0], { type: "ACTION", text: "⇒" });
});

test("a code the import doesn't know yet still parses, so the preview can ask about it", () => {
    const rows = parseEntry(`${fence}\nG: A visitor?!\nFP: Indeed.\n${fence}`);
    assert.deepEqual(rows.map((r) => r.code), ["G", "FP"]);
});

test("text outside the code blocks, or an orphan line, is an error", () => {
    assert.throws(() => parseEntry(`hello\n${fence}\nx\n${fence}`), /stray text/);
    assert.throws(() => parseEntry(`${fence}\nx\n${fence}\nafter`), /trailing text/);
    assert.throws(() => parseEntry(`${fence}\nnot dialogue\nE: hi\n${fence}`), /orphan line/);
});

test("newEntries: only the GM's code-block messages after the cursor, oldest first", () => {
    const messages = [
        { id: "300", author: "Zander", content: `${fence}\nG: Later.\n${fence}` },
        { id: "100", author: "Zander", content: `${fence}\nAlready imported.\n${fence}` },
        { id: "250", author: "Trey", content: "> do the thing" },
        { id: "200", author: "lastingparadox", content: `${fence}\nE: First.\n${fence}` },
        { id: "310", author: "Trey", content: "nice" },
    ];
    const { rows, entries, codes, newestId } = newEntries(messages, "100");
    assert.deepEqual(rows.map((r) => r.text), ["First.", "Later."]);
    assert.equal(entries, 2);
    assert.equal(newestId, "310"); // the next import starts after the newest message, the GM's or not
    assert.deepEqual([...codes.keys()], ["E", "G"]);
    assert.deepEqual(codes.get("G"), { count: 1, example: "Later." });
});

test("newEntries: ids compare as numbers, not text", () => {
    const { rows } = newEntries([{ id: "1000", author: "Zander", content: `${fence}\nNew.\n${fence}` }], "999");
    assert.equal(rows.length, 1);
});

test("newEntries: nothing new", () => {
    assert.deepEqual(newEntries([{ id: "5", author: "Zander", content: "x" }], "9").newestId, null);
});

test("newEntries names the message a bad entry is in", () => {
    assert.throws(() => newEntries([{ id: "7", author: "Zander", content: `oops ${fence}\nx\n${fence}` }], "1"), /message 7: stray text/);
});

test("messagesFromExport reads DiscordChatExporter JSON and checks the channel", () => {
    const exported = {
        channel: { id: VM_CHANNEL_ID },
        messages: [
            { id: "1", author: { name: "lastingparadox", nickname: "Zander" }, content: "a" },
            { id: "2", author: { name: "trey", nickname: "Trey" }, content: "b" },
        ],
    };
    assert.deepEqual(messagesFromExport(exported), [
        { id: "1", author: "Zander", content: "a" },
        { id: "2", author: "Trey", content: "b" },
    ]);
    assert.throws(() => messagesFromExport({ channel: { id: "123" }, messages: [] }), /another channel/);
    assert.throws(() => messagesFromExport({ nope: true }), /DiscordChatExporter/);
});

test("snowflakeDate decodes a Discord id's timestamp", () => {
    assert.equal(snowflakeDate("175928847299117063").toISOString(), "2016-04-30T11:18:25.796Z");
});
