const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../db');
const { createError, parseAuthorization } = require('../lib/api');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required. Set it in your environment before starting the server.');
}

async function isSessionActive(connection, userId, jti) {
    try {
        const result = await connection.execute(
            `SELECT session_id
             FROM user_sessions
             WHERE user_id = :user_id
               AND jti = :jti
               AND revoked_at IS NULL
               AND expires_at > CURRENT_TIMESTAMP`,
            { user_id: userId, jti }
        );
        return result.rows.length > 0;
    } catch (err) {
        // FIX: Backward-compatible auth behavior when migration has not yet been applied.
        if (err && err.errorNum === 942) return true;
        throw err;
    }
}

function sanitizeAuthPayload(payload) {
    return {
        userId: Number(payload.user_id),
        username: payload.username,
        jti: payload.jti || ''
    };
}

async function requireAuth(req, _res, next) {
    let connection;
    try {
        const token = parseAuthorization(req.headers.authorization);
        if (!token) throw createError(401, 'AUTH_REQUIRED', 'Missing bearer token');

        const payload = jwt.verify(token, JWT_SECRET);
        const authUser = sanitizeAuthPayload(payload);
        if (!authUser.userId || !authUser.username) {
            throw createError(401, 'INVALID_TOKEN', 'Invalid token payload');
        }

        connection = await getConnection();
        const sessionOk = await isSessionActive(connection, authUser.userId, authUser.jti);
        if (!sessionOk) {
            throw createError(401, 'SESSION_EXPIRED', 'Session has expired. Please login again.');
        }

        req.authUser = authUser;
        return next();
    } catch (err) {
        return next(err.statusCode ? err : createError(401, 'UNAUTHORIZED', 'Authentication failed'));
    } finally {
        if (connection) await connection.close();
    }
}

async function optionalAuth(req, _res, next) {
    let connection;
    try {
        const token = parseAuthorization(req.headers.authorization);
        if (!token) return next();

        const payload = jwt.verify(token, JWT_SECRET);
        const authUser = sanitizeAuthPayload(payload);
        if (!authUser.userId || !authUser.username) return next();

        connection = await getConnection();
        const sessionOk = await isSessionActive(connection, authUser.userId, authUser.jti);
        if (sessionOk) req.authUser = authUser;
        return next();
    } catch (_err) {
        // FIX: Invalid optional auth token should not break public endpoints.
        return next();
    } finally {
        if (connection) await connection.close();
    }
}

function buildTokenPayload(userId, username) {
    return {
        user_id: Number(userId),
        username: String(username),
        jti: crypto.randomUUID()
    };
}

async function persistSession(userId, jti, expiresInDays = 7) {
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            `INSERT INTO user_sessions (user_id, jti, expires_at)
             VALUES (:user_id, :jti, CURRENT_TIMESTAMP + NUMTODSINTERVAL(:hours, 'HOUR'))`,
            { user_id: userId, jti, hours: Number(expiresInDays) * 24 },
            { autoCommit: true }
        );
    } catch (err) {
        // FIX: Keep login flow functional even if sessions table migration has not been run yet.
        if (!err || err.errorNum !== 942) throw err;
    } finally {
        if (connection) await connection.close();
    }
}

async function revokeSession(userId, jti) {
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            `UPDATE user_sessions
             SET revoked_at = CURRENT_TIMESTAMP
             WHERE user_id = :user_id AND jti = :jti AND revoked_at IS NULL`,
            { user_id: userId, jti },
            { autoCommit: true }
        );
    } catch (err) {
        if (!err || err.errorNum !== 942) throw err;
    } finally {
        if (connection) await connection.close();
    }
}

module.exports = {
    requireAuth,
    optionalAuth,
    buildTokenPayload,
    persistSession,
    revokeSession
};
