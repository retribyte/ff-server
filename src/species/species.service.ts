import { PrismaClient, Class } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

type SpeciesData = {
    name: string;
    description: string;
    binomialName?: string;
    class: Class;
    lifespan: string;
    diet?: string;
    habitat?: string;
    placeOfOrigin?: string;
    creatorId: number;
};

async function getAllSpecies(search?: string) {
    const where = search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : undefined;
    return await prisma.species.findMany({
        where,
        include: { Character: true },
    });
}

async function getSpeciesById(id: number) {
    return await prisma.species.findUnique({
        where: { id },
        include: { Character: true },
    });
}

async function createSpecies(data: SpeciesData) {
    return await prisma.species.create({
        data: {
            name: data.name,
            description: sanitizeText(data.description),
            binomialName: data.binomialName,
            class: data.class,
            lifespan: data.lifespan,
            diet: data.diet,
            habitat: data.habitat,
            placeOfOrigin: data.placeOfOrigin,
            creatorId: data.creatorId,
        },
        include: { Character: true },
    });
}

async function updateSpecies(id: number, data: Partial<SpeciesData>) {
    return await prisma.species.update({
        where: { id },
        data: {
            name: data.name,
            description: data.description !== undefined ? sanitizeText(data.description) : undefined,
            binomialName: data.binomialName,
            class: data.class,
            lifespan: data.lifespan,
            diet: data.diet,
            habitat: data.habitat,
            placeOfOrigin: data.placeOfOrigin,
        },
        include: { Character: true },
    });
}

async function deleteSpecies(id: number): Promise<void> {
    await prisma.species.delete({ where: { id } });
}

export default { getAllSpecies, getSpeciesById, createSpecies, updateSpecies, deleteSpecies };
