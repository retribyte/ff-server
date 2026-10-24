/**
 * Go-live account flags for an already-seeded database (seed-legacy.ts sets
 * the same flags on a fresh one):
 *   - every account that has never changed its password must pick its own
 *     on next login (mustChangePassword) — seeded passwords are placeholders
 *   - system accounts (SYSTEM_ACCOUNTS: the Archivist, the FF 8 Ball bot)
 *     can't log in at all (loginDisabled)
 *
 * Idempotent: accounts that already changed their password are left alone,
 * so re-running it never forces anyone through the change twice.
 *
 * Run with: npm run golive:flag-accounts
 */
import { PrismaClient } from "@prisma/client";
import { SYSTEM_ACCOUNTS } from "./system-accounts.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const disabled = await prisma.user.updateMany({
        where: { username: { in: SYSTEM_ACCOUNTS }, OR: [{ loginDisabled: false }, { mustChangePassword: true }] },
        data: { loginDisabled: true, mustChangePassword: false },
    });
    const flagged = await prisma.user.updateMany({
        where: { passwordChangedAt: null, loginDisabled: false, mustChangePassword: false },
        data: { mustChangePassword: true },
    });
    console.log(`Login disabled: ${disabled.count} system account(s).`);
    console.log(`Password change required: ${flagged.count} account(s) newly flagged.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
