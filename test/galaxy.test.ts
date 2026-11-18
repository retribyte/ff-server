// Galaxy map request checks (src/galaxy/galaxy.validation.ts): no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GalaxyInputError, canOrbit, checkNotDesignation, checkPlacement, designationLike, parseBody, parseBodyTree, parsePlace, slugFor } from "../src/galaxy/galaxy.validation.js";

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
    assert.deepEqual(parseBody(planet), { ...planet, width: null, ordinal: null, builtYear: null, iteration: null, color: null, description: null });
    assert.deepEqual(parseBody({ kind: "STAR", type: "sunlike" }), { kind: "STAR", name: null, type: "sunlike", radiusKm: null, orbit: null, width: null, ordinal: null, builtYear: null, iteration: null, color: null, description: null });
    assert.equal(parseBody({ kind: "STATION", name: "Dock", orbit: 9000 }).type, "artificial");
    // A planet or moon may go by its designation alone; a station may not
    assert.equal(parseBody({ ...planet, name: "" }).name, null);
    assert.equal(parseBody({ kind: "MOON", type: "rocky", radiusKm: 1737, orbit: 384400 }).name, null);
    assert.throws(() => parseBody({ kind: "STATION", orbit: 9000 }), /station needs a name/);
    // A belt has a width in place of a size, may go unnamed, and is rocky unless it says otherwise
    const belt = parseBody({ kind: "BELT", orbit: 2.7, width: 1 });
    assert.deepEqual([belt.name, belt.type, belt.radiusKm, belt.width], [null, "rocky", null, 1]);
    assert.throws(() => parseBody({ kind: "BELT", orbit: 2.7 }), /width must be a number/);
    assert.throws(() => parseBody({ kind: "BELT", orbit: 2.7, width: 6 }), /less than twice its orbit/);
    assert.throws(() => parseBody({ kind: "BELT", orbit: 2.7, width: 1, radiusKm: 5 }), /not a radiusKm/);
    assert.throws(() => parseBody({ kind: "MOON", type: "rocky", radiusKm: 1737, orbit: 384400, width: 5 }), /Only a belt/);
    assert.equal(parseBody({ ...planet, ordinal: 3 }).ordinal, 3);
    assert.equal(parseBody({ ordinal: null }, true, "PLANET").ordinal, null);
    for (const bad of [0, 1.5, 100, "3"]) assert.throws(() => parseBody({ ...planet, ordinal: bad }), /ordinal must be/, String(bad));
    assert.throws(() => parseBody({ kind: "MOON", name: "Luna", type: "rocky", radiusKm: 1737, orbit: 384400, ordinal: 1 }), /Only a planet \(or a pair of planets\)/);
    assert.throws(() => parseBody({ ...planet, type: "sunlike" }), /type must be one of/);
    assert.throws(() => parseBody({ kind: "STAR", type: "ocean" }), /type must be one of/);
    // A star's orbit is checked against its place in the tree (checkPlacement): a companion has one, the primary none
    assert.equal(parseBody({ kind: "STAR", type: "sunlike", orbit: 40 }).orbit, 40);
    assert.equal(parseBody({ kind: "STAR", type: "sunlike" }).orbit, null);
    assert.throws(() => parseBody({ ...planet, radiusKm: undefined }), /needs a radiusKm/);
    assert.throws(() => parseBody({ ...planet, orbit: 0 }), /orbit must be above 0/);
    assert.throws(() => parseBody({ ...planet, color: "red" }), /#rrggbb/);
    assert.equal(parseBody({ color: "#AABBCC" }, true, "PLANET").color, "#aabbcc");
});

test("a system's bodies are one primary with what may orbit under it", () => {
    const moon = { kind: "MOON", name: "Luna", type: "rocky", radiusKm: 1737, orbit: 384400 };
    const station = { kind: "STATION", name: "Dock", orbit: 9000 };
    const tree = parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ ...planet, children: [{ ...moon, children: [station] }] }, station] }]);
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[0].children[0].children[0].kind, "STATION");
    assert.throws(() => parseBodyTree(undefined), /needs its star/);
    assert.throws(() => parseBodyTree([]), /needs its star/);
    assert.throws(() => parseBodyTree([planet]), /primary is a star or a pair of stars, not a planet/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike" }, { kind: "STAR", type: "white" }]), /needs its star/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [moon] }]), /moon orbits a planet/);
    // A belt circles the star, a planet or a moon (where it is a ring)
    const ring = { kind: "BELT", type: "ice", orbit: 100000, width: 60000 };
    const belted = parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ kind: "BELT", orbit: 2.7, width: 1 }, { ...planet, children: [ring, { ...moon, children: [ring] }] }] }]);
    assert.deepEqual([belted.children[0].kind, belted.children[1].children[0].kind, belted.children[1].children[1].children[0].kind], ["BELT", "BELT", "BELT"]);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ kind: "STAR", type: "white" }] }]), /needs an orbit/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", orbit: 3 }]), /primary has no orbit/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ ...planet, children: [planet] }] }]), /planet orbits a star/);
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...planet, name: `P${i}` }));
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: many }]), /at most 1000/);
});

test("introOf keeps what stands before the first heading", async () => {
    const { introOf } = await import("../src/wiki/wiki.client.js");
    assert.equal(introOf("Barbona is an oceanic planet.\n\n\n== Weather ==\nStorms."), "Barbona is an oceanic planet.");
    assert.equal(introOf("One sentence. A second that is cut off by the lim..."), "One sentence.");
    assert.equal(introOf("\n\n== History ==\nOnly sections."), null);
    assert.equal(introOf(""), null);
});

test("a station's build year and iteration are its own, entered by hand", () => {
    const dock = { kind: "STATION", name: "Dock", orbit: 9000 };
    assert.deepEqual([parseBody(dock).builtYear, parseBody(dock).iteration], [null, null]);
    const built = parseBody({ ...dock, builtYear: 3016, iteration: 2 });
    assert.deepEqual([built.builtYear, built.iteration], [3016, 2]);
    // Before the Galactic Union's founding, even millions of years
    assert.equal(parseBody({ ...dock, builtYear: -2_000_000 }).builtYear, -2_000_000);
    assert.throws(() => parseBody({ ...dock, builtYear: 3016.5 }), /whole GUY year/);
    assert.throws(() => parseBody({ ...dock, iteration: 0 }), /iteration must be/);
    assert.throws(() => parseBody({ ...dock, iteration: 100 }), /iteration must be/);
    assert.throws(() => parseBody({ ...planet, builtYear: 3016 }), /Only a station has a builtYear/);
    assert.throws(() => parseBody({ ...planet, iteration: 1 }), /Only a station has an iteration/);
    assert.deepEqual(parseBody({ builtYear: null }, true, "STATION"), { builtYear: null });
});

test("a star or system is never named with one character", () => {
    assert.throws(() => parseBody({ kind: "STAR", name: "V", type: "sunlike" }), /at least two characters/);
    assert.throws(() => parsePlace({ kind: "SYSTEM", name: "V", x: 1, y: 1 }), /at least two characters/);
    assert.throws(() => parsePlace({ name: "V" }, true, "SYSTEM"), /at least two characters/);
    assert.equal(parseBody({ kind: "STAR", name: "Vo", type: "sunlike" }).name, "Vo");
    // Anything else may be
    assert.equal(parseBody({ ...planet, name: "X" }).name, "X");
    assert.equal(parsePlace({ kind: "LANDMARK", name: "X", x: 1, y: 1 }).name, "X");
});

test("nothing is named like its system's designations", () => {
    for (const name of ["Sol-3", "Sol-3a", "sol-12", "Sol-V", "Sol-IX.1", "Sol-6-I", "Sol-5.L4", "Sol.3016-02", "Sol-V(17)"]) assert.ok(designationLike(name, "Sol"), name);
    for (const name of ["Sol-Runner", "Sol-Mart", "Solaris-3", "Sol Station", "Earth", "Eflah II"]) assert.ok(!designationLike(name, "Sol"), name);
    assert.ok(!designationLike("Sol-3", null));
    assert.throws(() => checkNotDesignation("Eyacara-6", "Eyacara", "PLANET"), /Leave the name empty.*ordinal/);
    assert.throws(() => checkNotDesignation("Sol.3016-02", "Sol", "STATION"), /builtYear and iteration/);
    assert.doesNotThrow(() => checkNotDesignation("Ophiuchus-D", "Ophiuchus-D", "STAR"));
    const tree = (name: string) => [{ kind: "STAR", name: "Eyacara", type: "white", children: [{ ...planet, name }] }];
    assert.throws(() => parseBodyTree(tree("Eyacara-6")), /written like a designation/);
    assert.equal(parseBodyTree(tree("Barbona")).children[0].name, "Barbona");
});

test("a star may have companion stars, and a pair of stars or planets orbits its barycenter", () => {
    const moon = { kind: "MOON", type: "rocky", radiusKm: 1737, orbit: 384400 };
    // A companion orbits the primary with planets of its own
    const companion = parseBodyTree([{ kind: "STAR", name: "Gemella", type: "sunlike", children: [planet, { kind: "STAR", type: "red_dwarf", orbit: 40, children: [planet] }] }]);
    assert.equal(companion.children[1].children[0].kind, "PLANET");
    // A pair of stars as the primary, a planet round both, and a pair of planets in a planet's slot with a moon round both
    const pair = { kind: "BARYCENTER", type: "planets", orbit: 3, ordinal: 4, children: [{ ...planet, orbit: 9000 }, { ...planet, name: "Other", orbit: 11000 }, moon] };
    const tree = parseBodyTree([{ kind: "BARYCENTER", type: "stars", children: [{ kind: "STAR", type: "sunlike", orbit: 0.1 }, { kind: "STAR", type: "orange", orbit: 0.12 }, planet, pair] }]);
    assert.deepEqual(tree.children.map((c) => c.kind), ["STAR", "STAR", "PLANET", "BARYCENTER"]);
    assert.equal(tree.children[3].ordinal, 4);
    // A hierarchical triple: a pair inside a pair
    parseBodyTree([{ kind: "BARYCENTER", type: "stars", children: [{ kind: "STAR", type: "sunlike", orbit: 1 }, { kind: "BARYCENTER", type: "stars", orbit: 1.5, children: [{ kind: "STAR", type: "red_dwarf", orbit: 0.01 }] }] }]);

    assert.ok(canOrbit({ kind: "MOON", type: "rocky" }, { kind: "BARYCENTER", type: "planets" }));
    assert.ok(!canOrbit({ kind: "MOON", type: "rocky" }, { kind: "BARYCENTER", type: "stars" }));
    assert.ok(!canOrbit({ kind: "STAR", type: "sunlike" }, { kind: "BARYCENTER", type: "planets" }));
    assert.ok(!canOrbit({ kind: "BARYCENTER", type: "planets" }, null));
    assert.throws(() => parseBodyTree([{ kind: "BARYCENTER", type: "planets", orbit: 3, children: [planet] }]), /primary is a star or a pair of stars, not a pair of planets/);
    assert.throws(() => parseBodyTree([{ kind: "STAR", type: "sunlike", children: [{ ...planet, children: [{ kind: "BARYCENTER", type: "planets", orbit: 9000 }] }] }]), /pair of planets orbits a star or a pair of stars/);
    // One of a pair of planets leaves the planet number to the pair
    assert.throws(() => checkPlacement({ kind: "PLANET", type: "rocky", orbit: 9000, ordinal: 2 }, { kind: "BARYCENTER", type: "planets" }), /pair takes the planet number/);
    // A barycenter is a point of one of two types, and a planet pair alone takes an ordinal
    assert.throws(() => parseBody({ kind: "BARYCENTER", type: "moons" }), /type must be one of: stars, planets/);
    assert.throws(() => parseBody({ kind: "BARYCENTER", type: "stars", radiusKm: 5 }), /no radiusKm/);
    assert.throws(() => parseBody({ kind: "BARYCENTER", type: "stars", ordinal: 2 }), /Only a planet/);
    assert.throws(() => parseBody({ kind: "BARYCENTER", type: "planets" }), /orbit must be a number/);
    assert.throws(() => parseBody({ type: "planets" }, true, "BARYCENTER", "stars"), /cannot change between stars and planets/);
    assert.equal(parseBody({ ordinal: 5 }, true, "BARYCENTER", "planets").ordinal, 5);
});

test("a companion star named like a designation is refused too", () => {
    assert.ok(designationLike("Gemella-B", "Gemella"));
    assert.ok(designationLike("Gemella-AB", "Gemella"));
    assert.ok(!designationLike("Gemella Test B", "Gemella Test"));
    assert.throws(() => parseBodyTree([{ kind: "STAR", name: "Gemella", type: "sunlike", children: [{ kind: "STAR", name: "Gemella-B", type: "red_dwarf", orbit: 40 }] }]), /star goes by its designation/);
});
