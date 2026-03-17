const express = require('express');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString, toInt, escapeLikeTerm } = require('../lib/api');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { fetchRepoByOwnerName, assertRepoAccess, assertRepoAccessById } = require('../lib/repo-access');

const router = express.Router();

function normalizedVisibility(value) {
    const v = requireNonEmptyString(value).toLowerCase();
    if (!v) return 'private';
    return v === 'public' ? 'public' : 'private';
}

function normalizedRole(value) {
    const v = requireNonEmptyString(value).toLowerCase();
    if (!v) return 'write';
    return ['read', 'write', 'admin'].includes(v) ? v : null;
}

// GET /api/repos/search?q=term
router.get('/search', optionalAuth, async (req, res) => {
    let connection;
    try {
        const q = requireNonEmptyString(req.query.q);
        if (!q || q.length < 2) {
            throw createError(400, 'INVALID_INPUT', 'Search query must be at least 2 characters');
        }

        connection = await getConnection();
        const requesterId = req.authUser?.userId || -1;
        // FIX: Escape LIKE wildcards from user input to avoid unintended broad-match search behavior.
        const like = `%${escapeLikeTerm(q.toLowerCase())}%`;
        let result;

        try {
            result = await connection.execute(
                `SELECT DISTINCT r.repo_id, r.repo_name, r.description, r.language,
                                 r.stars_count, r.forks_count, r.visibility, r.created_at, u.username
                 FROM repositories r
                 JOIN users u ON r.owner_id = u.user_id
                 LEFT JOIN repository_collaborators rc
                   ON rc.repo_id = r.repo_id AND rc.user_id = :requester_id
                 WHERE (LOWER(r.repo_name) LIKE :term ESCAPE '\\'
                        OR LOWER(u.username) LIKE :term ESCAPE '\\'
                        OR LOWER(NVL(r.description, '')) LIKE :term ESCAPE '\\')
                   AND (r.visibility = 'public' OR r.owner_id = :requester_id OR rc.user_id IS NOT NULL)
                 ORDER BY r.updated_at DESC
                 FETCH FIRST 50 ROWS ONLY`,
                { requester_id: requesterId, term: like }
            );
        } catch (err) {
            if (!err || err.errorNum !== 942) throw err;
            // FIX: Backward-compatible search when collaborators table migration has not been applied.
            result = await connection.execute(
                `SELECT r.repo_id, r.repo_name, r.description, r.language,
                        r.stars_count, r.forks_count, r.visibility, r.created_at, u.username
                 FROM repositories r
                 JOIN users u ON r.owner_id = u.user_id
                 WHERE (LOWER(r.repo_name) LIKE :term ESCAPE '\\'
                        OR LOWER(u.username) LIKE :term ESCAPE '\\'
                        OR LOWER(NVL(r.description, '')) LIKE :term ESCAPE '\\')
                   AND (r.visibility = 'public' OR r.owner_id = :requester_id)
                 ORDER BY r.updated_at DESC
                 FETCH FIRST 50 ROWS ONLY`,
                { requester_id: requesterId, term: like }
            );
        }

        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/repos — list repositories accessible to requester
router.get('/', optionalAuth, async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const requesterId = req.authUser?.userId || -1;
        let result;
        try {
            result = await connection.execute(
                `SELECT DISTINCT r.repo_id, r.repo_name, r.description, r.language,
                                 r.stars_count, r.forks_count, r.created_at, u.username
                 FROM repositories r
                 JOIN users u ON r.owner_id = u.user_id
                 LEFT JOIN repository_collaborators rc
                   ON rc.repo_id = r.repo_id AND rc.user_id = :requester_id
                 WHERE r.visibility = 'public' OR r.owner_id = :requester_id OR rc.user_id IS NOT NULL
                 ORDER BY r.created_at DESC`,
                { requester_id: requesterId }
            );
        } catch (err) {
            if (!err || err.errorNum !== 942) throw err;
            result = await connection.execute(
                `SELECT r.repo_id, r.repo_name, r.description, r.language,
                        r.stars_count, r.forks_count, r.created_at, u.username
                 FROM repositories r
                 JOIN users u ON r.owner_id = u.user_id
                 WHERE r.visibility = 'public' OR r.owner_id = :requester_id
                 ORDER BY r.created_at DESC`,
                { requester_id: requesterId }
            );
        }
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/repos — create a new repo
router.post('/', requireAuth, async (req, res) => {
    let connection;
    try {
        const ownerId = toInt(req.body?.owner_id);
        const repoName = requireNonEmptyString(req.body?.repo_name);
        const description = requireNonEmptyString(req.body?.description);
        const language = requireNonEmptyString(req.body?.language);
        const visibility = normalizedVisibility(req.body?.visibility);

        if (!ownerId || !repoName) {
            throw createError(400, 'INVALID_INPUT', 'owner_id and repo_name are required');
        }
        if (Number(ownerId) !== Number(req.authUser.userId)) {
            throw createError(403, 'FORBIDDEN', 'You can only create repositories for your own account');
        }

        connection = await getConnection();

        await connection.execute(
            `INSERT INTO repositories (owner_id, repo_name, description, visibility, language)
             VALUES (:owner_id, :repo_name, :description, :visibility, :language)`,
            {
                owner_id: ownerId,
                repo_name: repoName,
                description: description || null,
                visibility,
                language: language || null
            }
        );

        const repoResult = await connection.execute(
            `SELECT repo_id
             FROM repositories
             WHERE owner_id = :owner_id AND repo_name = :repo_name`,
            { owner_id: ownerId, repo_name: repoName }
        );

        const repoId = repoResult.rows[0]?.[0];
        if (!repoId) throw createError(500, 'REPO_CREATE_FAILED', 'Failed to create repository');

        await connection.execute(
            `INSERT INTO branches (repo_id, branch_name, is_default)
             VALUES (:repo_id, 'main', 1)`,
            { repo_id: repoId }
        );

        await connection.execute(
            `UPDATE users
             SET public_repos = public_repos + 1
             WHERE user_id = :owner_id`,
            { owner_id: ownerId }
        );

        await connection.execute('COMMIT');
        res.status(201).json({ ok: true, message: 'Repository created', repo_id: repoId });
    } catch (err) {
        if (err && err.errorNum === 1) {
            return sendError(res, createError(409, 'REPO_EXISTS', 'Repository name already exists for this user'));
        }
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/repos/:id — update repo
router.put('/:id', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.params.id);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'Invalid repository id');

        const repoName = requireNonEmptyString(req.body?.repo_name);
        const description = requireNonEmptyString(req.body?.description);
        const language = requireNonEmptyString(req.body?.language);
        const visibility = normalizedVisibility(req.body?.visibility);

        connection = await getConnection();
        const repo = await assertRepoAccessById(connection, repoId, req.authUser, 'admin');

        await connection.execute(
            `UPDATE repositories
             SET repo_name = :repo_name,
                 description = :description,
                 visibility = :visibility,
                 language = :language,
                 updated_at = CURRENT_TIMESTAMP
             WHERE repo_id = :id`,
            {
                repo_name: repoName || repo.repoName,
                description: description || null,
                visibility,
                language: language || null,
                id: repoId
            },
            { autoCommit: true }
        );

        res.json({ ok: true, message: 'Repository updated' });
    } catch (err) {
        if (err && err.errorNum === 1) {
            return sendError(res, createError(409, 'REPO_EXISTS', 'Repository name already exists for this user'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/repos/:id — delete repo
router.delete('/:id', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.params.id);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'Invalid repository id');

        connection = await getConnection();
        const repo = await assertRepoAccessById(connection, repoId, req.authUser, 'admin');
        if (Number(repo.ownerId) !== Number(req.authUser.userId)) {
            throw createError(403, 'FORBIDDEN', 'Only repository owner can delete a repository');
        }

        await connection.execute(`DELETE FROM repositories WHERE repo_id = :id`, { id: repoId });
        await connection.execute(
            `UPDATE users
             SET public_repos = CASE WHEN public_repos > 0 THEN public_repos - 1 ELSE 0 END
             WHERE user_id = :owner_id`,
            { owner_id: repo.ownerId }
        );
        await connection.execute('COMMIT');
        res.json({ ok: true, message: 'Repository deleted' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/repos/:owner/:repo/collaborators
router.get('/:owner/:repo/collaborators', requireAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'admin');

        let result;
        try {
            result = await connection.execute(
                `SELECT rc.collaborator_id, u.username, rc.role, rc.created_at
                 FROM repository_collaborators rc
                 JOIN users u ON rc.user_id = u.user_id
                 WHERE rc.repo_id = :repo_id
                 ORDER BY rc.created_at DESC`,
                { repo_id: repo.repoId }
            );
        } catch (err) {
            if (err && err.errorNum === 942) return res.json([]);
            throw err;
        }
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/repos/:owner/:repo/collaborators
router.post('/:owner/:repo/collaborators', requireAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const collaboratorUsername = requireNonEmptyString(req.body?.username).toLowerCase();
        const role = normalizedRole(req.body?.role);
        if (!owner || !repoName || !collaboratorUsername || !role) {
            throw createError(400, 'INVALID_INPUT', 'owner, repo, username and valid role are required');
        }

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'admin');
        if (Number(repo.ownerId) === Number(req.authUser.userId)) {
            // owner is already admin by default, nothing extra needed
        }

        const userResult = await connection.execute(
            `SELECT user_id FROM users WHERE username = :username`,
            { username: collaboratorUsername }
        );
        if (!userResult.rows.length) {
            throw createError(404, 'USER_NOT_FOUND', 'Collaborator user not found');
        }
        const collaboratorUserId = Number(userResult.rows[0][0]);
        if (Number(collaboratorUserId) === Number(repo.ownerId)) {
            throw createError(400, 'INVALID_INPUT', 'Repository owner cannot be added as collaborator');
        }

        try {
            await connection.execute(
                `MERGE INTO repository_collaborators rc
                 USING (SELECT :repo_id AS repo_id, :user_id AS user_id FROM dual) src
                 ON (rc.repo_id = src.repo_id AND rc.user_id = src.user_id)
                 WHEN MATCHED THEN
                   UPDATE SET role = :role, added_by = :added_by
                 WHEN NOT MATCHED THEN
                   INSERT (repo_id, user_id, role, added_by)
                   VALUES (:repo_id, :user_id, :role, :added_by)`,
                {
                    repo_id: repo.repoId,
                    user_id: collaboratorUserId,
                    role,
                    added_by: req.authUser.userId
                },
                { autoCommit: true }
            );
        } catch (err) {
            if (err && err.errorNum === 942) {
                throw createError(500, 'MIGRATION_REQUIRED', 'Run latest schema migration for collaborators');
            }
            throw err;
        }

        res.status(201).json({ ok: true, message: 'Collaborator added/updated' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/repos/:owner/:repo/collaborators/:username
router.delete('/:owner/:repo/collaborators/:username', requireAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const collaboratorUsername = requireNonEmptyString(req.params.username).toLowerCase();
        if (!owner || !repoName || !collaboratorUsername) {
            throw createError(400, 'INVALID_INPUT', 'owner, repo and username are required');
        }

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'admin');

        const userResult = await connection.execute(
            `SELECT user_id FROM users WHERE username = :username`,
            { username: collaboratorUsername }
        );
        if (!userResult.rows.length) {
            throw createError(404, 'USER_NOT_FOUND', 'Collaborator user not found');
        }
        const collaboratorUserId = Number(userResult.rows[0][0]);

        try {
            const delResult = await connection.execute(
                `DELETE FROM repository_collaborators
                 WHERE repo_id = :repo_id AND user_id = :user_id`,
                { repo_id: repo.repoId, user_id: collaboratorUserId },
                { autoCommit: true }
            );
            if (!delResult.rowsAffected) {
                throw createError(404, 'COLLABORATOR_NOT_FOUND', 'Collaborator was not found for this repository');
            }
        } catch (err) {
            if (err && err.errorNum === 942) {
                throw createError(500, 'MIGRATION_REQUIRED', 'Run latest schema migration for collaborators');
            }
            throw err;
        }

        res.json({ ok: true, message: 'Collaborator removed' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/repos/:owner/:repo — get single repo with access control
router.get('/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        if (!owner || !repoName) {
            throw createError(400, 'INVALID_INPUT', 'owner and repo are required');
        }

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, r.visibility,
                    r.default_branch, r.stars_count, r.forks_count, r.open_issues_count,
                    r.created_at, r.updated_at, u.username, u.avatar_url
             FROM repositories r
             JOIN users u ON r.owner_id = u.user_id
             WHERE u.username = :owner AND r.repo_name = :repo`,
            { owner, repo: repoName }
        );

        res.json({
            ok: true,
            data: result.rows[0]
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
