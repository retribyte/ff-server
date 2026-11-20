import { prisma } from "../db.js";
import { PORTRAITS_PER_USER, PortraitInputError, type PortraitInput } from "./saved.validation.js";

// Portraits members keep (table `portraits`): a name, the creator's recipe and the PNG it
// drew. Each is private to its owner; admins may read and delete any. The input rules are
// in saved.validation.ts.

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
