const express = require('express');
const router = express.Router();
const { getConnection } = require('../db');

// GET /api/pulls/:owner/:repo — list PRs for a repo
router.get('/:owner/:repo', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT p.pr_id, p.pr_number, p.title, p.status, p.source_branch, 
                    p.target_branch, p.created_at, p.merged_at, u.username as author
             FROM pull_requests p 
             JOIN repositories r ON p.repo_id = r.repo_id
             JOIN users u ON p.author_id = u.user_id
             JOIN users owner ON r.owner_id = owner.user_id
             WHERE owner.username = :owner AND r.repo_name = :repo
             ORDER BY p.created_at DESC`,
            { owner: req.params.owner, repo: req.params.repo }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/pulls — create a pull request
router.post('/', async (req, res) => {
    let connection;
    try {
        const { repo_id, author_id, title, body, source_branch, target_branch } = req.body;
        connection = await getConnection();

        // Get next PR number
        const countResult = await connection.execute(
            `SELECT NVL(MAX(pr_number), 0) + 1 as next_num FROM pull_requests WHERE repo_id = :repo_id`,
            { repo_id }
        );
        const pr_number = countResult.rows[0][0];

        await connection.execute(
            `INSERT INTO pull_requests (repo_id, author_id, pr_number, title, body, source_branch, target_branch) 
             VALUES (:repo_id, :author_id, :pr_number, :title, :body, :source_branch, :target_branch)`,
            { repo_id, author_id, pr_number, title, body, source_branch, target_branch },
            { autoCommit: true }
        );

        res.status(201).json({ message: 'Pull request created!', pr_number });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/pulls/:id/merge — merge a PR
router.put('/:id/merge', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            `UPDATE pull_requests SET status = 'merged', merged_at = CURRENT_TIMESTAMP WHERE pr_id = :id`,
            { id: req.params.id },
            { autoCommit: true }
        );
        res.json({ message: 'Pull request merged!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/pulls/:id/close — close a PR
router.put('/:id/close', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        await connection.execute(
            `UPDATE pull_requests SET status = 'closed' WHERE pr_id = :id`,
            { id: req.params.id },
            { autoCommit: true }
        );
        res.json({ message: 'Pull request closed!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
