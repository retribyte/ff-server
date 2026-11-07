// The running code's version, derived from git tags (see docs/versioning.md).
// MIRRORED in ff-site/src/lib/version.ts: keep parseDescribe identical.
//
// A release is a tag vMAJOR.MINOR.PATCH. Every commit after the nearest tag adds
// one to the patch, so `git describe` output like v1.1.0-14-g3fa9c2e reads 1.1.14.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface VersionInfo {
    version: string;
    commit: string;
}

const UNKNOWN: VersionInfo = { version: "unknown", commit: "unknown" };

/** `git describe --tags --long --dirty --match 'v[0-9]*'` output -> version, or null. */
export function parseDescribe(describe: string): VersionInfo | null {
    const m = /^v(\d+)\.(\d+)\.(\d+)-(\d+)-g([0-9a-f]+)(-dirty)?$/.exec(describe.trim());
    if (!m) return null;
    const [, major, minor, patch, ahead, commit, dirty] = m;
    return {
        version: `${major}.${minor}.${Number(patch) + Number(ahead)}${dirty ? "-dirty" : ""}`,
        commit,
    };
}

let cached: VersionInfo | undefined;

/**
 * Production: the deploy writes dist/version.json (the host has no git).
 * Dev: ask git, once per process.
 */
export function getVersion(): VersionInfo {
    if (cached) return cached;
    cached = UNKNOWN;
    const here = dirname(fileURLToPath(import.meta.url));
    try {
        const file = JSON.parse(readFileSync(new URL("../version.json", import.meta.url), "utf8"));
        if (typeof file.version === "string" && typeof file.commit === "string") {
            return (cached = { version: file.version, commit: file.commit });
        }
    } catch {
        // not a deployed build
    }
    try {
        const describe = execFileSync(
            "git",
            ["describe", "--tags", "--long", "--dirty", "--match", "v[0-9]*"],
            { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        );
        cached = parseDescribe(describe) ?? UNKNOWN;
    } catch {
        // no git, no tags, or a shallow clone
    }
    return cached;
}
