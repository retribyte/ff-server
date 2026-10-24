/**
 * FF 8-Ball answer seed — idempotent.
 *
 * Loads the canonical answer set from the legacy Discord bot. Does nothing
 * if the EightBallAnswer table already has rows.
 * Run with: npm run seed:8ball
 */
import { PrismaClient, EightBallAnswerType } from "@prisma/client";

const prisma = new PrismaClient();

const ANSWERS: { type: EightBallAnswerType; text: string }[] = [
    // YES
    { type: EightBallAnswerType.YES, text: "It is certain." },
    { type: EightBallAnswerType.YES, text: "It is decidedly so." },
    { type: EightBallAnswerType.YES, text: "Without a doubt." },
    { type: EightBallAnswerType.YES, text: "Yes, definitely." },
    { type: EightBallAnswerType.YES, text: "You may rely on it." },
    { type: EightBallAnswerType.YES, text: "As I see it, yes." },
    { type: EightBallAnswerType.YES, text: "Most likely." },
    { type: EightBallAnswerType.YES, text: "Outlook good." },
    { type: EightBallAnswerType.YES, text: "Yes." },
    { type: EightBallAnswerType.YES, text: "Signs point to yes." },
    // NO
    { type: EightBallAnswerType.NO, text: "Don't count on it." },
    { type: EightBallAnswerType.NO, text: "My reply is no." },
    { type: EightBallAnswerType.NO, text: "My sources say no." },
    { type: EightBallAnswerType.NO, text: "Outlook not so good." },
    { type: EightBallAnswerType.NO, text: "Very doubtful." },
    // MAYBE
    { type: EightBallAnswerType.MAYBE, text: "Reply hazy, try again." },
    { type: EightBallAnswerType.MAYBE, text: "Ask again later." },
    { type: EightBallAnswerType.MAYBE, text: "Better not tell you now." },
    { type: EightBallAnswerType.MAYBE, text: "Cannot predict now." },
    { type: EightBallAnswerType.MAYBE, text: "Concentrate and ask again." },
];

async function main() {
    const existing = await prisma.eightBallAnswer.count();
    if (existing > 0) {
        console.log(`EightBallAnswer already seeded (${existing} rows). Skipping.`);
        return;
    }

    await prisma.eightBallAnswer.createMany({ data: ANSWERS });
    console.log(`Seeded ${ANSWERS.length} EightBallAnswer rows.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
