// Story.importMeta validation: the remembered Google Doc color map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImportMeta } from "../src/story/import-meta.js";

test("absent importMeta is undefined", () => {
    assert.equal(parseImportMeta(undefined), undefined);
    assert.equal(parseImportMeta(null), undefined);
});

test("colors normalize to lowercase hex and trimmed names", () => {
    assert.deepStrictEqual(parseImportMeta({ format: "prose", colors: { "#A1B2C3": " Vec ", "#666666": "?", "#000000": null } }), {
        format: "prose",
        colors: { "#a1b2c3": "Vec", "#666666": "?", "#000000": null },
    });
    assert.deepStrictEqual(parseImportMeta({ colors: {} }), { colors: {} });
});

test("malformed importMeta is rejected", () => {
    for (const bad of [
        "x",
        [],
        { colors: [] },
        { format: "novel", colors: {} },
        { colors: { red: "Vec" } },
        { colors: { "#abcdef": "" } },
        { colors: { "#abcdef": 3 } },
        { colors: { "#abcdef": "x".repeat(101) } },
    ]) {
        assert.throws(() => parseImportMeta(bad), /^Error: importMeta: /, JSON.stringify(bad));
    }
});
