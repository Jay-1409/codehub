const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { getConnection } = require('./db');
const { sendError, createError } = require('./lib/api');

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
const DIST_DIR = path.join(__dirname, 'dist');
const DIST_INDEX = path.join(DIST_DIR, 'index.html');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5080,https://codehub.jclouds.space')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        // FIX: Restrict CORS to configured origins to avoid accidental cross-origin exposure.
        return callback(createError(403, 'CORS_NOT_ALLOWED', 'Origin not allowed by CORS policy'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(DIST_DIR));

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
        sendError(res, err);
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

app.use((err, req, res, _next) => {
    console.error('Unhandled request error:', err);
    return sendError(res, err);
});

app.get(/^\/(?!api\/?).*/, (req, res) => {
    if (!fs.existsSync(DIST_INDEX)) {
        return res.status(500).send('Frontend build not found. Run: npm run build');
    }
    res.sendFile(DIST_INDEX);
});

// START EXPRESS APP
const expressServer = app.listen(PORT, () => {
    console.log(`🌐 Express API running on http://localhost:${PORT}`);
});

expressServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use.`);
        console.error(`Run: lsof -ti :${PORT} | xargs kill -9`);
    } else {
        console.error('❌ Server startup error:', err);
    }
    process.exit(1);
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

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
