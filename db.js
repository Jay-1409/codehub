const oracledb = require('oracledb');
require('dotenv').config();

// Initialize thick mode to support advanced networking features (encryption, data integrity)
// Required to fix ORA-12660 / NJS-533 errors
try {
    // Auto-detect Instant Client location or use environment variable
    const libDir = process.env.INSTANT_CLIENT_PATH || 
                   (process.platform === 'darwin' ? '/usr/local/lib' : undefined);
    
    if (libDir) {
        oracledb.initOracleClient({ libDir });
    } else {
        oracledb.initOracleClient();
    }
} catch (err) {
    console.error('Thick mode initialization error. Ensure Oracle Instant Client is installed.');
    console.error('Download from: https://www.oracle.com/database/technologies/instant-client/downloads.html');
    console.error('Set INSTANT_CLIENT_PATH environment variable to the library directory.');
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
