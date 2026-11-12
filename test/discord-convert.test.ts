// Vortox Machina from Discord (src/story/convert/discord.ts): GM entries in
// #cyoa-vm -> story lines, for the web importer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { convertDiscord, messagesFromExport, parseEntry, snowflakeDate, VM_CHANNEL_ID } from "../src/story/convert/discord.js";

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

test("several unnamed NPCs in a scene each get their own line (??, ???, ?2)", () => {
    const rows = parseEntry(`${fence}\nE: LET GO OF THE MAN.\n??: HANDS UP!\n???: DOWN TO THE GROUND!\n?2: Chicken.\n${fence}`);
    assert.deepEqual(
        rows.map((r) => [r.code, r.text]),
        [
            ["E", "LET GO OF THE MAN."],
            ["??", "HANDS UP!"],
            ["???", "DOWN TO THE GROUND!"],
            ["?2", "Chicken."],
        ]
    );
});

test("text outside the code blocks, or an orphan line, is an error", () => {
    assert.throws(() => parseEntry(`hello\n${fence}\nx\n${fence}`), /stray text/);
    assert.throws(() => parseEntry(`${fence}\nx\n${fence}\nafter`), /trailing text/);
    assert.throws(() => parseEntry(`${fence}\nnot dialogue\nE: hi\n${fence}`), /orphan line/);
});

test("convertDiscord: the GM's code-block entries, oldest first, with their codes", () => {
    const result = convertDiscord({
        channel: { id: VM_CHANNEL_ID },
        messages: [
            { id: "300", author: { name: "lastingparadox", nickname: "Zander" }, content: `${fence}\nG: Later.\n${fence}` },
            { id: "250", author: { name: "trey" }, content: "> do the thing" },
            { id: "200", author: { name: "lastingparadox" }, content: `${fence}\nE: First.\nE: Again.\n${fence}` },
            { id: "1000", author: { name: "lastingparadox" }, content: "(will continue later)" },
        ],
    });
    assert.deepEqual(
        result.lines.map((r) => r.text),
        ["First.", "Again.", "Later."]
    );
    assert.equal(result.entries, 2);
    assert.deepEqual(result.codes, [
        { code: "E", count: 2, example: "First." },
        { code: "G", count: 1, example: "Later." },
    ]);
    assert.deepEqual(result.warnings, []);
});

test("convertDiscord: ids sort as numbers, and an entry that doesn't read is left out with a warning", () => {
    const result = convertDiscord({
        messages: [
            { id: "1000", author: { name: "Zander" }, content: `${fence}\nNew.\n${fence}` },
            { id: "999", author: { name: "Zander" }, content: `oops ${fence}\nx\n${fence}` },
            { id: "998", author: { name: "Zander" }, content: `${fence}\nOld.\n${fence}` },
        ],
    });
    assert.deepEqual(
        result.lines.map((r) => r.text),
        ["Old.", "New."]
    );
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /message 999\) doesn't read, so it's left out: stray text/);
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
