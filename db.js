const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
require('dotenv').config();

function resolveOracleLibDir() {
    const configured = [
        process.env.INSTANT_CLIENT_PATH,
        process.env.ORACLE_CLIENT_LIB_DIR,
        process.env.ORACLE_HOME ? path.join(process.env.ORACLE_HOME, 'lib') : undefined,
        '/opt/oracle/instantclient'
    ].filter(Boolean);

    const libNames = process.platform === 'darwin'
        ? ['libclntsh.dylib', 'libclntsh.dylib.']
        : ['libclntsh.so', 'libclntsh.so.'];

    const candidates = [...configured];
    for (const dir of candidates) {
        const normalized = path.resolve(dir);
        if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
            continue;
        }

        const files = fs.readdirSync(normalized);
        const hasClientLib = files.some((name) =>
            libNames.some((prefix) => name === prefix || name.startsWith(prefix))
        );
        if (hasClientLib) {
            return normalized;
        }
    }

    return undefined;
}

try {
    const libDir = resolveOracleLibDir();
    if (!libDir) {
        throw new Error('Oracle Instant Client not found. Expected at INSTANT_CLIENT_PATH/ORACLE_CLIENT_LIB_DIR or /opt/oracle/instantclient');
    }

    process.env.INSTANT_CLIENT_PATH = libDir;
    oracledb.initOracleClient({ libDir });
    console.log(`Oracle driver mode: thick (${libDir})`);
} catch (err) {
    console.error('Thick mode initialization error. Docker image must contain Oracle Instant Client and Linux deps.');
    throw err;
}

// Ensure Oracle CLOB columns are returned as plain strings.
// This prevents JSON serialization errors when API responses include file content/body fields.
oracledb.fetchAsString = [oracledb.CLOB];

function assertDbConfig() {
    const required = ['DB_USER', 'DB_PASSWORD', 'DB_CONNECTSTRING'];
    for (const key of required) {
        if (!process.env[key]) {
            // FIX: Fail fast on missing DB configuration instead of throwing ambiguous runtime connection errors.
            throw new Error(`Missing required environment variable: ${key}`);
        }
    }
}
assertDbConfig();

async function getConnection() {
    return await oracledb.getConnection({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECTSTRING
    });
}

module.exports = { getConnection };
