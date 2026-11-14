import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { decodePngDataUrl } from "../utils/avatar-image.js";

// Portraits members keep (table `portraits`): a name, the creator's recipe and the PNG it
// drew. Each is private to its owner; admins may read and delete any.

/** The frame is 43x43 and grows for the few items with larger sprites. */
export const PORTRAIT_MAX_SIDE = 256;
export const PORTRAIT_MAX_BYTES = 64 * 1024;
export const RECIPE_MAX_BYTES = 32 * 1024;
export const NAME_MAX = 100;
/** Per member, so the table cannot be filled by one account. */
export const PORTRAITS_PER_USER = 300;

/** The body breaks a rule; the message is shown to the member. */
export class PortraitInputError extends Error {}

export interface PortraitInput {
    name: string;
    race: string;
    recipe: Prisma.InputJsonObject;
    image: Buffer;
}

/** A save request's body, checked. With `partial`, only the fields sent are checked and returned. */
export function parsePortrait(body: unknown, partial = false): Partial<PortraitInput> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new PortraitInputError("Send name, race, recipe and image");
    const o = body as Record<string, unknown>;
    const out: Partial<PortraitInput> = {};
    const has = (key: string) => {
        if (o[key] !== undefined) return true;
        if (!partial) throw new PortraitInputError(`${key} is required`);
        return false;
    };
    if (has("name")) {
        if (typeof o.name !== "string" || !o.name.trim() || o.name.trim().length > NAME_MAX) throw new PortraitInputError(`A portrait needs a name of at most ${NAME_MAX} characters`);
        out.name = o.name.trim();
    }
    if (has("race")) {
        if (typeof o.race !== "string" || !o.race || o.race.length > 200) throw new PortraitInputError("race must be the creator's race id");
        out.race = o.race;
    }
    if (has("recipe")) {
        const r = o.recipe as Record<string, unknown>;
        if (typeof r !== "object" || r === null || Array.isArray(r) || typeof r.species !== "string" || typeof r.v !== "number") throw new PortraitInputError("recipe must be a portrait recipe");
        if (JSON.stringify(r).length > RECIPE_MAX_BYTES) throw new PortraitInputError("That recipe is too large to keep");
        out.recipe = r as Prisma.InputJsonObject;
    }
    if (has("image")) {
        if (typeof o.image !== "string") throw new PortraitInputError("image must be a PNG data: URL");
        try {
            out.image = decodePngDataUrl(o.image, PORTRAIT_MAX_SIDE, PORTRAIT_MAX_BYTES, "Portraits");
        } catch (error) {
            throw new PortraitInputError(error instanceof Error ? error.message : "That image can't be kept");
        }
    }
    return out;
}

const SUMMARY = { id: true, name: true, race: true, ownerId: true, createdAt: true, updatedAt: true } as const;

/** A member's portraits, newest change first, without recipes or images. */
async function getPortraitsByOwner(ownerId: number) {
    return prisma.portrait.findMany({ where: { ownerId }, select: SUMMARY, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] });
}

/** One portrait with its recipe (no image bytes); null if there is none. */
async function getPortraitById(id: number) {
    return prisma.portrait.findUnique({ where: { id }, select: { ...SUMMARY, recipe: true } });
}

/** A portrait's PNG and who owns it; null if there is none. */
async function getPortraitImage(id: number) {
    return prisma.portrait.findUnique({ where: { id }, select: { ownerId: true, image: true, updatedAt: true } });
}

async function createPortrait(ownerId: number, input: PortraitInput) {
    if ((await prisma.portrait.count({ where: { ownerId } })) >= PORTRAITS_PER_USER) {
        throw new PortraitInputError(`You have ${PORTRAITS_PER_USER} saved portraits, which is the most one member can keep. Delete some first.`);
    }
    return prisma.portrait.create({ data: { ownerId, name: input.name, race: input.race, recipe: input.recipe, image: new Uint8Array(input.image) }, select: SUMMARY });
}

async function updatePortrait(id: number, input: Partial<PortraitInput>) {
    const { image, ...rest } = input;
    return prisma.portrait.update({ where: { id }, data: { ...rest, ...(image ? { image: new Uint8Array(image) } : {}) }, select: SUMMARY });
}

async function deletePortrait(id: number) {
    await prisma.portrait.delete({ where: { id } });
}

export default { getPortraitsByOwner, getPortraitById, getPortraitImage, createPortrait, updatePortrait, deletePortrait };
