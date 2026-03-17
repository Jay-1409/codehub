const express = require('express');
const { getConnection } = require('../db');
const { createError, sendError, toInt } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { assertRepoAccessById } = require('../lib/repo-access');

const router = express.Router();

// POST /api/stars — star a repo
router.post('/', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'repo_id is required');

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');

        const userId = Number(req.authUser.userId);
        await connection.execute(
            `INSERT INTO stars (user_id, repo_id)
             VALUES (:user_id, :repo_id)`,
            { user_id: userId, repo_id: repoId }
        );

        await connection.execute(
            `UPDATE repositories
             SET stars_count = stars_count + 1
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );

        await connection.execute('COMMIT');
        res.json({ ok: true, message: 'Starred' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        if (err && (err.errorNum === 1 || String(err.message || '').includes('ORA-00001'))) {
            return sendError(res, createError(409, 'ALREADY_STARRED', 'Repository already starred'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/stars — unstar a repo
router.delete('/', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'repo_id is required');

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');

        const userId = Number(req.authUser.userId);
        const delResult = await connection.execute(
            `DELETE FROM stars
             WHERE user_id = :user_id AND repo_id = :repo_id`,
            { user_id: userId, repo_id: repoId }
        );

        if (!delResult.rowsAffected) {
            throw createError(404, 'STAR_NOT_FOUND', 'Repository is not starred');
        }

        // FIX: Prevent stars_count from becoming negative during unstar operations.
        await connection.execute(
            `UPDATE repositories
             SET stars_count = CASE WHEN stars_count > 0 THEN stars_count - 1 ELSE 0 END
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );

        await connection.execute('COMMIT');
        res.json({ ok: true, message: 'Unstarred' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/stars/user/:user_id — get user's starred repos
router.get('/user/:user_id', requireAuth, async (req, res) => {
    let connection;
    try {
        const userId = toInt(req.params.user_id);
        if (!userId) throw createError(400, 'INVALID_INPUT', 'Invalid user id');
        if (Number(userId) !== Number(req.authUser.userId)) {
            throw createError(403, 'FORBIDDEN', 'You can only view your own starred repositories');
        }

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, r.stars_count, u.username
             FROM stars s
             JOIN repositories r ON s.repo_id = r.repo_id
             JOIN users u ON r.owner_id = u.user_id
             WHERE s.user_id = :user_id
             ORDER BY s.created_at DESC`,
            { user_id: userId }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
