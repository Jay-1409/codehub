const { createError, toInt } = require('./api');

function mapRepoRow(row) {
    return {
        repoId: Number(row[0]),
        ownerId: Number(row[1]),
        repoName: row[2],
        visibility: row[3] || 'private',
        ownerUsername: row[4],
        defaultBranch: row[5] || 'main'
    };
}

async function fetchRepoByOwnerName(connection, owner, repoName) {
    const result = await connection.execute(
        `SELECT r.repo_id, r.owner_id, r.repo_name, r.visibility, u.username, r.default_branch
         FROM repositories r
         JOIN users u ON r.owner_id = u.user_id
         WHERE u.username = :owner AND r.repo_name = :repo_name`,
        { owner, repo_name: repoName }
    );
    if (result.rows.length === 0) return null;
    return mapRepoRow(result.rows[0]);
}

async function fetchRepoById(connection, repoId) {
    const numericRepoId = toInt(repoId);
    if (!numericRepoId) return null;
    const result = await connection.execute(
        `SELECT r.repo_id, r.owner_id, r.repo_name, r.visibility, u.username, r.default_branch
         FROM repositories r
         JOIN users u ON r.owner_id = u.user_id
         WHERE r.repo_id = :repo_id`,
        { repo_id: numericRepoId }
    );
    if (result.rows.length === 0) return null;
    return mapRepoRow(result.rows[0]);
}

async function getCollaboratorRole(connection, repoId, userId) {
    try {
        const result = await connection.execute(
            `SELECT role
             FROM repository_collaborators
             WHERE repo_id = :repo_id AND user_id = :user_id`,
            { repo_id: repoId, user_id: userId }
        );
        return result.rows.length ? String(result.rows[0][0]).toLowerCase() : null;
    } catch (err) {
        // FIX: Preserve existing functionality when collaborators migration has not yet been applied.
        if (err && err.errorNum === 942) return null;
        throw err;
    }
}

function roleAllows(role, needed) {
    const levels = { read: 1, write: 2, admin: 3 };
    return (levels[role] || 0) >= (levels[needed] || 0);
}

async function assertRepoAccess(connection, repo, authUser, needed = 'read') {
    if (!repo) throw createError(404, 'REPO_NOT_FOUND', 'Repository not found');
    if (!authUser) {
        if (repo.visibility === 'public' && needed === 'read') return { role: 'public' };
        throw createError(401, 'AUTH_REQUIRED', 'Authentication required');
    }

    if (Number(repo.ownerId) === Number(authUser.userId)) return { role: 'owner' };

    const collaboratorRole = await getCollaboratorRole(connection, repo.repoId, authUser.userId);
    if (collaboratorRole) {
        if (!roleAllows(collaboratorRole, needed)) {
            throw createError(403, 'FORBIDDEN', 'Insufficient repository permissions');
        }
        return { role: collaboratorRole };
    }

    if (needed === 'read' && repo.visibility === 'public') return { role: 'public' };
    throw createError(403, 'FORBIDDEN', 'You do not have access to this repository');
}

async function assertRepoAccessById(connection, repoId, authUser, needed = 'read') {
    const repo = await fetchRepoById(connection, repoId);
    await assertRepoAccess(connection, repo, authUser, needed);
    return repo;
}

module.exports = {
    fetchRepoByOwnerName,
    fetchRepoById,
    assertRepoAccess,
    assertRepoAccessById
};
