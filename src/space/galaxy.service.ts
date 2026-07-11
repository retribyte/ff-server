import { PrismaClient, CelestialBodyType, BodyComposition } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

/** Sanitize a free-text field, passing through null/undefined unchanged (matches character.service's blurb handling). */
function sanitizeOpt(text: string | null | undefined): string | null | undefined {
    return text == null ? text : sanitizeText(text);
}

const CREATOR_SELECT = { select: { id: true, username: true } };
const VALID_COMPOSITIONS = new Set<string>(Object.values(BodyComposition));

// ---------- Galaxy ----------

type GalaxyData = {
    slug: string;
    name: string;
    description?: string | null;
    image?: string | null;
};

async function getAllGalaxies() {
    return await prisma.galaxy.findMany({ orderBy: { name: "asc" } });
}

async function requireGalaxy(slug: string) {
    const galaxy = await prisma.galaxy.findUnique({ where: { slug } });
    if (!galaxy) throw new Error(`Galaxy '${slug}' not found`);
    return galaxy;
}

/**
 * Public galaxy detail: the galaxy plus SLIM systems (id, name, position,
 * creatorId, and the system's star temperatureK/color so the map can color
 * markers without fetching every full body tree) and landmarks.
 */
async function getGalaxyBySlug(slug: string) {
    const galaxy = await prisma.galaxy.findUnique({
        where: { slug },
        include: {
            systems: {
                select: {
                    id: true,
                    name: true,
                    xPos: true,
                    yPos: true,
                    creatorId: true,
                    bodies: {
                        where: { type: CelestialBodyType.STAR },
                        select: { temperatureK: true, color: true },
                        take: 1,
                    },
                },
                orderBy: { name: "asc" },
            },
            landmarks: {
                select: {
                    id: true,
                    name: true,
                    description: true,
                    xPos: true,
                    yPos: true,
                    creatorId: true,
                },
                orderBy: { name: "asc" },
            },
        },
    });
    if (!galaxy) return null;

    return {
        ...galaxy,
        systems: galaxy.systems.map((system) => {
            const { bodies, ...rest } = system;
            const star = bodies[0];
            return {
                ...rest,
                star: star ? { temperatureK: star.temperatureK, color: star.color } : null,
            };
        }),
    };
}

function validateGalaxyData(data: Partial<GalaxyData>, requireAll: boolean) {
    if (requireAll || data.slug !== undefined) {
        if (typeof data.slug !== "string" || data.slug.length === 0) {
            throw new Error("slug is required");
        }
    }
    if (requireAll && (typeof data.name !== "string" || data.name.length === 0)) {
        throw new Error("name is required");
    }
}

async function createGalaxy(data: GalaxyData) {
    validateGalaxyData(data, true);
    return await prisma.galaxy.create({
        data: {
            slug: data.slug,
            name: data.name,
            description: sanitizeOpt(data.description) ?? null,
            image: data.image ?? null,
        },
    });
}

async function updateGalaxy(slug: string, data: Partial<GalaxyData>) {
    validateGalaxyData(data, false);
    const galaxy = await requireGalaxy(slug);
    return await prisma.galaxy.update({
        where: { id: galaxy.id },
        data: {
            slug: data.slug,
            name: data.name,
            description: sanitizeOpt(data.description),
            image: data.image,
        },
    });
}

async function deleteGalaxy(slug: string): Promise<void> {
    const galaxy = await requireGalaxy(slug);
    // Systems/landmarks intentionally still block deletion (like Character +
    // messages) — a populated galaxy shouldn't silently vanish. Delete its
    // systems/landmarks first if that's really the intent.
    await prisma.galaxy.delete({ where: { id: galaxy.id } });
}

// ---------- StarSystem ----------

type SystemMeta = {
    name: string;
    description?: string | null;
    wikiArticle?: string | null;
    xPos?: number | null;
    yPos?: number | null;
};

/** Plain system row (no relations) — used for creator/admin permission checks. */
async function getSystemRaw(id: number) {
    return await prisma.starSystem.findUnique({ where: { id } });
}

type TreeBody = {
    id: number;
    parentId: number | null;
    type: CelestialBodyType;
    name: string;
    radiusKm: number;
    distance: number | null;
    composition: BodyComposition | null;
    temperatureK: number | null;
    color: string | null;
    description: string | null;
    wikiArticle: string | null;
    children: TreeBody[];
};

function buildBodyTree(flat: Omit<TreeBody, "children">[]): TreeBody[] {
    const nodes = new Map<number, TreeBody>();
    for (const b of flat) nodes.set(b.id, { ...b, children: [] });
    const roots: TreeBody[] = [];
    for (const b of flat) {
        const node = nodes.get(b.id)!;
        if (b.parentId === null) {
            roots.push(node);
        } else {
            nodes.get(b.parentId)?.children.push(node);
        }
    }
    return roots;
}

/** Full system: metadata, creator {id, username}, and the nested body tree (star → planets → moons). */
async function getSystemById(id: number) {
    const system = await prisma.starSystem.findUnique({
        where: { id },
        include: { creator: CREATOR_SELECT, bodies: true },
    });
    if (!system) return null;
    const { bodies, ...rest } = system;
    return { ...rest, bodies: buildBodyTree(bodies) };
}

async function createSystem(
    gSlug: string,
    data: { name: string; description?: string | null; xPos?: number | null; yPos?: number | null },
    creatorId: number,
) {
    const galaxy = await requireGalaxy(gSlug);
    if (typeof data.name !== "string" || data.name.length === 0) {
        throw new Error("name is required");
    }
    return await prisma.starSystem.create({
        data: {
            galaxyId: galaxy.id,
            name: data.name,
            description: sanitizeOpt(data.description) ?? null,
            xPos: data.xPos ?? null,
            yPos: data.yPos ?? null,
            creatorId,
        },
        include: { creator: CREATOR_SELECT },
    });
}

async function updateSystemMeta(id: number, data: Partial<SystemMeta>) {
    return await prisma.starSystem.update({
        where: { id },
        data: {
            name: data.name,
            description: sanitizeOpt(data.description),
            wikiArticle: data.wikiArticle,
            xPos: data.xPos,
            yPos: data.yPos,
        },
        include: { creator: CREATOR_SELECT },
    });
}

async function deleteSystem(id: number): Promise<void> {
    await prisma.$transaction([
        prisma.celestialBody.deleteMany({ where: { systemId: id } }),
        prisma.starSystem.delete({ where: { id } }),
    ]);
}

// ---------- Whole-tree body replace ----------
//
// Request shape for PUT /systems/:id/bodies:
//
// {
//   "star": {
//     "name": string, "radiusKm": number>0, "temperatureK": number,
//     "color"?: string, "description"?: string, "wikiArticle"?: string,
//     "planets": [
//       {
//         "name": string, "radiusKm": number>0, "distance": number (AU from star),
//         "composition": "TERRESTRIAL"|"GAS"|"ICE",
//         "color"?: string, "description"?: string, "wikiArticle"?: string,
//         "moons": [
//           {
//             "name": string, "radiusKm": number>0, "distance": number (km from planet),
//             "composition": "TERRESTRIAL"|"GAS"|"ICE",
//             "color"?: string, "description"?: string, "wikiArticle"?: string
//           }
//         ]
//       }
//     ]
//   }
// }
//
// `star` is a single object — the system's one root. `star.planets` and each
// planet's `moons` are optional arrays (empty/omitted = no children yet).
// A `moons` array on the star itself, or `star` sent as an array/missing, is
// rejected (see validateAndFlattenTree).

type FlatBody = {
    parentIndex: number | null;
    type: CelestialBodyType;
    name: string;
    radiusKm: number;
    distance: number | null;
    composition: BodyComposition | null;
    temperatureK: number | null;
    color: string | null;
    description: string | null;
    wikiArticle: string | null;
};

function validateAndFlattenTree(input: any): FlatBody[] {
    if (Array.isArray(input)) {
        throw new Error(`system must have exactly one star (root); got ${input.length}`);
    }
    if (!input || typeof input !== "object") {
        throw new Error("system must have exactly one star (root); got 0");
    }

    const seenNames = new Set<string>();
    function claimName(name: unknown, label: string) {
        if (typeof name !== "string" || name.trim().length === 0) {
            throw new Error(`${label}: name is required`);
        }
        if (seenNames.has(name)) {
            throw new Error(`duplicate body name: '${name}'`);
        }
        seenNames.add(name);
    }
    function checkRadius(radiusKm: unknown, label: string) {
        if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm) || radiusKm <= 0) {
            throw new Error(`${label}: radiusKm must be a positive number`);
        }
    }
    function checkComposition(composition: unknown, label: string) {
        if (typeof composition !== "string" || !VALID_COMPOSITIONS.has(composition)) {
            throw new Error(`${label}: composition must be one of ${[...VALID_COMPOSITIONS].join(", ")}`);
        }
    }

    const flat: FlatBody[] = [];

    // star (root)
    claimName(input.name, "star");
    checkRadius(input.radiusKm, `star '${input.name}'`);
    if (input.moons !== undefined) {
        throw new Error("moons must be nested under a planet, not the star");
    }
    const starIndex = flat.length;
    flat.push({
        parentIndex: null,
        type: CelestialBodyType.STAR,
        name: input.name,
        radiusKm: input.radiusKm,
        distance: null,
        composition: null,
        temperatureK: typeof input.temperatureK === "number" ? input.temperatureK : null,
        color: input.color ?? null,
        description: sanitizeOpt(input.description) ?? null,
        wikiArticle: input.wikiArticle ?? null,
    });

    const planets = input.planets ?? [];
    if (!Array.isArray(planets)) {
        throw new Error("star.planets must be an array");
    }
    for (const planet of planets) {
        if (!planet || typeof planet !== "object" || Array.isArray(planet)) {
            throw new Error("each planet must be an object");
        }
        claimName(planet.name, "planet");
        checkRadius(planet.radiusKm, `planet '${planet.name}'`);
        checkComposition(planet.composition, `planet '${planet.name}'`);
        const planetIndex = flat.length;
        flat.push({
            parentIndex: starIndex,
            type: CelestialBodyType.PLANET,
            name: planet.name,
            radiusKm: planet.radiusKm,
            distance: typeof planet.distance === "number" ? planet.distance : null,
            composition: planet.composition,
            temperatureK: null,
            color: planet.color ?? null,
            description: sanitizeOpt(planet.description) ?? null,
            wikiArticle: planet.wikiArticle ?? null,
        });

        const moons = planet.moons ?? [];
        if (!Array.isArray(moons)) {
            throw new Error(`planet '${planet.name}': moons must be an array`);
        }
        for (const moon of moons) {
            if (!moon || typeof moon !== "object" || Array.isArray(moon)) {
                throw new Error("each moon must be an object");
            }
            claimName(moon.name, "moon");
            checkRadius(moon.radiusKm, `moon '${moon.name}'`);
            checkComposition(moon.composition, `moon '${moon.name}'`);
            flat.push({
                parentIndex: planetIndex,
                type: CelestialBodyType.MOON,
                name: moon.name,
                radiusKm: moon.radiusKm,
                distance: typeof moon.distance === "number" ? moon.distance : null,
                composition: moon.composition,
                temperatureK: null,
                color: moon.color ?? null,
                description: sanitizeOpt(moon.description) ?? null,
                wikiArticle: moon.wikiArticle ?? null,
            });
        }
    }

    return flat;
}

/**
 * Transactional whole-tree replace: validates the incoming star/planets/moons
 * payload, then deletes all existing bodies for the system and recreates the
 * tree in one transaction. Body ids may change on every save — the system id
 * is the stable handle for callers.
 */
async function replaceBodies(systemId: number, starInput: any) {
    const flat = validateAndFlattenTree(starInput);

    await prisma.$transaction(async (tx) => {
        await tx.celestialBody.deleteMany({ where: { systemId } });
        const createdIds: number[] = [];
        for (const b of flat) {
            const created = await tx.celestialBody.create({
                data: {
                    systemId,
                    parentId: b.parentIndex === null ? null : createdIds[b.parentIndex],
                    type: b.type,
                    name: b.name,
                    radiusKm: b.radiusKm,
                    distance: b.distance,
                    composition: b.composition,
                    temperatureK: b.temperatureK,
                    color: b.color,
                    description: b.description,
                    wikiArticle: b.wikiArticle,
                },
            });
            createdIds.push(created.id);
        }
    });

    return await getSystemById(systemId);
}

// ---------- Landmark ----------

type LandmarkData = {
    name: string;
    description?: string | null;
    xPos: number;
    yPos: number;
    wikiArticle?: string | null;
};

async function getLandmarkRaw(id: number) {
    return await prisma.landmark.findUnique({ where: { id } });
}

async function createLandmark(gSlug: string, data: Partial<LandmarkData>, creatorId: number) {
    const galaxy = await requireGalaxy(gSlug);
    if (typeof data.name !== "string" || data.name.length === 0) {
        throw new Error("name is required");
    }
    if (typeof data.xPos !== "number" || typeof data.yPos !== "number") {
        throw new Error("xPos and yPos are required numbers");
    }
    return await prisma.landmark.create({
        data: {
            galaxyId: galaxy.id,
            name: data.name,
            description: sanitizeOpt(data.description) ?? null,
            xPos: data.xPos,
            yPos: data.yPos,
            creatorId,
            wikiArticle: data.wikiArticle ?? null,
        },
    });
}

async function updateLandmark(id: number, data: Partial<LandmarkData>) {
    return await prisma.landmark.update({
        where: { id },
        data: {
            name: data.name,
            description: sanitizeOpt(data.description),
            xPos: data.xPos,
            yPos: data.yPos,
            wikiArticle: data.wikiArticle,
        },
    });
}

async function deleteLandmark(id: number): Promise<void> {
    await prisma.landmark.delete({ where: { id } });
}

export default {
    getAllGalaxies,
    getGalaxyBySlug,
    createGalaxy,
    updateGalaxy,
    deleteGalaxy,
    getSystemRaw,
    getSystemById,
    createSystem,
    updateSystemMeta,
    replaceBodies,
    deleteSystem,
    getLandmarkRaw,
    createLandmark,
    updateLandmark,
    deleteLandmark,
};
