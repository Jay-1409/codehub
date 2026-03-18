const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
require('dotenv').config();

function resolveOracleLibDir() {
    const libName = process.platform === 'darwin' ? 'libclntsh.dylib' : 'libclntsh.so';
    const configured = [
        process.env.INSTANT_CLIENT_PATH,
        process.env.ORACLE_CLIENT_LIB_DIR,
        process.env.ORACLE_HOME ? path.join(process.env.ORACLE_HOME, 'lib') : undefined
    ].filter(Boolean);

    const defaults = process.platform === 'darwin'
        ? ['/usr/local/lib', '/opt/homebrew/lib']
        : ['/opt/render/project/src/.render/oracle/instantclient_23_8'];

    const candidates = [...configured, ...defaults];
    for (const dir of candidates) {
        const normalized = path.resolve(dir);
        if (fs.existsSync(path.join(normalized, libName))) {
            return normalized;
        }

        if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
            const child = fs.readdirSync(normalized)
                .map((name) => path.join(normalized, name))
                .find((childPath) =>
                    fs.existsSync(childPath)
                    && fs.statSync(childPath).isDirectory()
                    && path.basename(childPath).startsWith('instantclient_')
                    && fs.existsSync(path.join(childPath, libName))
                );
            if (child) return child;
        }
    }

    return undefined;
}

// Initialize thick mode to support advanced networking features (encryption, data integrity)
// Required to fix ORA-12660 / NJS-533 errors
try {
    const libDir = resolveOracleLibDir();
    if (libDir) {
        oracledb.initOracleClient({ libDir });
    } else {
        oracledb.initOracleClient();
    }
} catch (err) {
    console.error('Thick mode initialization error. Ensure Oracle Instant Client is installed.');
    console.error('Download from: https://www.oracle.com/database/technologies/instant-client/downloads.html');
    console.error('Set INSTANT_CLIENT_PATH to the folder containing libclntsh.*');
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
