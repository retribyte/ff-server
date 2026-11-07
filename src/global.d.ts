declare global {
    namespace Express {
        interface Request {
            user?: Record<string, any>;
            /** Set by requestLogger; also the X-Request-Id header */
            id?: string;
        }
    }
}

export {};
