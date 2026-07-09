import { PrismaClient, EightBallAnswerType } from "@prisma/client";

const prisma = new PrismaClient();

// Weighted odds for the shake, considering only answer types that currently
// have at least one row. Weights are renormalized over the non-empty types.
const TYPE_WEIGHTS: Record<EightBallAnswerType, number> = {
    [EightBallAnswerType.YES]: 2,
    [EightBallAnswerType.NO]: 1,
    [EightBallAnswerType.MAYBE]: 1,
};

async function getAllAnswers() {
    return await prisma.eightBallAnswer.findMany({
        orderBy: [{ type: "asc" }, { id: "asc" }],
    });
}

async function shake() {
    const counts = await prisma.eightBallAnswer.groupBy({
        by: ["type"],
        _count: { _all: true },
    });
    const availableTypes = counts.filter((c) => c._count._all > 0).map((c) => c.type);
    if (availableTypes.length === 0) {
        return null;
    }

    const totalWeight = availableTypes.reduce((sum, type) => sum + TYPE_WEIGHTS[type], 0);
    let roll = Math.random() * totalWeight;
    let chosenType = availableTypes[availableTypes.length - 1];
    for (const type of availableTypes) {
        roll -= TYPE_WEIGHTS[type];
        if (roll < 0) {
            chosenType = type;
            break;
        }
    }

    const answers = await prisma.eightBallAnswer.findMany({ where: { type: chosenType } });
    return answers[Math.floor(Math.random() * answers.length)];
}

async function createAnswer(type: EightBallAnswerType, text: string) {
    return await prisma.eightBallAnswer.create({ data: { type, text } });
}

async function getAnswerById(id: number) {
    return await prisma.eightBallAnswer.findUnique({ where: { id } });
}

async function deleteAnswer(id: number): Promise<void> {
    await prisma.eightBallAnswer.delete({ where: { id } });
}

export default { getAllAnswers, shake, createAnswer, getAnswerById, deleteAnswer };
