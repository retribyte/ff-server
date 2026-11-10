import { Router, Request, Response } from "express";
import { prisma } from "../db.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { importJson } from "../utils/import.js";
import { JOBS, EPISODE_IMPORT_JOB } from "../jobs/registry.js";
import { runJob, JobBusyError, type JobContext } from "../jobs/runner.js";
import { parsePayloads, previewEpisodeImport, importEpisodes } from "../jobs/episodeImport.js";
import { logger, queryLogs, type Level } from "../utils/logger.js";
import {
    MESSAGE_REASSIGN_JOB,
    OWNER_CHANGE_JOB,
    STORY_VOICE_JOB,
    changeOwner,
    parseOwner,
    parseReassign,
    parseStoryVoice,
    reassignMessages,
    reassignStoryVoices,
} from "./archiveFixes.js";

const RUN_LIST_SELECT = {
    id: true,
    job: true,
    dryRun: true,
    status: true,
    summary: true,
    startedAt: true,
    finishedAt: true,
    user: { select: { id: true, username: true } },
} as const;

function userId(req: Request): number {
    return (req.user as { id: number }).id;
}

function sendRunError(res: Response, error: unknown) {
    if (error instanceof JobBusyError) return res.status(409).json({ status: "error", message: error.message });
    logger.caught("Admin job error", error);
    res.status(500).json({ status: "error", message: "The job could not be started" });
}

// Admin jobs (the site's /admin page). Everything here is admin only.
const initializeAdminRoutes = (): Router => {
    const router = Router();

    // GET /api/admin/jobs: the maintenance jobs, each with its latest run
    router.get("/admin/jobs", authenticate, isAdmin, async (_req: Request, res: Response) => {
        const latest = await Promise.all(
            JOBS.map((job) =>
                prisma.jobRun.findFirst({ where: { job: job.name }, orderBy: { startedAt: "desc" }, select: RUN_LIST_SELECT })
            )
        );
        res.json({
            status: "success",
            data: JOBS.map((job, i) => ({ name: job.name, title: job.title, description: job.description, lastRun: latest[i] })),
        });
    });

    // POST /api/admin/jobs/:name/run {dryRun?}: run a maintenance job; answers with the JobRun
    router.post("/admin/jobs/:name/run", authenticate, isAdmin, async (req: Request, res: Response) => {
        const job = JOBS.find((j) => j.name === req.params.name);
        if (!job) return res.status(404).json({ status: "error", message: `No job named '${req.params.name}'` });
        try {
            const run = await runJob(job.name, userId(req), req.body?.dryRun === true, job.run);
            res.json({ status: "success", data: run });
        } catch (error) {
            sendRunError(res, error);
        }
    });

    // GET /api/admin/logs?level=&event=&user=&q=&since=&limit=: recent log entries, newest first
    // (from the in-memory buffer, which a restart refills from the last day's log file)
    router.get("/admin/logs", authenticate, isAdmin, (req: Request, res: Response) => {
        const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
        const level = str(req.query.level);
        const since = str(req.query.since);
        if (since && Number.isNaN(Date.parse(since))) {
            return res.status(400).json({ status: "error", message: "since must be an ISO date" });
        }
        res.json({
            status: "success",
            data: queryLogs({
                level: level && ["debug", "info", "warn", "error"].includes(level) ? (level as Level) : undefined,
                event: str(req.query.event),
                user: str(req.query.user),
                q: str(req.query.q),
                since: since ? new Date(since).toISOString() : undefined,
                limit: parseInt(String(req.query.limit ?? "200"), 10) || 200,
            }),
        });
    });

    // GET /api/admin/job-runs?job=&limit=&before=: recent runs, newest first, without their logs.
    // `before` (a run id) pages back: the runs older than that one.
    router.get("/admin/job-runs", authenticate, isAdmin, async (req: Request, res: Response) => {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1), 100);
        const job = typeof req.query.job === "string" ? req.query.job : undefined;
        const before = parseInt(String(req.query.before ?? ""), 10);
        const runs = await prisma.jobRun.findMany({
            where: { ...(job ? { job } : {}), ...(Number.isInteger(before) ? { id: { lt: before } } : {}) },
            // ids grow with start time; id breaks ties so pages never skip or repeat a run
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            take: limit,
            select: RUN_LIST_SELECT,
        });
        res.json({ status: "success", data: runs });
    });

    // GET /api/admin/job-runs/:id: one run with its log
    router.get("/admin/job-runs/:id", authenticate, isAdmin, async (req: Request, res: Response) => {
        const run = await prisma.jobRun.findUnique({
            where: { id: parseInt(req.params.id, 10) || 0 },
            include: { user: { select: { id: true, username: true } } },
        });
        if (!run) return res.status(404).json({ status: "error", message: "No such job run" });
        res.json({ status: "success", data: run });
    });

    // POST /api/admin/episode-import/preview {episodes}: what an import would do; writes nothing
    router.post("/admin/episode-import/preview", authenticate, isAdmin, importJson, async (req: Request, res: Response) => {
        let payloads;
        try {
            payloads = parsePayloads(req.body);
        } catch (error) {
            return res.status(400).json({ status: "error", message: (error as Error).message });
        }
        try {
            res.json({ status: "success", data: await previewEpisodeImport(payloads) });
        } catch (error) {
            logger.caught("Episode import preview error", error);
            res.status(500).json({ status: "error", message: "Could not preview the import" });
        }
    });

    // POST /api/admin/episode-import {episodes, dryRun?}: import new episodes or update existing ones, all or nothing; answers with the JobRun
    router.post("/admin/episode-import", authenticate, isAdmin, importJson, async (req: Request, res: Response) => {
        let payloads;
        try {
            payloads = parsePayloads(req.body);
        } catch (error) {
            return res.status(400).json({ status: "error", message: (error as Error).message });
        }
        try {
            const run = await runJob(EPISODE_IMPORT_JOB, userId(req), req.body?.dryRun === true, (ctx) =>
                importEpisodes(payloads, ctx)
            );
            res.json({ status: "success", data: run });
        } catch (error) {
            sendRunError(res, error);
        }
    });

    // Data fixes recorded in the History table. A run that fails answers 400
    // with its summary (and the FAILED run), so a caller can't mistake it for success.
    const fixRoute = <T>(job: string, parse: (body: any) => T, work: (input: T, ctx: JobContext) => Promise<string>) =>
        async (req: Request, res: Response) => {
            let input: T;
            try {
                input = parse(req.body);
            } catch (error) {
                return res.status(400).json({ status: "error", message: (error as Error).message });
            }
            try {
                const run = await runJob(job, userId(req), req.body?.dryRun === true, (ctx) => work(input, ctx));
                if (run.status === "FAILED") return res.status(400).json({ status: "error", message: run.summary ?? "The change failed", data: run });
                res.json({ status: "success", data: run });
            } catch (error) {
                sendRunError(res, error);
            }
        };

    // POST /api/admin/messages/reassign {episodeTitle, messageNos, characterId, personaId, newNpcName?, dryRun?}:
    // move transcript lines to another character, persona or NPC voice; answers with the JobRun
    router.post("/admin/messages/reassign", authenticate, isAdmin, fixRoute(MESSAGE_REASSIGN_JOB, parseReassign, reassignMessages));

    // POST /api/admin/owner {kind: character|item|story, id, userIds, dryRun?}: change who plays a
    // character, owns an item, or wrote a story (its authors); answers with the JobRun
    router.post("/admin/owner", authenticate, isAdmin, fixRoute(OWNER_CHANGE_JOB, parseOwner, changeOwner));

    // POST /api/admin/story-voices/reassign {from, to, stories?, seasons?, dryRun?}: move story dialogue
    // (whole lines and in-paragraph quotes) between a character and/or plain speaker text; answers with
    // the JobRun, whose log lists every change with its before-values. A dry run is the preview.
    router.post("/admin/story-voices/reassign", authenticate, isAdmin, fixRoute(STORY_VOICE_JOB, parseStoryVoice, reassignStoryVoices));

    return router;
};

export default { initializeAdminRoutes };
