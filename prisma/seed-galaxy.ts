/**
 * FF galaxy seed — idempotent.
 *
 * Upserts the one canonical Final Frontier galaxy row that the space-builder
 * map/systems/landmarks hang off of. Touches ONLY the Galaxy table — safe to
 * re-run any time, unlike seed-legacy (which wipes everything).
 * Run with: npm run seed:galaxy
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const galaxy = await prisma.galaxy.upsert({
        where: { slug: "ff" },
        update: {},
        create: {
            slug: "ff",
            name: "Final Frontier",
            image: "/space/galaxy.png",
        },
    });
    console.log(`Galaxy '${galaxy.slug}' (id ${galaxy.id}) present.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
