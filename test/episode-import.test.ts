import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePayloads } from "../src/jobs/episodeImport.js";

const episode = (over: Record<string, unknown> = {}) => ({
    seasonTitle: "FF1",
    episode: { title: "Pocket Girlfriend", episode_no: -3, reconstructed: true },
    messages: [{ player: "Zander", character: "Grass Stalker", persona: "Emmett", timestamp: null, type: "QUOTE", text: "Hi." }],
    ...over,
});

test("accepts md-to-api.py episode JSON", () => {
    const payloads = parsePayloads({ episodes: [episode()] });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].episode.episode_no, -3);
});

test("rejects an empty or missing batch", () => {
    assert.throws(() => parsePayloads({}), /non-empty array/);
    assert.throws(() => parsePayloads({ episodes: [] }), /non-empty array/);
});

test("names the episode and message that's malformed", () => {
    assert.throws(() => parsePayloads({ episodes: [episode({ seasonTitle: "" })] }), /Episode 1: seasonTitle/);
    assert.throws(() => parsePayloads({ episodes: [episode(), episode({ episode: { title: "X", episode_no: 1.5 } })] }), /Episode 2: episode.episode_no/);
    assert.throws(() => parsePayloads({ episodes: [episode({ messages: [{ player: "Zander", type: "QUOTE" }] })] }), /Episode 1, message 1/);
});
