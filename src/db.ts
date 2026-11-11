// The one place a PrismaClient is built. Import `prisma` from here instead of
// calling `new PrismaClient()`.
//
// The client uses the Rust-free engine (`engineType = "client"` in
// schema.prisma) with @prisma/adapter-pg, because production runs on FreeBSD,
// where Prisma ships no native engines. Each client owns a pg connection pool,
// so share this singleton. Separate clients would each open their own pool and
// quickly exceed Postgres's max_connections.

// Load .env before anything reads process.env. Older Prisma clients loaded it
// implicitly on import; don't rely on that.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ARCHIVE_MODELS, WRITE_OPERATIONS, archiveGeneration, bumpArchiveGeneration } from "./utils/archive-generation.js";

export function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Every write to an archive model bumps the archive generation, so in-memory
// caches of archive-derived values (src/utils/word-counts.ts) recompute.
function trackArchiveWrites(client: PrismaClient): PrismaClient {
    const tracked = client.$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    const result = await query(args);
                    if (ARCHIVE_MODELS.has(model) && WRITE_OPERATIONS.has(operation)) bumpArchiveGeneration();
                    return result;
                },
            },
        },
    });
    // A write inside a transaction returns before the transaction commits, and
    // a reader recomputing in that gap would still see the old rows. So bump
    // again once a transaction that wrote archive rows has finished (committed
    // or rolled back).
    const transaction = tracked.$transaction.bind(tracked) as (...args: unknown[]) => Promise<unknown>;
    (tracked as { $transaction: unknown }).$transaction = async (...args: unknown[]) => {
        const before = archiveGeneration();
        try {
            return await transaction(...args);
        } finally {
            if (archiveGeneration() !== before) bumpArchiveGeneration();
        }
    };
    // A query-only extension leaves the client's API as it was, but its
    // generated type no longer matches Prisma.TransactionClient, which the
    // services pass `tx` around as.
    return tracked as unknown as PrismaClient;
}

export const prisma = trackArchiveWrites(createPrismaClient());
