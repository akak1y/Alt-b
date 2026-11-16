class AppError extends Error {
    constructor(httpStatus, code, message, details = null) {
        super(message);
        this.name = 'AppError';
        this.httpStatus = httpStatus;
        this.code = code;
        this.details = details;
    }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'unauthorized', details) =>
    new AppError(401, 'UNAUTHORIZED', message, details);
const forbidden = (message = 'forbidden', details) =>
    new AppError(403, 'FORBIDDEN', message, details);
const notFound = (message = 'not found', details) =>
    new AppError(404, 'NOT_FOUND', message, details);
const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
const internal = (message = 'server error', details) =>
    new AppError(500, 'INTERNAL', message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, internal };
