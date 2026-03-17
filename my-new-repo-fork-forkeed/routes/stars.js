const express = require('express');
const router = express.Router();
const { getConnection } = require('../db');

// POST /api/stars — star a repo
router.post('/', async (req, res) => {
    let connection;
    try {
        const { user_id, repo_id } = req.body;
        connection = await getConnection();

        await connection.execute(
            `INSERT INTO stars (user_id, repo_id) VALUES (:user_id, :repo_id)`,
            { user_id, repo_id },
            { autoCommit: true }
        );

        // Update stars count
        await connection.execute(
            `UPDATE repositories SET stars_count = stars_count + 1 WHERE repo_id = :repo_id`,
            { repo_id }, { autoCommit: true }
        );

        res.json({ message: 'Starred!' });
    } catch (err) {
        if (err.message.includes('unique constraint')) {
            res.status(400).json({ error: 'Already starred' });
        } else {
            res.status(500).json({ error: err.message });
        }
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/stars — unstar a repo
router.delete('/', async (req, res) => {
    let connection;
    try {
        const { user_id, repo_id } = req.body;
        connection = await getConnection();

        await connection.execute(
            `DELETE FROM stars WHERE user_id = :user_id AND repo_id = :repo_id`,
            { user_id, repo_id },
            { autoCommit: true }
        );

        await connection.execute(
            `UPDATE repositories SET stars_count = stars_count - 1 WHERE repo_id = :repo_id`,
            { repo_id }, { autoCommit: true }
        );

        res.json({ message: 'Unstarred!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/stars/user/:user_id — get user's starred repos
router.get('/user/:user_id', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, r.stars_count, u.username
             FROM stars s
             JOIN repositories r ON s.repo_id = r.repo_id
             JOIN users u ON r.owner_id = u.user_id
             WHERE s.user_id = :user_id
             ORDER BY s.created_at DESC`,
            { user_id: req.params.user_id }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
