class ApiError extends Error {
    constructor(statusCode, code, message) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

function createError(statusCode, code, message) {
    return new ApiError(statusCode, code, message);
}

function sendError(res, err) {
    const statusCode = Number(err?.statusCode) || 500;
    const code = err?.code || 'INTERNAL_ERROR';
    const message = err?.message || 'Internal server error';
    // FIX: Standardized error format across all endpoints to keep API responses predictable.
    return res.status(statusCode).json({
        ok: false,
        error: {
            code,
            message
        }
    });
}

function toInt(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
}

function requireNonEmptyString(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function parseAuthorization(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return null;
    const parts = headerValue.split(' ');
    if (parts.length !== 2) return null;
    if (parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1];
}

function toIsoDate(dateValue) {
    if (!dateValue) return null;
    const dt = new Date(dateValue);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
}

function escapeLikeTerm(value) {
    return String(value || '').replace(/([%_\\])/g, '\\$1');
}

module.exports = {
    ApiError,
    createError,
    sendError,
    toInt,
    requireNonEmptyString,
    parseAuthorization,
    toIsoDate,
    escapeLikeTerm
};
