// The portrait bundle reader and the settings validation. The bundle here is made up in a
// temp directory: no game or mod file is ever used in tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptsGzip, assembleBundle, etagMatches, folderNames, plain, listModFolders, packPath, removeModFolder } from "../src/portrait/portrait.bundle.js";
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
        const text = (await plain(mods)).toString();
        const parsed = JSON.parse(text);
        assert.equal(parsed.version, 2);
        assert.deepEqual(parsed.mods.map((m: { id: string }) => m.id), ["zeta", "1234", "alpha-beta mod"]);
        assert.deepEqual(JSON.parse((await plain(items)).toString()).mods.map((m: { items: string[] }) => m.items[0]), ["zeta", "1234", "alpha-beta mod"]);
        // exactly the extractor's compact concatenation
        assert.ok(text.startsWith('{"version":2,"mods":[{"version":2,"id":"zeta"'));
        assert.ok(text.endsWith("}]}"));
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
            JSON.parse((await plain((await assembleBundle(dir, new Set(disabled))).mods)).toString()).mods.map((m: { id: string }) => m.id);
        assert.deepEqual(await ids(["1234"]), ["zeta", "alpha-beta mod"]);
        const before = (await assembleBundle(dir, new Set())).mods.etag;
        renameSync(path.join(dir, "zeta"), path.join(dir, "..", path.basename(dir) + "-away"));
        assert.deepEqual(await ids([]), ["1234", "alpha-beta mod"]);
        assert.notEqual((await assembleBundle(dir, new Set())).mods.etag, before);
        renameSync(path.join(dir, "..", path.basename(dir) + "-away"), path.join(dir, "zeta"));
        assert.equal((await assembleBundle(dir, new Set())).mods.etag, before);
        // an edited file is noticed
        writeFileSync(path.join(dir, "1234", "mod.json"), JSON.stringify({ id: "1234", name: "Renamed", order: 3, images: {} }));
        assert.match((await plain((await assembleBundle(dir, new Set())).mods)).toString(), /Renamed/);
    } finally {
        rmSync(dir, { recursive: true });
    }
});

test("keeps one assembled bundle, as gzip", async () => {
    const dir = makeBundle();
    try {
        const first = await assembleBundle(dir, new Set());
        assert.equal(await assembleBundle(dir, new Set()), first);
        assert.deepEqual(gunzipSync(first.mods.gzip), await plain(first.mods));
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
    bad((b) => (b.races = [{ id: "a", lock: { "no spaces": "" } }]));
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
    // A species' own style layers can be fixed too (ffLayers ids)
    assert.deepEqual(parseRaces([{ id: "squoat", lock: { markings: "stripes", hair: "" } }])[0].lock, { markings: "stripes", hair: "" });
    for (const bad of [undefined, {}, [{ id: "a" }, { id: "a" }], [{ name: "no id" }]]) assert.throws(() => parseRaces(bad), SettingsError);
});

test("a saved portrait's body is checked", async () => {
    const { parsePortrait, PortraitInputError, PORTRAIT_MAX_SIDE } = await import("../src/portrait/saved.validation.js");
    // a 1x1 PNG
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const good = { name: "  Matthias  ", race: "avian", recipe: { v: 1, species: "avian", wear: {} }, image: png };
    const parsed = parsePortrait(good);
    assert.equal(parsed.name, "Matthias");
    assert.equal(parsed.image?.readUInt32BE(16), 1);
    assert.ok(PORTRAIT_MAX_SIDE >= 43);
    for (const bad of [
        null,
        { ...good, name: "" },
        { ...good, name: "x".repeat(101) },
        { ...good, race: undefined },
        { ...good, recipe: { species: "avian" } },
        { ...good, recipe: { v: 1, species: "avian", junk: "x".repeat(40_000) } },
        { ...good, image: "data:image/jpeg;base64,AAAA" },
        { ...good, image: "https://example.com/a.png" },
    ]) {
        assert.throws(() => parsePortrait(bad), PortraitInputError);
    }
    // a partial change checks only what is sent
    assert.deepEqual(parsePortrait({ name: "New" }, true), { name: "New" });
    assert.throws(() => parsePortrait({ name: "" }, true), PortraitInputError);
});

test("a member's mod upload arrives in pieces, is checked, and replaces the folder in one step", async () => {
    const { appendChunk, installUpload, UploadError, UPLOAD_MAGIC, validModId, validSession } = await import("../src/portrait/portrait.upload.js");
    const dir = makeBundle();
    const u32 = (n: number) => {
        const b = Buffer.alloc(4);
        b.writeUInt32BE(n);
        return b;
    };
    const blob = (_id: string, mod: object, items: object, pack: Buffer) => {
        const [m, i] = [Buffer.from(JSON.stringify(mod)), Buffer.from(JSON.stringify(items))];
        return Buffer.concat([UPLOAD_MAGIC, u32(m.length), m, u32(i.length), i, pack]);
    };
    const pack = Buffer.from("0123456789");
    const goodMod = { version: 2, id: "newmod", name: "New mod", order: 4, build: "abcdef123456", frameFiles: ["/a.frames"], images: { "/humanoid/x/body.png": [0, 6, "h", 0] }, species: {}, speciesPatches: {}, frames: {} };
    const goodItems = { version: 2, id: "newmod", build: "abcdef123456", items: [{ id: "hat", name: "Hat", slot: "head", frames: {}, colors: 0 }], palettes: [[]], images: { "/items/hat.png": [6, 4, "h", -1] } };
    const session = "a".repeat(32);
    const send = async (id: string, file: Buffer, piece = 7) => {
        for (let at = 0; at < file.length; at += piece) await appendChunk(dir, 1, session, at, file.length, file.subarray(at, at + piece));
        return installUpload(dir, 1, session, id);
    };
    try {
        const done = await send("newmod", blob("newmod", goodMod, goodItems, pack));
        assert.deepEqual([done.name, done.items, done.sprites, done.packBytes], ["New mod", 1, 2, 10]);
        assert.equal((await listModFolders(dir)).includes("newmod"), true);
        assert.equal((await packPath(dir, "newmod", new Set())) !== null, true);
        const names = async () => JSON.parse((await plain((await assembleBundle(dir, new Set())).mods)).toString()).mods.map((m: { name: string }) => m.name);
        assert.equal((await names()).includes("New mod"), true);

        // a second upload replaces the folder whole
        await send("newmod", blob("newmod", { ...goodMod, name: "Newer mod", images: {} }, { ...goodItems, images: {} }, Buffer.alloc(0)));
        assert.equal((await names()).includes("Newer mod"), true);
        assert.equal((await names()).includes("New mod"), false);

        // what is refused leaves the folder that was there, and no leftovers
        const bad: [string, Buffer][] = [
            ["newmod", Buffer.concat([Buffer.from("NOPE!\n"), Buffer.alloc(20)])],
            ["newmod", blob("newmod", { ...goodMod, id: "other" }, goodItems, pack)],
            ["newmod", blob("newmod", { ...goodMod, version: 1 }, goodItems, pack)],
            ["newmod", blob("newmod", { ...goodMod, images: { "/a.png": [8, 6, "h", -1] } }, goodItems, pack)],
            ["newmod", blob("newmod", { ...goodMod, images: { "/a.png": [0, 1, "h", 5] } }, goodItems, pack)],
            ["newmod", blob("newmod", goodMod, { ...goodItems, items: [{ id: "hat", slot: "feet", name: "x", frames: {}, colors: 0 }] }, pack)],
            ["newmod", blob("newmod", goodMod, { ...goodItems, build: "different000" }, pack)],
        ];
        for (const [n, [id, file]] of bad.entries()) await assert.rejects(send(id, file), UploadError, `bad upload ${n}`);
        assert.equal((await names()).includes("Newer mod"), true);
        assert.deepEqual(await listModFolders(dir), ["1234", "alpha-beta mod", "newmod", "zeta"]);

        // pieces must arrive in order
        const file = blob("newmod", goodMod, goodItems, pack);
        await appendChunk(dir, 1, session, 0, file.length, file.subarray(0, 10));
        await assert.rejects(appendChunk(dir, 1, session, 20, file.length, file.subarray(20, 30)), UploadError);
        await assert.rejects(appendChunk(dir, 2, session, 10, file.length, file.subarray(10, 20)), UploadError); // another member's session
        await assert.rejects(appendChunk(dir, 1, session, 10, file.length, Buffer.alloc(0)), UploadError); // empty piece

        for (const id of ["..", ".uploads", "a/b", "", "x".repeat(101), "trailing.", " lead"]) assert.equal(validModId(id), false, id);
        for (const id of ["729427301", "vanilla", "squoatling-race-work-in-progress", "123-Contents v2"]) assert.equal(validModId(id), true, id);
        assert.equal(validSession("../../etc"), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
