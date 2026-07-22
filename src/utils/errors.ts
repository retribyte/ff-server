// Typed HTTP errors. Services throw these so controllers (via sendCaughtError)
// can map a failure to a fitting status code without sniffing the message text.
// Anything the service doesn't wrap in one of these is treated as an
// unexpected fault (500) by sendCaughtError.

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        message: string
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class BadRequestError extends HttpError {
    constructor(message: string) {
        super(400, message);
    }
}

export class NotFoundError extends HttpError {
    constructor(message: string) {
        super(404, message);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message: string) {
        super(403, message);
    }
}

export class ConflictError extends HttpError {
    constructor(message: string) {
        super(409, message);
    }
}
