const express = require('express');
const router = express.Router();
const { getConnection } = require('../db');

// GET /api/users/:username — user profile
router.get('/:username', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT user_id, username, full_name, email, avatar_url, bio, location, 
                    public_repos, followers_count, following_count, created_at 
             FROM users WHERE username = :username`,
            { username: req.params.username }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/users/:username/repos — user's repos
router.get('/:username/repos', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT r.repo_id, r.repo_name, r.description, r.language, 
                    r.stars_count, r.forks_count, r.visibility, r.created_at
             FROM repositories r 
             JOIN users u ON r.owner_id = u.user_id 
             WHERE u.username = :username 
             ORDER BY r.created_at DESC`,
            { username: req.params.username }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/users/:id — update profile
router.put('/:id', async (req, res) => {
    let connection;
    try {
        const { full_name, bio, location, avatar_url } = req.body;
        connection = await getConnection();

        await connection.execute(
            `UPDATE users 
             SET full_name = :full_name, bio = :bio, location = :location, avatar_url = :avatar_url
             WHERE user_id = :id`,
            { full_name, bio, location, avatar_url, id: req.params.id },
            { autoCommit: true }
        );
        res.json({ message: 'Profile updated!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/users/:id/follow — follow a user
router.post('/:id/follow', async (req, res) => {
    let connection;
    try {
        const { follower_id } = req.body;
        const following_id = req.params.id;

        connection = await getConnection();
        await connection.execute(
            `INSERT INTO followers (follower_id, following_id) VALUES (:follower_id, :following_id)`,
            { follower_id, following_id },
            { autoCommit: true }
        );

        // Update counts
        await connection.execute(
            `UPDATE users SET following_count = following_count + 1 WHERE user_id = :follower_id`,
            { follower_id }, { autoCommit: true }
        );
        await connection.execute(
            `UPDATE users SET followers_count = followers_count + 1 WHERE user_id = :following_id`,
            { following_id }, { autoCommit: true }
        );

        res.json({ message: 'Followed!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/users/:id/follow — unfollow a user
router.delete('/:id/follow', async (req, res) => {
    let connection;
    try {
        const { follower_id } = req.body;
        const following_id = req.params.id;

        connection = await getConnection();
        await connection.execute(
            `DELETE FROM followers WHERE follower_id = :follower_id AND following_id = :following_id`,
            { follower_id, following_id },
            { autoCommit: true }
        );

        await connection.execute(
            `UPDATE users SET following_count = following_count - 1 WHERE user_id = :follower_id`,
            { follower_id }, { autoCommit: true }
        );
        await connection.execute(
            `UPDATE users SET followers_count = followers_count - 1 WHERE user_id = :following_id`,
            { following_id }, { autoCommit: true }
        );

        res.json({ message: 'Unfollowed!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
