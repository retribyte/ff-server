import type { JobContext } from "./runner.js";
import { storyHashes } from "./storyHashes.js";

export type MaintenanceJob = {
    name: string;
    title: string;
    description: string;
    run: (ctx: JobContext) => Promise<string>;
};

// Maintenance jobs an admin can run from the site. Each is idempotent and
// needs nothing but the database. Episode import is its own route (it takes files).
export const JOBS: MaintenanceJob[] = [
    {
        name: "story-hashes",
        title: "Story hashes",
        description: "Recomputes every story's duplicate-import fingerprint from its stored text.",
        run: storyHashes,
    },
];

/** The job run name for episode imports in the job history */
export const EPISODE_IMPORT_JOB = "episode-import";
