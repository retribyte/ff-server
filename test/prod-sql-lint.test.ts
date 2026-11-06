import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function lint(sql: string): { status: number | null; output: string } {
    const dir = mkdtempSync(join(tmpdir(), "prod-sql-lint-"));
    try {
        const file = join(dir, "x.sql");
        writeFileSync(file, sql);
        const run = spawnSync("bash", ["scripts/lint-prod-sql.sh", file], { encoding: "utf8" });
        return { status: run.status, output: run.stdout + run.stderr };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const BLOCKED: [string, string][] = [
    ["drop table", `DROP TABLE "items";`],
    ["drop column", `ALTER TABLE "items" DROP COLUMN "name";`],
    ["drop without the word COLUMN, quoted", `ALTER TABLE items DROP "name";`],
    ["drop without the word COLUMN, bare", `ALTER TABLE items DROP name;`],
    ["prisma's rename", `ALTER TABLE "items" DROP COLUMN "a",\nADD COLUMN "b" TEXT;`],
    ["drop type", `DROP TYPE "Kind_old";`],
    ["truncate", `TRUNCATE items;`],
    ["delete", `DELETE FROM "User";`],
    ["delete after another statement", `SELECT 1; DELETE FROM "User";`],
    ["update", `UPDATE "User" SET bio = '';`],
    ["column type", `ALTER TABLE items ALTER COLUMN "a" SET DATA TYPE INTEGER;`],
    ["column type, short form", `ALTER TABLE items ALTER COLUMN a TYPE integer;`],
    ["not null without default", `ALTER TABLE "items" ADD COLUMN "a" TEXT NOT NULL;`],
];

for (const [name, sql] of BLOCKED) {
    test(`lint-prod-sql blocks ${name}`, () => {
        assert.equal(lint(sql).status, 1);
    });

    test(`lint-prod-sql lets ${name} through with a reason`, () => {
        const { status, output } = lint(`-- reviewed: checked against prod\n${sql}`);
        assert.equal(status, 0);
        assert.match(output, /::warning/);
    });
}

const ALLOWED: [string, string][] = [
    ["a nullable column", `ALTER TABLE "items" ADD COLUMN "a" TEXT;`],
    ["not null with a default", `ALTER TABLE "items" ADD COLUMN "a" TEXT NOT NULL DEFAULT '';`],
    ["a new table", `CREATE TABLE "x" (\n    "id" SERIAL NOT NULL,\n    CONSTRAINT "x_pkey" PRIMARY KEY ("id")\n);`],
    ["dropping a default", `ALTER TABLE items ALTER COLUMN a DROP DEFAULT;`],
    ["dropping not null", `ALTER TABLE items ALTER COLUMN a DROP NOT NULL;`],
    ["dropping an index", `DROP INDEX "items_a_idx";`],
    ["dropping a constraint", `ALTER TABLE items DROP CONSTRAINT "items_fkey";`],
    ["a foreign key's ON DELETE and ON UPDATE", `ALTER TABLE "x" ADD COLUMN "y" INTEGER;\nALTER TABLE "x" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("y") REFERENCES "z"("id") ON DELETE CASCADE ON UPDATE CASCADE;`],
    ["a comment that mentions DROP TABLE", `-- not a DROP TABLE\nSELECT 1;`],
];

for (const [name, sql] of ALLOWED) {
    test(`lint-prod-sql allows ${name}`, () => {
        assert.equal(lint(sql).status, 0);
    });
}

test("lint-prod-sql wants an actual reason", () => {
    assert.equal(lint(`-- reviewed:\nDELETE FROM "User";`).status, 1);
});

test("lint-prod-sql only warns about constraints that depend on the rows", () => {
    for (const sql of [
        `CREATE UNIQUE INDEX "x_key" ON "items"("a");`,
        `ALTER TABLE items ALTER COLUMN a SET NOT NULL;`,
        `ALTER TABLE "x" ADD CONSTRAINT "x_fkey" FOREIGN KEY ("y") REFERENCES "z"("id");`,
    ]) {
        const { status, output } = lint(sql);
        assert.equal(status, 0, sql);
        assert.match(output, /::warning/, sql);
    }
});
