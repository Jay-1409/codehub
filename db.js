const oracledb = require('oracledb');
require('dotenv').config();

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
