import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDescribe } from "../src/utils/version.js";

test("parseDescribe adds the commits since the tag to the patch", () => {
    assert.deepEqual(parseDescribe("v1.1.0-0-g3fa9c2e"), { version: "1.1.0", commit: "3fa9c2e" });
    assert.deepEqual(parseDescribe("v1.1.0-14-g3fa9c2e\n"), { version: "1.1.14", commit: "3fa9c2e" });
    assert.deepEqual(parseDescribe("v1.0.1-3-gabcdef0"), { version: "1.0.4", commit: "abcdef0" });
});

test("a minor or major tag zeroes what comes after it", () => {
    assert.equal(parseDescribe("v1.2.0-0-g1234567")?.version, "1.2.0");
    assert.equal(parseDescribe("v2.0.0-5-g1234567")?.version, "2.0.5");
});

test("a dirty working tree is marked", () => {
    assert.equal(parseDescribe("v1.1.0-14-g3fa9c2e-dirty")?.version, "1.1.14-dirty");
});

test("anything else is not a version", () => {
    assert.equal(parseDescribe("legacy-v1-4-g3fa9c2e"), null);
    assert.equal(parseDescribe("3fa9c2e"), null);
    assert.equal(parseDescribe(""), null);
});
