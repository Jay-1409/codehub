const express = require('express');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString, toInt } = require('../lib/api');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { fetchRepoByOwnerName, assertRepoAccess, assertRepoAccessById } = require('../lib/repo-access');

const router = express.Router();

// GET /api/pulls/:owner/:repo — list PRs for a repo
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
            `SELECT p.pr_id, p.pr_number, p.title, p.status, p.source_branch,
                    p.target_branch, p.created_at, p.merged_at, u.username AS author
             FROM pull_requests p
             JOIN users u ON p.author_id = u.user_id
             WHERE p.repo_id = :repo_id
             ORDER BY p.created_at DESC`,
            { repo_id: repo.repoId }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/pulls — create a pull request
router.post('/', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const title = requireNonEmptyString(req.body?.title);
        const body = requireNonEmptyString(req.body?.body);
        const sourceBranch = requireNonEmptyString(req.body?.source_branch);
        const targetBranch = requireNonEmptyString(req.body?.target_branch);

        if (!repoId || !title || !sourceBranch || !targetBranch) {
            throw createError(400, 'INVALID_INPUT', 'repo_id, title, source_branch and target_branch are required');
        }
        if (sourceBranch === targetBranch) {
            throw createError(400, 'INVALID_INPUT', 'source_branch and target_branch must be different');
        }

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        const branchCheck = await connection.execute(
            `SELECT branch_name
             FROM branches
             WHERE repo_id = :repo_id
               AND (branch_name = :source_branch OR branch_name = :target_branch)`,
            {
                repo_id: repoId,
                source_branch: sourceBranch,
                target_branch: targetBranch
            }
        );
        const presentBranches = new Set(branchCheck.rows.map((r) => String(r[0])));
        if (!presentBranches.has(sourceBranch) || !presentBranches.has(targetBranch)) {
            throw createError(400, 'INVALID_BRANCH', 'source_branch and target_branch must both exist');
        }

        const countResult = await connection.execute(
            `SELECT NVL(MAX(pr_number), 0) + 1
             FROM pull_requests
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );
        const prNumber = countResult.rows[0][0];

        await connection.execute(
            `INSERT INTO pull_requests (repo_id, author_id, pr_number, title, body, source_branch, target_branch)
             VALUES (:repo_id, :author_id, :pr_number, :title, :body, :source_branch, :target_branch)`,
            {
                repo_id: repoId,
                author_id: req.authUser.userId,
                pr_number: prNumber,
                title,
                body: body || null,
                source_branch: sourceBranch,
                target_branch: targetBranch
            },
            { autoCommit: true }
        );

        res.status(201).json({ ok: true, message: 'Pull request created', pr_number: prNumber });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/pulls/:id/merge — merge a PR
router.put('/:id/merge', requireAuth, async (req, res) => {
    let connection;
    try {
        const prId = toInt(req.params.id);
        if (!prId) throw createError(400, 'INVALID_INPUT', 'Invalid pull request id');

        connection = await getConnection();
        const prResult = await connection.execute(
            `SELECT pr_id, repo_id, status
             FROM pull_requests
             WHERE pr_id = :id`,
            { id: prId }
        );
        if (!prResult.rows.length) throw createError(404, 'PR_NOT_FOUND', 'Pull request not found');
        const repoId = prResult.rows[0][1];
        const currentStatus = String(prResult.rows[0][2] || 'open').toLowerCase();
        if (currentStatus !== 'open') throw createError(400, 'INVALID_STATE', 'Only open pull requests can be merged');

        await assertRepoAccessById(connection, repoId, req.authUser, 'write');
        await connection.execute(
            `UPDATE pull_requests
             SET status = 'merged', merged_at = CURRENT_TIMESTAMP
             WHERE pr_id = :id`,
            { id: prId },
            { autoCommit: true }
        );
        res.json({ ok: true, message: 'Pull request merged' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/pulls/:id/close — close a PR
router.put('/:id/close', requireAuth, async (req, res) => {
    let connection;
    try {
        const prId = toInt(req.params.id);
        if (!prId) throw createError(400, 'INVALID_INPUT', 'Invalid pull request id');

        connection = await getConnection();
        const prResult = await connection.execute(
            `SELECT pr_id, repo_id, status
             FROM pull_requests
             WHERE pr_id = :id`,
            { id: prId }
        );
        if (!prResult.rows.length) throw createError(404, 'PR_NOT_FOUND', 'Pull request not found');
        const repoId = prResult.rows[0][1];
        const currentStatus = String(prResult.rows[0][2] || 'open').toLowerCase();
        if (currentStatus !== 'open') throw createError(400, 'INVALID_STATE', 'Only open pull requests can be closed');

        await assertRepoAccessById(connection, repoId, req.authUser, 'write');
        await connection.execute(
            `UPDATE pull_requests
             SET status = 'closed'
             WHERE pr_id = :id`,
            { id: prId },
            { autoCommit: true }
        );
        res.json({ ok: true, message: 'Pull request closed' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
