/**
 * Story author backfill — idempotent.
 *
 * Story authorship lives in each manuscript's frontmatter
 * (ff-site/archive-to-markdown/md/stories/<slug>.md, `authors: Trey, Zander`)
 * and is applied at upload by story-md-to-api.py. Stories uploaded before
 * that (every one of them was credited to the Archivist) need the list
 * re-applied; this sets each story's authors to exactly its frontmatter list,
 * matched by slug. Vortox Machina has no manuscript (seed-legacy.ts builds it
 * from cyoa.json), so its credit is listed here, matching seed-legacy.ts.
 *
 * A username that doesn't exist is reported and that story is skipped, so a
 * missing account never silently drops a co-author.
 *
 * Run with: npm run backfill:story-authors
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HERE = dirname(fileURLToPath(import.meta.url));

// Same lookup as seed-legacy.ts: the checkout is ff-site or ff-site-new
function resolveFfSiteDir(): string {
    if (process.env.FF_SITE_DIR) return process.env.FF_SITE_DIR;
    const primary = resolve(HERE, "../../ff-site");
    if (existsSync(primary)) return primary;
    return resolve(HERE, "../../ff-site-new");
}
const STORIES_DIR = join(resolveFfSiteDir(), "archive-to-markdown/md/stories");

const NO_MANUSCRIPT: Record<string, string[]> = { vm: ["Archivist", "Zander"] };

/** `authors:` (or the older singular `author:`) from a manuscript's frontmatter. */
function frontmatterAuthors(path: string): string[] {
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines[0].trim() !== "---") return [];
    for (const line of lines.slice(1)) {
        if (line.trim() === "---") break;
        const match = /^(authors?):(.*)$/.exec(line);
        if (match) {
            return match[2].split("#", 1)[0].split(",").map((a) => a.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
        }
    }
    return [];
}

async function main() {
    const users = await prisma.user.findMany({ select: { id: true, username: true } });
    const idByUsername = new Map(users.map((u) => [u.username, u.id]));

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;

    const authorsBySlug = new Map(Object.entries(NO_MANUSCRIPT));
    for (const file of readdirSync(STORIES_DIR).filter((f) => f.endsWith(".md")).sort()) {
        authorsBySlug.set(file.replace(/\.md$/, ""), frontmatterAuthors(join(STORIES_DIR, file)));
    }

    for (const [slug, authors] of authorsBySlug) {
        const story = await prisma.story.findUnique({ where: { slug }, include: { authors: { select: { id: true } } } });
        if (!story) {
            console.log(`No story '${slug}' in the DB (not uploaded yet) — skipping.`);
            skipped++;
            continue;
        }
        const missing = authors.filter((a) => !idByUsername.has(a));
        if (missing.length > 0 || authors.length === 0) {
            console.log(`'${slug}': ${authors.length ? `no user ${missing.map((m) => `'${m}'`).join(", ")}` : "no authors in frontmatter"} — skipping.`);
            skipped++;
            continue;
        }
        const wanted = authors.map((a) => idByUsername.get(a)!).sort((a, b) => a - b);
        const current = story.authors.map((a) => a.id).sort((a, b) => a - b);
        if (wanted.join() === current.join()) {
            unchanged++;
            continue;
        }
        await prisma.story.update({ where: { id: story.id }, data: { authors: { set: wanted.map((id) => ({ id })) } } });
        console.log(`'${slug}': ${authors.join(", ")}`);
        updated++;
    }

    console.log(`Story authors: updated ${updated}, unchanged ${unchanged}, skipped ${skipped}.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
