const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { getConnection } = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const repoRoutes = require('./routes/repos');
const userRoutes = require('./routes/users');
const issueRoutes = require('./routes/issues');
const pullRoutes = require('./routes/pulls');
const starRoutes = require('./routes/stars');
const gitRoutes = require('./routes/git');

const app = express();
const PORT = process.env.PORT || 5089;
const GIT_PORT = process.env.GIT_PORT || 7000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logger Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// -------- TESTS --------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});
app.get('/api/test-db', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute('SELECT 1 FROM DUAL');
        res.json({ status: 'Connected to Oracle! ✅', result: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

//----------------------------- APIS ------------------------------//
app.use('/api/auth', authRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/users', userRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/pulls', pullRoutes);
app.use('/api/stars', starRoutes);
app.use('/api/git', gitRoutes);

// START EXPRESS APP
const expressServer = app.listen(PORT, () => {
    console.log(`🌐 Express API running on http://localhost:${PORT}`);
});

// ==================== GRACEFUL SHUTDOWN ====================
// Ensure ports are released when nodemon restarts or user presses Ctrl+C
function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');

    expressServer.close(() => {
        console.log('🌐 Express server closed.');
        process.exit(0);
    });

    // Force close after 5 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('⚠️ Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGUSR2', shutdown); // specifically for nodemon restarts
