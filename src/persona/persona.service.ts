import { PrismaClient } from "@prisma/client";
import { slugify } from "../utils/slug.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

const prisma = new PrismaClient();

type PersonaData = {
    name?: string;
    label?: string;
    slug?: string;
    image?: string;
    color?: string;
};

async function getPersonasByCharacter(characterId: number) {
    return await prisma.persona.findMany({ where: { characterId }, orderBy: { id: "asc" } });
}

// Full index of every persona, for callers (e.g. the transcript importer)
// that need to match speaker names against all characters in one call
// instead of N+1-ing over getPersonasByCharacter. No pagination — persona
// counts stay small.
async function getAllPersonas(search?: string) {
    const where = search ? { name: { contains: search } } : undefined;
    return await prisma.persona.findMany({ where, orderBy: { id: "asc" } });
}

async function getPersonaById(id: number) {
    return await prisma.persona.findUnique({ where: { id } });
}

// Slug defaults to `<character_slug>_<name_slug>` and, once set, never
// changes on its own — renaming the character or the persona never cascades.
// Name-less personas (look-only eras) get no slug: no URL identity.
async function createPersona(characterId: number, data: PersonaData) {
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new NotFoundError(`Character with id '${characterId}' not found`);
    }
    if (!data.name && !data.image && !data.color) {
        throw new BadRequestError("A persona must set at least one of name, image, or color");
    }
    if (!data.name && !data.label) {
        throw new BadRequestError("label is required when name is not set");
    }

    return await prisma.persona.create({
        data: {
            name: data.name,
            label: data.label,
            image: data.image,
            color: data.color,
            slug: data.name ? data.slug ?? `${slugify(character.name)}_${slugify(data.name)}` : undefined,
            characterId,
        },
    });
}

async function updatePersona(id: number, data: Partial<PersonaData>) {
    const existing = await prisma.persona.findUnique({ where: { id } });
    if (!existing) {
        throw new NotFoundError(`Persona with id '${id}' not found`);
    }

    const nextName = data.name !== undefined ? data.name : existing.name;
    const nextImage = data.image !== undefined ? data.image : existing.image;
    const nextColor = data.color !== undefined ? data.color : existing.color;
    const nextLabel = data.label !== undefined ? data.label : existing.label;
    if (!nextName && !nextImage && !nextColor) {
        throw new BadRequestError("A persona must set at least one of name, image, or color");
    }
    if (!nextName && !nextLabel) {
        throw new BadRequestError("label is required when name is not set");
    }

    return await prisma.persona.update({
        where: { id },
        data: {
            name: data.name,
            label: data.label,
            image: data.image,
            color: data.color,
            slug: data.slug,
        },
    });
}

async function deletePersona(id: number): Promise<void> {
    // Messages referencing this persona block deletion (FK restrict) — a
    // persona used in the archive shouldn't silently vanish out from under it.
    await prisma.persona.delete({ where: { id } });
}

export default {
    getPersonasByCharacter,
    getAllPersonas,
    getPersonaById,
    createPersona,
    updatePersona,
    deletePersona,
};
