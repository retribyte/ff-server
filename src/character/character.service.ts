import { PrismaClient, Sex } from "@prisma/client";

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
    creatorId: number;
    aliases?: { name: string }[];
    relationships?: { description: string }[];
};

async function getAllCharacters() {
    return await prisma.character.findMany({
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
            creatorId: data.creatorId,
            aliases: data.aliases ? { create: data.aliases } : undefined,
            relationships: data.relationships
                ? { create: data.relationships }
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
            dob: data.dob ? Math.floor(new Date(data.dob).getTime() / 1000) : null,
            pob: data.pob,
            homePlanet: data.homePlanet,
            speciesId: data.speciesId,
            sex: data.sex,
            height: data.height,
            weight: data.weight,
            hairColor: data.hairColor,
            eyeColor: data.eyeColor,
            creatorId: data.creatorId,
            aliases: data.aliases
                ? { deleteMany: {}, create: data.aliases }
                : undefined,
            relationships: data.relationships
                ? { deleteMany: {}, create: data.relationships }
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
