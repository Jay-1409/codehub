const express = require('express');
const router = express.Router();
const { getConnection } = require('../db');

// GET /api/repos — list all public repos
router.get('/', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, 
                    r.stars_count, r.forks_count, r.created_at, u.username 
             FROM repositories r 
             JOIN users u ON r.owner_id = u.user_id 
             WHERE r.visibility = 'public' 
             ORDER BY r.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/repos/:owner/:repo — get single repo
router.get('/:owner/:repo', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, r.visibility,
                    r.default_branch, r.stars_count, r.forks_count, r.open_issues_count,
                    r.created_at, r.updated_at, u.username, u.avatar_url
             FROM repositories r 
             JOIN users u ON r.owner_id = u.user_id 
             WHERE u.username = :owner AND r.repo_name = :repo`,
            { owner: req.params.owner, repo: req.params.repo }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Repository not found' });
        }

        res.json({
            data: result.rows[0]
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/repos — create a new repo
router.post('/', async (req, res) => {
    let connection;
    try {
        const { owner_id, repo_name, description, visibility, language } = req.body;
        connection = await getConnection();

        // Create repo in DB
        await connection.execute(
            `INSERT INTO repositories (owner_id, repo_name, description, visibility, language) 
             VALUES (:owner_id, :repo_name, :description, :visibility, :language)`,
            { owner_id, repo_name, description, visibility: visibility || 'public', language },
            { autoCommit: true }
        );

        // Get the repo_id that was just created
        const repoResult = await connection.execute(
            `SELECT repo_id FROM repositories WHERE owner_id = :owner_id AND repo_name = :repo_name`,
            { owner_id, repo_name }
        );

        let repo_id;
        if (repoResult.rows.length > 0) {
            repo_id = repoResult.rows[0][0];
            // Create default branch (main)
            await connection.execute(
                `INSERT INTO branches (repo_id, branch_name, is_default) VALUES (:repo_id, 'main', 1)`,
                { repo_id },
                { autoCommit: true }
            );
        }

        // Update user's public_repos count
        await connection.execute(
            `UPDATE users SET public_repos = public_repos + 1 WHERE user_id = :owner_id`,
            { owner_id },
            { autoCommit: true }
        );

        res.status(201).json({
            message: 'Repository created!',
            repo_id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/repos/:id — update repo
router.put('/:id', async (req, res) => {
    let connection;
    try {
        const { repo_name, description, visibility, language } = req.body;
        connection = await getConnection();

        await connection.execute(
            `UPDATE repositories 
             SET repo_name = :repo_name, description = :description, 
                 visibility = :visibility, language = :language, updated_at = CURRENT_TIMESTAMP
             WHERE repo_id = :id`,
            { repo_name, description, visibility, language, id: req.params.id },
            { autoCommit: true }
        );
        res.json({ message: 'Repository updated!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/repos/:id — delete repo
router.delete('/:id', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();

        // Delete from DB (foreign keys will handle branches, files, commits if ON DELETE CASCADE, 
        // else we should delete child records. Assumed handled by DB schema).
        await connection.execute(
            `DELETE FROM repositories WHERE repo_id = :id`,
            { id: req.params.id },
            { autoCommit: true }
        );

        res.json({ message: 'Repository deleted!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
