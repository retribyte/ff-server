/**
 * Lints the OpenAPI spec. The spec is a TypeScript module (src/openapi.ts,
 * also served as Swagger UI at /api/docs), which Redocly can't read directly,
 * so this dumps it to a temporary JSON file and lints that. Exits with
 * Redocly's status: errors fail, warnings don't.
 *
 * Run with: npm run docs
 */
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import apiSpec from "../src/openapi.js";

const dir = mkdtempSync(join(tmpdir(), "ff-openapi-"));
const file = join(dir, "openapi.json");
writeFileSync(file, JSON.stringify(apiSpec, null, 2));

const result = spawnSync("npx", ["@redocly/cli", "lint", file], { stdio: "inherit" });
rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
