const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'codehub_secret_key';

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
    let connection;
    try {
        const { username, full_name, email, password } = req.body;
        const password_hash = await bcrypt.hash(password, 10);

        connection = await getConnection();
        await connection.execute(
            `INSERT INTO users (username, full_name, email, password_hash) 
             VALUES (:username, :full_name, :email, :password_hash)`,
            { username, full_name, email, password_hash },
            { autoCommit: true }
        );

        res.status(201).json({ message: 'User created successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    let connection;
    try {
        const { username, password } = req.body;
        connection = await getConnection();

        const result = await connection.execute(
            `SELECT user_id, username, email, password_hash FROM users WHERE username = :username`,
            { username }
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user[3]);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        const token = jwt.sign(
            { user_id: user[0], username: user[1] },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { user_id: user[0], username: user[1], email: user[2] }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
