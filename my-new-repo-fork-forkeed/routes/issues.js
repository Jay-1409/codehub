const express = require('express');
const router = express.Router();
const { getConnection } = require('../db');

// GET /api/issues/:owner/:repo — list issues for a repo
router.get('/:owner/:repo', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT i.issue_id, i.issue_number, i.title, i.status, i.label, 
                    i.created_at, i.closed_at, u.username as author
             FROM issues i 
             JOIN repositories r ON i.repo_id = r.repo_id
             JOIN users u ON i.author_id = u.user_id
             JOIN users owner ON r.owner_id = owner.user_id
             WHERE owner.username = :owner AND r.repo_name = :repo
             ORDER BY i.created_at DESC`,
            { owner: req.params.owner, repo: req.params.repo }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/issues/detail/:id — get single issue
router.get('/detail/:id', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT i.*, u.username as author 
             FROM issues i 
             JOIN users u ON i.author_id = u.user_id 
             WHERE i.issue_id = :id`,
            { id: req.params.id }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Issue not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/issues — create a new issue
router.post('/', async (req, res) => {
    let connection;
    try {
        const { repo_id, author_id, title, body, label } = req.body;
        connection = await getConnection();

        // Get next issue number for this repo
        const countResult = await connection.execute(
            `SELECT NVL(MAX(issue_number), 0) + 1 as next_num FROM issues WHERE repo_id = :repo_id`,
            { repo_id }
        );
        const issue_number = countResult.rows[0][0];

        await connection.execute(
            `INSERT INTO issues (repo_id, author_id, issue_number, title, body, label) 
             VALUES (:repo_id, :author_id, :issue_number, :title, :body, :label)`,
            { repo_id, author_id, issue_number, title, body, label },
            { autoCommit: true }
        );

        // Update open_issues_count
        await connection.execute(
            `UPDATE repositories SET open_issues_count = open_issues_count + 1 WHERE repo_id = :repo_id`,
            { repo_id }, { autoCommit: true }
        );

        res.status(201).json({ message: 'Issue created!', issue_number });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/issues/:id — update issue (close/reopen)
router.put('/:id', async (req, res) => {
    let connection;
    try {
        const { title, body, status, label } = req.body;
        connection = await getConnection();

        let query, params;
        if (status === 'closed') {
            query = `UPDATE issues SET title = :title, body = :body, status = :status, label = :label, closed_at = CURRENT_TIMESTAMP WHERE issue_id = :id`;
        } else {
            query = `UPDATE issues SET title = :title, body = :body, status = :status, label = :label, closed_at = NULL WHERE issue_id = :id`;
        }

        await connection.execute(query, { title, body, status, label, id: req.params.id }, { autoCommit: true });
        res.json({ message: 'Issue updated!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
