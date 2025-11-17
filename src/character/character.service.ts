import { PrismaClient, Sex } from "@prisma/client";
import App from "../app.js";
import { Request, Response } from "express";

type CreateCharacterBody = {
    name: string;
    dob?: string; // Date of birth
    pob?: string; // Place of birth
    homePlanet?: string;
    speciesId: number; // Foreign key to Species
    sex: Sex;
    height?: number; // Height in meters
    weight?: number; // Weight in kilograms
    hairColor?: string;
    eyeColor?: string;
    creatorId: number; // Foreign key to User
    aliases?: { name: string }[]; // Array of alias objects with only the `name` field
    relationships?: { description: string }[]; // Array of relationship objects with a `description`
};

export class CharacterService {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = App.prisma;
    }

    async createCharacter(
        req: Request<{}, {}, CreateCharacterBody>,
        res: Response
    ) {
        const {
            name,
            dob,
            pob,
            aliases,
            relationships,
            homePlanet,
            speciesId,
            sex,
            height,
            weight,
            hairColor,
            eyeColor,
            creatorId,
        } = req.body;

        try {
            const newCharacter = await this.prisma.character.create({
                data: {
                    name,
                    dob: dob ? Math.floor(new Date(dob).getTime() / 1000) : null,
                    pob,
                    homePlanet,
                    speciesId,
                    sex,
                    height,
                    weight,
                    hairColor,
                    eyeColor,
                    creatorId,
                    aliases: aliases ? { create: aliases } : undefined,
                    relationships: relationships
                        ? { create: relationships }
                        : undefined,
                },
                include: {
                    aliases: true,
                    relationships: true,
                },
            });

            res.status(201).json(newCharacter);
        } catch (err) {
            res.status(400).json({ error: (err as Error).message });
        }
    }

    async getAllCharacters(_req: Request, res: Response) {
        try {
            const characters = await this.prisma.character.findMany({
                include: {
                    aliases: true,
                    relationships: true,
                },
            });

            res.status(200).json(characters);
        } catch (err) {
            res.status(500).json({ error: (err as Error).message });
        }
    }

    async getCharacterById(req: Request, res: Response) {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await this.prisma.character.findUnique({
                where: { id },
                include: {
                    aliases: true,
                    relationships: true,
                },
            });

            if (!character) {
                return res.status(404).json({ error: "Character not found" });
            }

            res.status(200).json(character);
        } catch (err) {
            res.status(400).json({ error: (err as Error).message });
        }
    }

    async updateCharacter(req: Request, res: Response) {
        const id = parseInt(req.params.id, 10);
        const {
            name,
            dob,
            pob,
            aliases,
            relationships,
            homePlanet,
            speciesId,
            sex,
            height,
            weight,
            hairColor,
            eyeColor,
            creatorId,
        } = req.body;

        try {
            const updatedCharacter = await this.prisma.character.update({
                where: { id },
                data: {
                    name,
                    dob: dob ? Math.floor(new Date(dob).getTime() / 1000) : null,
                    pob,
                    homePlanet,
                    speciesId,
                    sex,
                    height,
                    weight,
                    hairColor,
                    eyeColor,
                    creatorId,
                    aliases: aliases
                        ? { deleteMany: {}, create: aliases }
                        : undefined,
                    relationships: relationships
                        ? { deleteMany: {}, create: relationships }
                        : undefined,
                },
                include: {
                    aliases: true,
                    relationships: true,
                },
            });

            res.status(200).json(updatedCharacter);
        } catch (err) {
            res.status(400).json({ error: (err as Error).message });
        }
    }

    async deleteCharacter(req: Request, res: Response) {
        const id = parseInt(req.params.id, 10);

        try {
            await this.prisma.character.delete({
                where: { id },
            });

            res.status(204).send();
        } catch (err) {
            res.status(400).json({ error: (err as Error).message });
        }
    }
}
