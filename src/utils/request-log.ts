// Access log: one line per finished request, plus a request id (also sent back
// as X-Request-Id) that every other log line made during it carries.
import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger, requestContext } from "./logger.js";

const SKIP_PREFIX = "/api/docs/"; // swagger-ui's static assets

/** The client's address: behind Cloudflare and NFSN's proxy, req.ip is the proxy's. */
export function clientIp(req: Request): string | undefined {
    const cf = req.get("cf-connecting-ip");
    if (cf) return cf;
    const forwarded = req.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    return req.socket.remoteAddress;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.get("x-request-id");
    req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomBytes(4).toString("hex");
    res.setHeader("X-Request-Id", req.id);
    const start = process.hrtime.bigint();

    const done = (aborted: boolean) => {
        const url = req.originalUrl;
        if (url.startsWith(SKIP_PREFIX)) return;
        const status = aborted ? 499 : res.statusCode;
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
        // The admin page polls its own log view; keep that out of the way
        const quiet = url.startsWith("/api/admin/logs") && status < 400;
        logger[quiet ? "debug" : level]("http", {
            method: req.method,
            url: url.length > 300 ? `${url.slice(0, 300)}…` : url,
            status,
            ms: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
            ip: clientIp(req),
            ...(aborted ? { aborted: true } : {}),
        });
    };
    res.on("finish", () => done(false));
    res.on("close", () => {
        if (!res.writableFinished) done(true);
    });

    requestContext.run({ reqId: req.id, req }, next);
}
