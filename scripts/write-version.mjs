// Writes dist/version.json for a deploy: the host has no git, so the running code
// (src/utils/version.ts) reads its version from this file. Run after `tsc`.
// Needs the release tags, so CI checks out with fetch-depth: 0.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseDescribe } from "../dist/utils/version.js";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
let describe = "";
try {
    describe = git("describe", "--tags", "--long", "--match", "v[0-9]*");
} catch {
    // no tags (shallow clone): fall through to "unknown"
}
const version = parseDescribe(describe) ?? { version: "unknown", commit: git("rev-parse", "--short", "HEAD") };
writeFileSync(new URL("../dist/version.json", import.meta.url), JSON.stringify(version) + "\n");
console.log(`== version ${version.version} (${version.commit})`);
