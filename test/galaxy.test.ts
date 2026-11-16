// Galaxy map request checks (src/galaxy/galaxy.validation.ts): no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GalaxyInputError, parseBody, parseBodyTree, parsePlace, slugFor } from "../src/galaxy/galaxy.validation.js";

const planet = { kind: "PLANET", name: "Barbona", type: "ocean", radiusKm: 7800, orbit: 0.62 };

test("a landmark needs a name and defaults its category", () => {
    assert.throws(() => parsePlace({ kind: "LANDMARK", x: 1, y: 2 }), /needs a name/);
    assert.deepEqual(parsePlace({ kind: "LANDMARK", name: " M13 ", x: 1, y: 2 }), {
        kind: "LANDMARK", name: "M13", x: 1, y: 2, z: 0, region: null, category: "landmark", description: null,
    });
    assert.throws(() => parsePlace({ kind: "LANDMARK", name: "M13", x: 1, y: 2, category: "pub" }), /category must be one of/);
});

test("a system may be unnamed, and has no category", () => {
    const place = parsePlace({ kind: "SYSTEM", name: "", x: 10, y: -5, z: 0.1, region: "GU" });
    assert.equal(place.name, null);
    assert.equal(place.region, "GU");
    assert.equal(place.category, null);
    assert.throws(() => parsePlace({ kind: "SYSTEM", x: 1, y: 1, category: "station" }), /Only a landmark/);
});

test("positions must be numbers inside the galaxy", () => {
    for (const bad of [{ x: 60, y: 0 }, { x: 30, y: 30, z: 30 }, { x: "1", y: 2 }, { x: 1 }, { x: NaN, y: 1 }]) {
        assert.throws(() => parsePlace({ kind: "LANDMARK", name: "X", ...bad }), GalaxyInputError, JSON.stringify(bad));
    }
});

test("an edit checks only what is sent and cannot change the kind", () => {
    assert.deepEqual(parsePlace({ description: "Hi" }, true, "SYSTEM"), { description: "Hi" });
    assert.deepEqual(parsePlace({ x: 3, y: 4 }, true, "SYSTEM"), { x: 3, y: 4, z: 0 });
    assert.deepEqual(parsePlace({ name: null }, true, "SYSTEM"), { name: null });
    assert.throws(() => parsePlace({ name: null }, true, "LANDMARK"), /needs a name/);
    assert.throws(() => parsePlace({ kind: "LANDMARK" }, true, "SYSTEM"), /cannot change its kind/);
    assert.throws(() => parsePlace({ y: 4 }, true, "SYSTEM"), /x must be a number/);
    assert.throws(() => parseBody({ parentId: 3 }, true, "PLANET"), /another parent/);
});

test("descriptions are sanitized", () => {
    assert.equal(parsePlace({ description: "<script>x</script>A <b>wet</b> place" }, true, "SYSTEM").description, "A <b>wet</b> place");
});

test("slugs are checked, and come from the name when not sent", () => {
    assert.throws(() => parsePlace({ slug: "Not A Slug" }, true, "SYSTEM"), /slug must be/);
    assert.equal(slugFor("Zarazoga-9", undefined), "zarazoga_9");
    assert.equal(slugFor("Earth", "terra"), "terra");
    assert.equal(slugFor(null, null), null);
    assert.equal(slugFor("???", null), null);
});

test("bodies are held to their kind's rules", () => {
    assert.deepEqual(parseBody(planet), { ...planet, color: null, description: null });
    assert.deepEqual(parseBody({ kind: "STAR", type: "sunlike" }), { kind: "STAR", name: null, type: "sunlike", radiusKm: null, orbit: null, color: null, description: null });
    assert.equal(parseBody({ kind: "STATION", name: "Dock", orbit: 9000 }).type, "artificial");
    assert.throws(() => parseBody({ ...planet, name: "" }), /planet needs a name/);
    assert.throws(() => parseBody({ ...planet, type: "sunlike" }), /type must be one of/);
    assert.throws(() => parseBody({ kind: "STAR", type: "ocean" }), /type must be one of/);
    assert.throws(() => parseBody({ kind: "STAR", type: "sunlike", orbit: 1 }), /no orbit/);
    assert.throws(() => parseBody({ ...planet, radiusKm: undefined }), /needs a radiusKm/);
    assert.throws(() => parseBody({ ...planet, orbit: 0 }), /orbit must be above 0/);
    assert.throws(() => parseBody({ ...planet, color: "red" }), /#rrggbb/);
    assert.equal(parseBody({ color: "#AABBCC" }, true, "PLANET").color, "#aabbcc");
});

test("a system's bodies are one star with what may orbit under it", () => {
    const moon = { kind: "MOON", name: "Luna", type: "rocky", radiusKm: 1737, orbit: 384400 };
    const station = { kind: "STATION", name: "Dock", orbit: 9000 };
    const tree = parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ ...planet, children: [{ ...moon, children: [station] }] }, station] }]);
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].children[0].children[0].kind, "STATION");
    assert.throws(() => parseBodyTree(undefined), /needs its star/);
    assert.throws(() => parseBodyTree([]), /needs its star/);
    assert.throws(() => parseBodyTree([planet]), /planet orbits a star/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike" }, { kind: "STAR", type: "white" }]), /needs its star/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [moon] }]), /moon orbits a planet/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ kind: "STAR", type: "white" }] }]), /one star/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ ...planet, children: [planet] }] }]), /planet orbits a star/);
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...planet, name: `P${i}` }));
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: many }]), /at most 1000/);
});
