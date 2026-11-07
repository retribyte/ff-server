/**
 * Files the `vm` story under a story-only SIDE season "VM" and sets
 * canon = false on the non-canon stories. Idempotent. A one-off for dev
 * databases; prod got the same steps from a prisma/prod-sql migration.
 *
 * Run with: npm run seed:story-shelf
 */
import { prisma } from "../../src/db.js";
import { storyShelf } from "../../src/jobs/storyShelf.js";

prisma
    .$transaction((tx) => storyShelf({ tx, log: console.log }))
    .then((summary) => console.log(`Story shelf: ${summary}.`))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
