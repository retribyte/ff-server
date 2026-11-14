// The portrait bundle reader and the settings validation. The bundle here is made up in a
// temp directory: no game or mod file is ever used in tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptsGzip, assembleBundle, etagMatches, folderNames, gzipped, listModFolders, packPath, removeModFolder } from "../src/portrait/portrait.bundle.js";
import { parseCurationPatch, parseModPatch, parseRaces, parseSettings, SettingsError } from "../src/portrait/portrait.validation.js";

function makeBundle(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "portrait-test-"));
    const mod = (id: string, order: number, name = `Mod ${id}`) => {
        mkdirSync(path.join(dir, id));
        writeFileSync(path.join(dir, id, "mod.json"), JSON.stringify({ version: 2, id, name, order, images: {} }));
        writeFileSync(path.join(dir, id, "items.json"), JSON.stringify({ version: 2, id, items: [id] }));
        writeFileSync(path.join(dir, id, "sprites.pack"), `pack-${id}`);
    };
    mod("zeta", 0); // load order is `order`, not the name
    mod("alpha-beta mod", 5);
    mod("1234", 3);
    mkdirSync(path.join(dir, "not-a-mod")); // no mod.json
    writeFileSync(path.join(dir, "mods.json"), "stale top-level file");
    return dir;
}

test("assembles mods.json and items.json in load order", async () => {
    const dir = makeBundle();
    try {
        const { mods, items } = await assembleBundle(dir, new Set());
        const parsed = JSON.parse(mods.body.toString());
        assert.equal(parsed.version, 2);
        assert.deepEqual(parsed.mods.map((m: { id: string }) => m.id), ["zeta", "1234", "alpha-beta mod"]);
        assert.deepEqual(JSON.parse(items.body.toString()).mods.map((m: { items: string[] }) => m.items[0]), ["zeta", "1234", "alpha-beta mod"]);
        // exactly the extractor's compact concatenation
        assert.ok(mods.body.toString().startsWith('{"version":2,"mods":[{"version":2,"id":"zeta"'));
        assert.ok(mods.body.toString().endsWith("}]}"));
        assert.deepEqual(await listModFolders(dir), ["1234", "alpha-beta mod", "zeta"]);
        assert.equal((await folderNames(dir)).get("1234"), "Mod 1234");
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("leaves out disabled mods, and follows folders coming and going", async () => {
    const dir = makeBundle();
    try {
        const ids = async (disabled: string[]) =>
            JSON.parse((await assembleBundle(dir, new Set(disabled))).mods.body.toString()).mods.map((m: { id: string }) => m.id);
        assert.deepEqual(await ids(["1234"]), ["zeta", "alpha-beta mod"]);
        const before = (await assembleBundle(dir, new Set())).mods.etag;
        renameSync(path.join(dir, "zeta"), path.join(dir, "..", path.basename(dir) + "-away"));
        assert.deepEqual(await ids([]), ["1234", "alpha-beta mod"]);
        assert.notEqual((await assembleBundle(dir, new Set())).mods.etag, before);
        renameSync(path.join(dir, "..", path.basename(dir) + "-away"), path.join(dir, "zeta"));
        assert.equal((await assembleBundle(dir, new Set())).mods.etag, before);
        // an edited file is noticed
        writeFileSync(path.join(dir, "1234", "mod.json"), JSON.stringify({ id: "1234", name: "Renamed", order: 3, images: {} }));
        assert.match((await assembleBundle(dir, new Set())).mods.body.toString(), /Renamed/);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("caches the assembled buffer and its gzip", async () => {
    const dir = makeBundle();
    try {
        const first = await assembleBundle(dir, new Set());
        const second = await assembleBundle(dir, new Set());
        assert.equal(first, second);
        const gz = await gzipped(first.mods);
        assert.equal(await gzipped(first.mods), gz);
        assert.deepEqual(gunzipSync(gz), first.mods.body);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("finds a pack only by an exact folder name, never by a path", async () => {
    const dir = makeBundle();
    try {
        const none = new Set<string>();
        assert.equal(await packPath(dir, "zeta", none), path.join(dir, "zeta", "sprites.pack"));
        assert.equal(await packPath(dir, "alpha-beta mod", none), path.join(dir, "alpha-beta mod", "sprites.pack"));
        assert.equal(await packPath(dir, "zeta", new Set(["zeta"])), null);
        for (const bad of ["..", "../zeta", "zeta/../zeta", "/etc", dir, "zeta/", "not-a-mod", "missing", "", ".", "ZETA", "zeta\0"])
            assert.equal(await packPath(dir, bad, none), null, JSON.stringify(bad));
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("accept-encoding and if-none-match parsing", () => {
    assert.equal(acceptsGzip("gzip, deflate, br"), true);
    assert.equal(acceptsGzip("br;q=1.0, gzip;q=0.8"), true);
    assert.equal(acceptsGzip("gzip;q=0"), false);
    assert.equal(acceptsGzip("identity"), false);
    assert.equal(acceptsGzip(undefined), false);
    assert.equal(etagMatches('"a", "b"', '"b"'), true);
    assert.equal(etagMatches('W/"a"', '"a"'), true);
    assert.equal(etagMatches('"a"', '"b"'), false);
    assert.equal(etagMatches(undefined, '"b"'), false);
});

const good = () => ({
    categories: ["animal"],
    races: [{ id: "human", category: "animal" }, { id: "blazekid", species: "novakid", lock: { facialMask: "" }, exclude: ["1"], hidden: true }],
    curation: { skipMods: { "1": "Skipped" }, hideItemPattern: "invisi|inviso", hideItems: ["a"], itemsOnlyFor: { "2": ["Alpaca"] }, erase: { "3/x.png": [[1, 2]] } },
});

test("accepts a body shaped like races.json and curation.json", () => {
    const parsed = parseSettings({ ...good(), races: good().races });
    assert.equal(parsed.races.length, 2);
    assert.deepEqual(parsed.curation.itemsOnlyFor, { "2": ["alpaca"] });
    // comments in the files are ignored
    assert.doesNotThrow(() => parseSettings({ ...good(), curation: { ...good().curation, _about: "x" } }));
    assert.equal(parseSettings({ ...good(), curation: { ...good().curation, skipMods: undefined } }).curation.skipMods, undefined);
});

test("rejects junk", () => {
    const bad = (mutate: (b: any) => void) => {
        const body: any = good();
        mutate(body);
        assert.throws(() => parseSettings(body), SettingsError);
    };
    assert.throws(() => parseSettings(null), SettingsError);
    assert.throws(() => parseSettings([]), SettingsError);
    bad((b) => (b.extra = 1));
    bad((b) => (b.categories = "animal"));
    bad((b) => (b.categories = [1]));
    bad((b) => (b.races = {}));
    bad((b) => (b.races = [{}]));
    bad((b) => (b.races = [{ id: "a" }, { id: "a" }]));
    bad((b) => (b.races = [{ id: "a", hidden: "yes" }]));
    bad((b) => (b.races = [{ id: "a", exclude: "1" }]));
    bad((b) => (b.races = [{ id: "a", surprise: 1 }]));
    bad((b) => (b.races = [{ id: "a", lock: { hair: 1 } }]));
    bad((b) => (b.races = [{ id: "a", lock: { beard: "" } }]));
    bad((b) => (b.curation.hideItemPattern = "("));
    bad((b) => (b.curation.hideItemPattern = 5));
    bad((b) => (b.curation.hideItems = "a"));
    bad((b) => (b.curation.itemsOnlyFor = { "2": "alpaca" }));
    bad((b) => (b.curation.skipMods = { "1": 5 }));
    bad((b) => (b.curation.erase = { k: [[1]] }));
    bad((b) => (b.curation.erase = { k: [[-1, 0]] }));
    bad((b) => (b.curation.erase = { k: [[1.5, 0]] }));
    bad((b) => (b.curation.surprise = 1));
    bad((b) => delete b.curation);
});

test("deletes a mod folder only by its exact name", async () => {
    const dir = makeBundle();
    try {
        const [first] = await listModFolders(dir);
        for (const bad of ["..", ".", "", `${first}/..`, `../${path.basename(dir)}`, path.join(dir, first)]) assert.equal(await removeModFolder(dir, bad), false);
        assert.equal((await listModFolders(dir)).includes(first), true);
        assert.equal(await removeModFolder(dir, first), true);
        assert.equal((await listModFolders(dir)).includes(first), false);
        assert.equal(await removeModFolder(dir, first), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("the admin panel's partial edits are validated", () => {
    assert.deepEqual(parseModPatch({ enabled: false }), { enabled: false });
    assert.deepEqual(parseModPatch({ itemsOnlyFor: ["Alpaca"] }), { itemsOnlyFor: ["alpaca"] });
    for (const bad of [{}, { enabled: "no" }, { name: "" }, { other: 1 }, null]) assert.throws(() => parseModPatch(bad), SettingsError);

    assert.deepEqual(parseCurationPatch({ hideItemPattern: "" }), { hideItemPattern: "" });
    assert.deepEqual(parseCurationPatch({ erase: { "mod/a.png": [[1, 2]] } }), { erase: { "mod/a.png": [[1, 2]] } });
    for (const bad of [{}, { hideItemPattern: "(" }, { categories: "animal" }, { erase: { a: [[1]] } }, { hideItems: [1] }]) assert.throws(() => parseCurationPatch(bad), SettingsError);

    assert.equal(parseRaces([{ id: "human" }, { id: "blazekid", species: "novakid", lock: { facialHair: "" } }]).length, 2);
    for (const bad of [undefined, {}, [{ id: "a" }, { id: "a" }], [{ name: "no id" }]]) assert.throws(() => parseRaces(bad), SettingsError);
});
