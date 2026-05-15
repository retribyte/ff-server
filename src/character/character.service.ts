import { PrismaClient, Sex } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

type CharacterData = {
    name: string;
    dob?: string;
    pob?: string;
    homePlanet?: string;
    speciesId: number;
    sex: Sex;
    height?: number;
    weight?: number;
    hairColor?: string;
    eyeColor?: string;
    blurb?: string;
    creatorId: number;
    aliases?: { name: string }[];
    relationships?: { description: string }[];
};

type CharacterFilters = {
    search?: string;
    speciesId?: number;
    ownerId?: number;
    season?: string;
};

async function getAllCharacters(filters: CharacterFilters = {}) {
    const { search, speciesId, ownerId, season } = filters;
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { aliases: { some: { name: { contains: search, mode: "insensitive" } } } },
        ];
    }
    if (speciesId !== undefined) where.speciesId = speciesId;
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    return await prisma.character.findMany({
        where,
        include: { aliases: true, relationships: true },
    });
}

async function getCharacterById(id: number) {
    return await prisma.character.findUnique({
        where: { id },
        include: { aliases: true, relationships: true },
    });
}

async function createCharacter(data: CharacterData) {
    return await prisma.character.create({
        data: {
            name: data.name,
            dob: data.dob ? Math.floor(new Date(data.dob).getTime() / 1000) : null,
            pob: data.pob,
            homePlanet: data.homePlanet,
            speciesId: data.speciesId,
            sex: data.sex,
            height: data.height,
            weight: data.weight,
            hairColor: data.hairColor,
            eyeColor: data.eyeColor,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            creatorId: data.creatorId,
            aliases: data.aliases ? { create: data.aliases } : undefined,
            relationships: data.relationships
                ? { create: data.relationships.map(r => ({ description: sanitizeText(r.description) })) }
                : undefined,
        },
        include: { aliases: true, relationships: true },
    });
}

async function updateCharacter(id: number, data: Partial<CharacterData>) {
    return await prisma.character.update({
        where: { id },
        data: {
            name: data.name,
            dob: data.dob ? Math.floor(new Date(data.dob).getTime() / 1000) : undefined,
            pob: data.pob,
            homePlanet: data.homePlanet,
            speciesId: data.speciesId,
            sex: data.sex,
            height: data.height,
            weight: data.weight,
            hairColor: data.hairColor,
            eyeColor: data.eyeColor,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            aliases: data.aliases
                ? { deleteMany: {}, create: data.aliases }
                : undefined,
            relationships: data.relationships
                ? { deleteMany: {}, create: data.relationships.map(r => ({ description: sanitizeText(r.description) })) }
                : undefined,
        },
        include: { aliases: true, relationships: true },
    });
}

async function deleteCharacter(id: number): Promise<void> {
    await prisma.character.delete({ where: { id } });
}

export default {
    getAllCharacters,
    getCharacterById,
    createCharacter,
    updateCharacter,
    deleteCharacter,
};
