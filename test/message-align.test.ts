import { test } from "node:test";
import assert from "node:assert/strict";
import { alignMessages, alignStats, noteTargets } from "../src/jobs/messageAlign.js";

const keys = (s: string) => s.split("");

test("identical episodes line up one to one", () => {
    assert.deepEqual(alignMessages(keys("abcd"), keys("abcd")), [0, 1, 2, 3]);
    assert.deepEqual(alignStats([0, 1, 2, 3], keys("abcd"), keys("abcd")), { unchanged: 4, edited: 0, added: 0, removed: 0 });
});

test("a typo fix keeps the message's place", () => {
    const a = alignMessages(keys("abcd"), keys("abXd"));
    assert.deepEqual(a, [0, 1, 2, 3]);
    assert.deepEqual(alignStats(a, keys("abcd"), keys("abXd")), { unchanged: 3, edited: 1, added: 0, removed: 0 });
});

test("added and removed messages shift the rest, which still match", () => {
    // 'x' inserted after a, 'c' removed
    const a = alignMessages(keys("abcde"), keys("axbde"));
    assert.deepEqual(a, [0, null, 1, 3, 4]);
    assert.deepEqual(alignStats(a, keys("abcde"), keys("axbde")), { unchanged: 4, edited: 0, added: 1, removed: 1 });
});

test("a run rewritten with more lines pairs in order, the surplus is added", () => {
    const a = alignMessages(keys("aXYb"), keys("aPQRb"));
    assert.deepEqual(a, [0, 1, 2, null, 3]);
});

test("notes on a removed message go to the nearest earlier kept one, else the next", () => {
    // old a b c d; new keeps a and d ('b','c' removed, nothing else to pair with)
    const a = alignMessages(keys("abcd"), keys("ad"));
    assert.deepEqual(a, [0, 3]);
    assert.deepEqual(noteTargets(a, 4), { target: [0, 0, 0, 1], moved: [false, true, true, false] });
    // the first message removed: its notes go forward
    const b = alignMessages(keys("abc"), keys("bc"));
    assert.deepEqual(noteTargets(b, 3), { target: [0, 0, 1], moved: [true, false, false] });
});
