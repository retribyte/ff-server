// Story.publishedDate parsing: a calendar date stored as midnight UTC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublishedDate } from "../src/story/published-date.js";

test("absent leaves the date alone, null or empty clears it", () => {
    assert.equal(parsePublishedDate(undefined), undefined);
    assert.equal(parsePublishedDate(null), null);
    assert.equal(parsePublishedDate(""), null);
});

test("a calendar date becomes midnight UTC", () => {
    assert.equal(parsePublishedDate("2026-10-07")?.toISOString(), "2026-10-07T00:00:00.000Z");
    assert.equal(parsePublishedDate(" 2018-09-20 ")?.toISOString(), "2018-09-20T00:00:00.000Z");
});

test("the API's own ISO output is accepted back unchanged", () => {
    assert.equal(parsePublishedDate("2026-11-03T00:00:00.000Z")?.toISOString(), "2026-11-03T00:00:00.000Z");
});

test("leap day is real only in a leap year", () => {
    assert.equal(parsePublishedDate("2024-02-29")?.toISOString(), "2024-02-29T00:00:00.000Z");
    assert.throws(() => parsePublishedDate("2026-02-29"), /not a real date/);
});

test("junk is rejected with a message, not passed on to the database", () => {
    for (const bad of ["junk", "2026-13-01", "2026-02-30", "10/07/2026", "2026-1-7", 20261007, {}, true]) {
        assert.throws(() => parsePublishedDate(bad), /publishedDate/, String(bad));
    }
});
