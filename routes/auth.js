const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString } = require('../lib/api');
const { requireAuth, buildTokenPayload, persistSession, revokeSession } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is required. Set it in your environment before starting the server.');
}

function sanitizeSignupInput(body) {
    return {
        username: requireNonEmptyString(body.username).toLowerCase(),
        full_name: requireNonEmptyString(body.full_name),
        email: requireNonEmptyString(body.email).toLowerCase(),
        password: String(body.password || '')
    };
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    let connection;
    try {
        const { username, full_name, email, password } = sanitizeSignupInput(req.body || {});
        if (!username || !email || !password) {
            throw createError(400, 'INVALID_INPUT', 'username, email and password are required');
        }
        if (password.length < 6) {
            throw createError(400, 'WEAK_PASSWORD', 'Password must be at least 6 characters');
        }

        const passwordHash = await bcrypt.hash(password, 10);
        connection = await getConnection();
        await connection.execute(
            `INSERT INTO users (username, full_name, email, password_hash)
             VALUES (:username, :full_name, :email, :password_hash)`,
            {
                username,
                full_name: full_name || null,
                email,
                password_hash: passwordHash
            },
            { autoCommit: true }
        );

        res.status(201).json({ ok: true, message: 'User created successfully' });
    } catch (err) {
        if (err && (err.errorNum === 1 || String(err.message || '').includes('ORA-00001'))) {
            return sendError(res, createError(409, 'USER_EXISTS', 'Username or email already exists'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    let connection;
    try {
        const username = requireNonEmptyString(req.body?.username).toLowerCase();
        const password = String(req.body?.password || '');
        if (!username || !password) {
            throw createError(400, 'INVALID_INPUT', 'username and password are required');
        }

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT user_id, username, email, password_hash
             FROM users
             WHERE username = :username`,
            { username }
        );

        if (result.rows.length === 0) {
            throw createError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
        }

        const row = result.rows[0];
        const isValid = await bcrypt.compare(password, row[3]);
        if (!isValid) {
            throw createError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
        }

        const tokenPayload = buildTokenPayload(row[0], row[1]);
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });
        await persistSession(tokenPayload.user_id, tokenPayload.jti, 7);

        // FIX: Return minimal user data and avoid exposing password hash/sensitive fields.
        res.json({
            ok: true,
            token,
            user: {
                user_id: row[0],
                username: row[1],
                email: row[2]
            }
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
    try {
        await revokeSession(req.authUser.userId, req.authUser.jti);
        res.json({ ok: true, message: 'Logged out successfully' });
    } catch (err) {
        return sendError(res, err);
    }
});

// GET /api/auth/sessions
router.get('/sessions', requireAuth, async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        let result;
        try {
            result = await connection.execute(
                `SELECT session_id, created_at, expires_at, revoked_at
                 FROM user_sessions
                 WHERE user_id = :user_id
                 ORDER BY created_at DESC`,
                { user_id: req.authUser.userId }
            );
        } catch (err) {
            if (err && err.errorNum === 942) {
                // FIX: Keep endpoint backward compatible before running migrations.
                return res.json({ ok: true, sessions: [] });
            }
            throw err;
        }

        res.json({
            ok: true,
            sessions: result.rows.map((row) => ({
                session_id: row[0],
                created_at: row[1],
                expires_at: row[2],
                revoked_at: row[3]
            }))
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
