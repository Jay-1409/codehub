const express = require('express');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString, toInt } = require('../lib/api');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/users/:username — user profile
router.get('/:username', optionalAuth, async (req, res) => {
    let connection;
    try {
        const username = requireNonEmptyString(req.params.username).toLowerCase();
        if (!username) throw createError(400, 'INVALID_INPUT', 'username is required');

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT user_id, username, full_name, email, avatar_url, bio, location,
                    public_repos, followers_count, following_count, created_at
             FROM users
             WHERE username = :username`,
            { username }
        );

        if (result.rows.length === 0) {
            throw createError(404, 'USER_NOT_FOUND', 'User not found');
        }

        const row = result.rows[0];
        const isSelf = req.authUser && Number(req.authUser.userId) === Number(row[0]);
        if (!isSelf) row[3] = null; // FIX: Hide user email from non-owner profile requests.
        res.json(row);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/users/:username/repos — user's repos
router.get('/:username/repos', optionalAuth, async (req, res) => {
    let connection;
    try {
        const username = requireNonEmptyString(req.params.username).toLowerCase();
        if (!username) throw createError(400, 'INVALID_INPUT', 'username is required');

        connection = await getConnection();
        const params = {
            username,
            requester_id: req.authUser?.userId || -1
        };

        let query = `SELECT DISTINCT r.repo_id, r.repo_name, r.description, r.language,
                             r.stars_count, r.forks_count, r.visibility, r.created_at
                     FROM repositories r
                     JOIN users u ON r.owner_id = u.user_id
                     LEFT JOIN repository_collaborators rc
                       ON rc.repo_id = r.repo_id AND rc.user_id = :requester_id
                     WHERE u.username = :username
                       AND (r.visibility = 'public' OR r.owner_id = :requester_id OR rc.user_id IS NOT NULL)
                     ORDER BY r.created_at DESC`;

        try {
            const result = await connection.execute(query, params);
            return res.json(result.rows);
        } catch (err) {
            if (err && err.errorNum !== 942) throw err;
        }

        // FIX: Backward-compatible fallback if collaborators table does not exist.
        query = `SELECT r.repo_id, r.repo_name, r.description, r.language,
                        r.stars_count, r.forks_count, r.visibility, r.created_at
                 FROM repositories r
                 JOIN users u ON r.owner_id = u.user_id
                 WHERE u.username = :username
                   AND (r.visibility = 'public' OR r.owner_id = :requester_id)
                 ORDER BY r.created_at DESC`;
        const fallbackResult = await connection.execute(query, params);
        res.json(fallbackResult.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/users/:id — update profile
router.put('/:id', requireAuth, async (req, res) => {
    let connection;
    try {
        const userId = toInt(req.params.id);
        if (!userId) throw createError(400, 'INVALID_INPUT', 'Invalid user id');
        if (Number(req.authUser.userId) !== Number(userId)) {
            throw createError(403, 'FORBIDDEN', 'You can only update your own profile');
        }

        const full_name = requireNonEmptyString(req.body?.full_name);
        const bio = requireNonEmptyString(req.body?.bio);
        const location = requireNonEmptyString(req.body?.location);
        const avatar_url = requireNonEmptyString(req.body?.avatar_url);

        connection = await getConnection();
        await connection.execute(
            `UPDATE users
             SET full_name = :full_name,
                 bio = :bio,
                 location = :location,
                 avatar_url = :avatar_url
             WHERE user_id = :id`,
            {
                full_name: full_name || null,
                bio: bio || null,
                location: location || null,
                avatar_url: avatar_url || null,
                id: userId
            },
            { autoCommit: true }
        );

        res.json({ ok: true, message: 'Profile updated' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/users/:id/follow — follow a user
router.post('/:id/follow', requireAuth, async (req, res) => {
    let connection;
    try {
        const followerId = Number(req.authUser.userId);
        const followingId = toInt(req.params.id);
        if (!followingId) throw createError(400, 'INVALID_INPUT', 'Invalid user id');
        if (followerId === followingId) {
            throw createError(400, 'INVALID_INPUT', 'You cannot follow yourself');
        }

        connection = await getConnection();

        await connection.execute(
            `INSERT INTO followers (follower_id, following_id)
             VALUES (:follower_id, :following_id)`,
            { follower_id: followerId, following_id: followingId },
            { autoCommit: true }
        );

        await connection.execute(
            `UPDATE users
             SET following_count = following_count + 1
             WHERE user_id = :follower_id`,
            { follower_id: followerId },
            { autoCommit: true }
        );
        await connection.execute(
            `UPDATE users
             SET followers_count = followers_count + 1
             WHERE user_id = :following_id`,
            { following_id: followingId },
            { autoCommit: true }
        );

        res.json({ ok: true, message: 'Followed' });
    } catch (err) {
        if (err && (err.errorNum === 1 || String(err.message || '').includes('ORA-00001'))) {
            return sendError(res, createError(409, 'ALREADY_FOLLOWING', 'Already following this user'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/users/:id/follow — unfollow a user
router.delete('/:id/follow', requireAuth, async (req, res) => {
    let connection;
    try {
        const followerId = Number(req.authUser.userId);
        const followingId = toInt(req.params.id);
        if (!followingId) throw createError(400, 'INVALID_INPUT', 'Invalid user id');
        if (followerId === followingId) {
            throw createError(400, 'INVALID_INPUT', 'You cannot unfollow yourself');
        }

        connection = await getConnection();
        const delResult = await connection.execute(
            `DELETE FROM followers
             WHERE follower_id = :follower_id AND following_id = :following_id`,
            { follower_id: followerId, following_id: followingId },
            { autoCommit: true }
        );

        if (!delResult.rowsAffected) {
            throw createError(404, 'NOT_FOLLOWING', 'You are not following this user');
        }

        await connection.execute(
            `UPDATE users
             SET following_count = CASE WHEN following_count > 0 THEN following_count - 1 ELSE 0 END
             WHERE user_id = :follower_id`,
            { follower_id: followerId },
            { autoCommit: true }
        );
        await connection.execute(
            `UPDATE users
             SET followers_count = CASE WHEN followers_count > 0 THEN followers_count - 1 ELSE 0 END
             WHERE user_id = :following_id`,
            { following_id: followingId },
            { autoCommit: true }
        );

        res.json({ ok: true, message: 'Unfollowed' });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
