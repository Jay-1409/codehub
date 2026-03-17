const express = require('express');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString, toInt } = require('../lib/api');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { fetchRepoByOwnerName, assertRepoAccess, assertRepoAccessById } = require('../lib/repo-access');

const router = express.Router();

function normalizedIssueStatus(value) {
    const status = requireNonEmptyString(value).toLowerCase();
    if (!status) return 'open';
    if (status !== 'open' && status !== 'closed') return null;
    return status;
}

// GET /api/issues/detail/:id — get single issue
router.get('/detail/:id', optionalAuth, async (req, res) => {
    let connection;
    try {
        const issueId = toInt(req.params.id);
        if (!issueId) throw createError(400, 'INVALID_INPUT', 'Invalid issue id');

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT i.issue_id, i.repo_id, i.author_id, i.issue_number, i.title, i.body, i.status, i.label,
                    i.created_at, i.closed_at, u.username AS author
             FROM issues i
             JOIN users u ON i.author_id = u.user_id
             WHERE i.issue_id = :id`,
            { id: issueId }
        );

        if (!result.rows.length) throw createError(404, 'ISSUE_NOT_FOUND', 'Issue not found');
        const row = result.rows[0];
        await assertRepoAccessById(connection, row[1], req.authUser, 'read');
        res.json(row);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/issues/detail/:id/comments — list comments for an issue
router.get('/detail/:id/comments', optionalAuth, async (req, res) => {
    let connection;
    try {
        const issueId = toInt(req.params.id);
        if (!issueId) throw createError(400, 'INVALID_INPUT', 'Invalid issue id');
        connection = await getConnection();

        const issueResult = await connection.execute(
            `SELECT issue_id, repo_id FROM issues WHERE issue_id = :issue_id`,
            { issue_id: issueId }
        );
        if (!issueResult.rows.length) throw createError(404, 'ISSUE_NOT_FOUND', 'Issue not found');
        const repoId = issueResult.rows[0][1];
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');

        try {
            const result = await connection.execute(
                `SELECT ic.comment_id, ic.issue_id, ic.author_id, u.username, ic.body, ic.created_at
                 FROM issue_comments ic
                 JOIN users u ON ic.author_id = u.user_id
                 WHERE ic.issue_id = :issue_id
                 ORDER BY ic.created_at ASC`,
                { issue_id: issueId }
            );
            return res.json(result.rows);
        } catch (err) {
            if (err && err.errorNum === 942) return res.json([]);
            throw err;
        }
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/issues/detail/:id/comments — add comment on an issue
router.post('/detail/:id/comments', requireAuth, async (req, res) => {
    let connection;
    try {
        const issueId = toInt(req.params.id);
        const body = requireNonEmptyString(req.body?.body);
        if (!issueId || !body) throw createError(400, 'INVALID_INPUT', 'Valid issue id and body are required');

        connection = await getConnection();
        const issueResult = await connection.execute(
            `SELECT issue_id, repo_id FROM issues WHERE issue_id = :issue_id`,
            { issue_id: issueId }
        );
        if (!issueResult.rows.length) throw createError(404, 'ISSUE_NOT_FOUND', 'Issue not found');

        const repoId = issueResult.rows[0][1];
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');

        try {
            await connection.execute(
                `INSERT INTO issue_comments (issue_id, author_id, body)
                 VALUES (:issue_id, :author_id, :body)`,
                {
                    issue_id: issueId,
                    author_id: req.authUser.userId,
                    body
                },
                { autoCommit: true }
            );
            return res.status(201).json({ ok: true, message: 'Comment added' });
        } catch (err) {
            if (err && err.errorNum === 942) {
                throw createError(500, 'MIGRATION_REQUIRED', 'Run latest schema migration for issue comments');
            }
            throw err;
        }
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/issues/:owner/:repo — list issues for a repo
router.get('/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT i.issue_id, i.issue_number, i.title, i.status, i.label,
                    i.created_at, i.closed_at, u.username AS author
             FROM issues i
             JOIN users u ON i.author_id = u.user_id
             WHERE i.repo_id = :repo_id
             ORDER BY i.created_at DESC`,
            { repo_id: repo.repoId }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/issues — create a new issue
router.post('/', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const title = requireNonEmptyString(req.body?.title);
        const body = requireNonEmptyString(req.body?.body);
        const label = requireNonEmptyString(req.body?.label);
        if (!repoId || !title) throw createError(400, 'INVALID_INPUT', 'repo_id and title are required');

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        const countResult = await connection.execute(
            `SELECT NVL(MAX(issue_number), 0) + 1
             FROM issues
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );
        const issueNumber = countResult.rows[0][0];

        await connection.execute(
            `INSERT INTO issues (repo_id, author_id, issue_number, title, body, label)
             VALUES (:repo_id, :author_id, :issue_number, :title, :body, :label)`,
            {
                repo_id: repoId,
                author_id: req.authUser.userId,
                issue_number: issueNumber,
                title,
                body: body || null,
                label: label || null
            }
        );

        await connection.execute(
            `UPDATE repositories
             SET open_issues_count = open_issues_count + 1
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );
        await connection.execute('COMMIT');
        res.status(201).json({ ok: true, message: 'Issue created', issue_number: issueNumber });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/issues/:id — update issue
router.put('/:id', requireAuth, async (req, res) => {
    let connection;
    try {
        const issueId = toInt(req.params.id);
        if (!issueId) throw createError(400, 'INVALID_INPUT', 'Invalid issue id');

        const title = requireNonEmptyString(req.body?.title);
        const body = requireNonEmptyString(req.body?.body);
        const status = normalizedIssueStatus(req.body?.status);
        const label = requireNonEmptyString(req.body?.label);
        if (!status) throw createError(400, 'INVALID_INPUT', 'status must be open or closed');
        if (!title) throw createError(400, 'INVALID_INPUT', 'title is required');

        connection = await getConnection();
        const issueResult = await connection.execute(
            `SELECT issue_id, repo_id, status
             FROM issues
             WHERE issue_id = :id`,
            { id: issueId }
        );
        if (!issueResult.rows.length) throw createError(404, 'ISSUE_NOT_FOUND', 'Issue not found');
        const existingRepoId = issueResult.rows[0][1];
        const previousStatus = String(issueResult.rows[0][2] || 'open').toLowerCase();

        await assertRepoAccessById(connection, existingRepoId, req.authUser, 'write');

        const closedAtClause = status === 'closed' ? 'CURRENT_TIMESTAMP' : 'NULL';
        await connection.execute(
            `UPDATE issues
             SET title = :title,
                 body = :body,
                 status = :status,
                 label = :label,
                 closed_at = ${closedAtClause}
             WHERE issue_id = :id`,
            {
                title,
                body: body || null,
                status,
                label: label || null,
                id: issueId
            }
        );

        if (previousStatus !== status) {
            if (status === 'closed') {
                await connection.execute(
                    `UPDATE repositories
                     SET open_issues_count = CASE WHEN open_issues_count > 0 THEN open_issues_count - 1 ELSE 0 END
                     WHERE repo_id = :repo_id`,
                    { repo_id: existingRepoId }
                );
            } else if (status === 'open') {
                await connection.execute(
                    `UPDATE repositories
                     SET open_issues_count = open_issues_count + 1
                     WHERE repo_id = :repo_id`,
                    { repo_id: existingRepoId }
                );
            }
        }

        await connection.execute('COMMIT');
        res.json({ ok: true, message: 'Issue updated' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
