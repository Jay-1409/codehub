const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');
require('dotenv').config();

function resolveOracleLibDir() {
    const isMac = process.platform === 'darwin';
    const hasClientLib = (dir) => {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;

        const files = fs.readdirSync(dir);
        if (isMac) {
            return files.some((name) => name === 'libclntsh.dylib' || name.startsWith('libclntsh.dylib.'));
        }

        return files.some((name) => name === 'libclntsh.so' || name.startsWith('libclntsh.so.'));
    };

    const configured = [
        process.env.INSTANT_CLIENT_PATH,
        process.env.ORACLE_CLIENT_LIB_DIR,
        process.env.ORACLE_HOME ? path.join(process.env.ORACLE_HOME, 'lib') : undefined,
        path.join(process.cwd(), '.render', 'oracle', 'instantclient'),
        path.join(process.cwd(), '.render', 'oracle'),
        '/opt/render/project/src/.render/oracle/instantclient',
        '/opt/render/project/src/.render/oracle'
    ].filter(Boolean);

    const defaults = process.platform === 'darwin'
        ? ['/usr/local/lib', '/opt/homebrew/lib']
        : [];

    const candidates = [...configured, ...defaults];
    for (const dir of candidates) {
        const normalized = path.resolve(dir);
        if (hasClientLib(normalized)) {
            return normalized;
        }

        if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
            const child = fs.readdirSync(normalized)
                .map((name) => path.join(normalized, name))
                .find((childPath) =>
                    fs.existsSync(childPath)
                    && fs.statSync(childPath).isDirectory()
                    && path.basename(childPath).startsWith('instantclient_')
                    && hasClientLib(childPath)
                );
            if (child) return child;
        }
    }

    return undefined;
}

const oracleDriverMode = (process.env.ORACLE_DRIVER_MODE || 'thin').toLowerCase();

// Prefer thick mode when available, but don't crash startup in auto mode.
if (oracleDriverMode !== 'thin') {
    try {
        const libDir = resolveOracleLibDir();
        if (libDir) {
            process.env.INSTANT_CLIENT_PATH = libDir;
            oracledb.initOracleClient({ libDir });
            console.log(`Oracle driver mode: thick (${libDir})`);
        } else if (oracleDriverMode === 'thick') {
            oracledb.initOracleClient();
            console.log('Oracle driver mode: thick (system library path)');
        } else {
            console.warn('Oracle Instant Client not found. Falling back to thin mode.');
        }
    } catch (err) {
        const isClientLibError = err && err.code === 'DPI-1047';
        if (!isClientLibError) {
            console.error('Thick mode initialization error. Ensure Oracle Instant Client is installed.');
            console.error('Download from: https://www.oracle.com/database/technologies/instant-client/downloads.html');
            console.error('Set INSTANT_CLIENT_PATH to the folder containing libclntsh.*');
            throw err;
        }

        // On Render native runtimes, missing native deps (e.g. libaio/libnnz) are common.
        // Do not crash process startup; continue with thin mode.
        console.warn(`Oracle driver fallback to thin mode: ${err.message}`);
    }
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
