import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { IMPORT_TX_OPTIONS } from "../utils/import.js";
import { logger } from "../utils/logger.js";

export type Tx = Prisma.TransactionClient;

/** What a job's work function gets: the transaction to write through, and a log. */
export type JobContext = { tx: Tx; dryRun: boolean; log: (line: string) => void };

/** The same job is already running — maps to 409. */
export class JobBusyError extends Error {}

/** Thrown inside the transaction to roll back a dry run; carries its summary. */
class DryRunRollback extends Error {}

// A RUNNING row older than this is a run the server died during, not a live one
const STALE_MS = 15 * 60_000;

/**
 * Runs `work` in one transaction and records it as a JobRun: who ran it, the
 * log and a one-line summary (what `work` returns). A dry run does the same
 * writes, then rolls them back. A failure rolls back too and is recorded as
 * FAILED, so the returned JobRun always says what happened.
 */
export async function runJob(
    job: string,
    userId: number | null,
    dryRun: boolean,
    work: (ctx: JobContext) => Promise<string>,
    txOptions: { maxWait: number; timeout: number } = IMPORT_TX_OPTIONS
) {
    const busy = await prisma.jobRun.findFirst({
        where: { job, status: "RUNNING", startedAt: { gt: new Date(Date.now() - STALE_MS) } },
        select: { id: true },
    });
    if (busy) throw new JobBusyError(`'${job}' is already running (run #${busy.id})`);

    const run = await prisma.jobRun.create({ data: { job, dryRun, userId } });
    logger.info("admin.job_started", { job, dryRun, runId: run.id });
    const lines: string[] = [];
    const log = (line: string) => void lines.push(line);
    let status: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
    let summary: string;
    try {
        summary = await prisma.$transaction(async (tx) => {
            const result = await work({ tx, dryRun, log });
            if (dryRun) throw new DryRunRollback(result);
            return result;
        }, txOptions);
    } catch (error) {
        if (error instanceof DryRunRollback) {
            summary = `Dry run, nothing saved: ${error.message}`;
        } else {
            status = "FAILED";
            summary = error instanceof Error ? error.message : String(error);
            log(`FAILED: ${summary}`);
        }
    }
    logger[status === "FAILED" ? "error" : "info"]("admin.job_finished", { job, dryRun, runId: run.id, status, summary: summary.slice(0, 200) });
    return await prisma.jobRun.update({
        where: { id: run.id },
        data: { status, summary, log: lines.join("\n"), finishedAt: new Date() },
        include: { user: { select: { id: true, username: true } } },
    });
}
