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

export function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error("DATABASE_URL is not set");
    }
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma = createPrismaClient();
