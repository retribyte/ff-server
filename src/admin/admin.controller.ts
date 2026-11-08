import { Router, Request, Response } from "express";
import { prisma } from "../db.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { importJson } from "../utils/import.js";
import { JOBS, EPISODE_IMPORT_JOB } from "../jobs/registry.js";
import { runJob, JobBusyError } from "../jobs/runner.js";
import { parsePayloads, previewEpisodeImport, importEpisodes } from "../jobs/episodeImport.js";
import { logger, queryLogs, type Level } from "../utils/logger.js";

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

    // GET /api/admin/job-runs?job=&limit=: recent runs, newest first, without their logs
    router.get("/admin/job-runs", authenticate, isAdmin, async (req: Request, res: Response) => {
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1), 100);
        const job = typeof req.query.job === "string" ? req.query.job : undefined;
        const runs = await prisma.jobRun.findMany({
            where: job ? { job } : undefined,
            orderBy: { startedAt: "desc" },
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

    return router;
};

export default { initializeAdminRoutes };
