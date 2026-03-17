const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { getConnection } = require('../db');
const { createError, sendError, requireNonEmptyString, toInt } = require('../lib/api');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { fetchRepoByOwnerName, assertRepoAccess, assertRepoAccessById, fetchRepoById } = require('../lib/repo-access');

const router = express.Router();

function generateHash() {
    return crypto.randomBytes(20).toString('hex');
}

function lineCount(text) {
    if (!text) return 0;
    return String(text).split('\n').length;
}

function validBranchName(name) {
    return /^[a-zA-Z0-9._/-]{1,100}$/.test(name);
}

function isSafeFilePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
    if (normalized.startsWith('../') || normalized.includes('/../')) return false;
    if (normalized.startsWith('/')) return false;
    return normalized.length > 0 && normalized.length <= 1000;
}

function normalizeFiles(files) {
    if (!Array.isArray(files)) return [];
    return files
        .map((f) => {
            const filePath = requireNonEmptyString(f?.file_path);
            const fileName = requireNonEmptyString(f?.file_name) || path.posix.basename(filePath);
            const content = typeof f?.content === 'string' ? f.content : '';
            const fileType = requireNonEmptyString(f?.file_type) || 'text';
            return { filePath, fileName, content, fileType };
        })
        .filter((f) => f.filePath && isSafeFilePath(f.filePath));
}

async function getBranchId(connection, repoId, branchName) {
    const result = await connection.execute(
        `SELECT branch_id
         FROM branches
         WHERE repo_id = :repo_id AND branch_name = :branch_name`,
        { repo_id: repoId, branch_name: branchName }
    );
    return result.rows[0]?.[0] || null;
}

async function insertCommitFiles(connection, commitId, changes) {
    if (!changes.length) return;
    try {
        for (const change of changes) {
            await connection.execute(
                `INSERT INTO commit_files (commit_id, file_path, change_type, additions, deletions)
                 VALUES (:commit_id, :file_path, :change_type, :additions, :deletions)`,
                {
                    commit_id: commitId,
                    file_path: change.filePath,
                    change_type: change.changeType,
                    additions: change.additions,
                    deletions: change.deletions
                }
            );
        }
    } catch (err) {
        // FIX: Commit operations remain compatible if commit_files migration has not yet been applied.
        if (err && err.errorNum === 942) return;
        throw err;
    }
}

async function createCommitRecord(connection, repoId, authorId, message, additions, deletions) {
    const commitHash = generateHash();
    await connection.execute(
        `INSERT INTO commits (repo_id, author_id, commit_hash, message, additions, deletions)
         VALUES (:repo_id, :author_id, :commit_hash, :message, :additions, :deletions)`,
        { repo_id: repoId, author_id: authorId, commit_hash: commitHash, message, additions, deletions }
    );

    const commitRow = await connection.execute(
        `SELECT commit_id
         FROM commits
         WHERE commit_hash = :commit_hash`,
        { commit_hash: commitHash }
    );
    return {
        commitId: commitRow.rows[0][0],
        commitHash
    };
}

async function applyFilesToBranch(connection, repoId, branchId, files) {
    let additions = 0;
    let deletions = 0;
    const changes = [];

    for (const file of files) {
        const existingFile = await connection.execute(
            `SELECT file_id, content
             FROM repo_files
             WHERE repo_id = :repo_id AND branch_id = :branch_id AND file_path = :file_path`,
            { repo_id: repoId, branch_id: branchId, file_path: file.filePath }
        );

        if (existingFile.rows.length > 0) {
            const oldContent = existingFile.rows[0][1] || '';
            const fileId = existingFile.rows[0][0];
            const addCount = lineCount(file.content);
            const delCount = lineCount(oldContent);
            additions += addCount;
            deletions += delCount;
            changes.push({
                filePath: file.filePath,
                changeType: 'modified',
                additions: addCount,
                deletions: delCount
            });

            await connection.execute(
                `UPDATE repo_files
                 SET content = :content,
                     file_name = :file_name,
                     file_type = :file_type,
                     file_size = :file_size,
                     last_modified = CURRENT_TIMESTAMP
                 WHERE file_id = :file_id`,
                {
                    content: file.content,
                    file_name: file.fileName,
                    file_type: file.fileType,
                    file_size: file.content.length,
                    file_id: fileId
                }
            );
        } else {
            const addCount = lineCount(file.content);
            additions += addCount;
            changes.push({
                filePath: file.filePath,
                changeType: 'added',
                additions: addCount,
                deletions: 0
            });
            await connection.execute(
                `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size)
                 VALUES (:repo_id, :branch_id, :file_name, :file_path, :content, :file_type, :file_size)`,
                {
                    repo_id: repoId,
                    branch_id: branchId,
                    file_name: file.fileName,
                    file_path: file.filePath,
                    content: file.content,
                    file_type: file.fileType,
                    file_size: file.content.length
                }
            );
        }
    }

    return { additions, deletions, changes };
}

// POST /api/git/commit — commit changes
router.post('/commit', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const message = requireNonEmptyString(req.body?.message);
        const branchName = requireNonEmptyString(req.body?.branch_name) || 'main';
        const files = normalizeFiles(req.body?.files);

        if (!repoId || !message) {
            throw createError(400, 'INVALID_INPUT', 'repo_id and commit message are required');
        }
        if (!validBranchName(branchName)) {
            throw createError(400, 'INVALID_BRANCH', 'Invalid branch_name');
        }
        if (!files.length) {
            throw createError(400, 'INVALID_INPUT', 'At least one valid file is required');
        }

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        const branchId = await getBranchId(connection, repoId, branchName);
        if (!branchId) throw createError(404, 'BRANCH_NOT_FOUND', 'Branch not found');

        const applied = await applyFilesToBranch(connection, repoId, branchId, files);
        const commitRecord = await createCommitRecord(
            connection,
            repoId,
            req.authUser.userId,
            message,
            applied.additions,
            applied.deletions
        );
        await insertCommitFiles(connection, commitRecord.commitId, applied.changes);

        await connection.execute(
            `UPDATE repositories
             SET updated_at = CURRENT_TIMESTAMP
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );

        await connection.execute('COMMIT');
        res.status(201).json({
            ok: true,
            message: 'Commit successful',
            commit_hash: commitRecord.commitHash,
            additions: applied.additions,
            deletions: applied.deletions,
            files_changed: files.length
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/git/push — push multiple commits
router.post('/push', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const branchName = requireNonEmptyString(req.body?.branch_name) || 'main';
        const commitList = Array.isArray(req.body?.commits) ? req.body.commits : [];

        if (!repoId || !commitList.length) {
            throw createError(400, 'INVALID_INPUT', 'repo_id and commits[] are required');
        }
        if (!validBranchName(branchName)) {
            throw createError(400, 'INVALID_BRANCH', 'Invalid branch_name');
        }

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        let branchId = await getBranchId(connection, repoId, branchName);
        if (!branchId) {
            // FIX: Auto-create non-existing branch on push to support first push workflows.
            await connection.execute(
                `INSERT INTO branches (repo_id, branch_name, is_default)
                 VALUES (:repo_id, :branch_name, 0)`,
                { repo_id: repoId, branch_name: branchName }
            );
            branchId = await getBranchId(connection, repoId, branchName);
        }

        const pushedCommits = [];
        for (const commit of commitList) {
            const message = requireNonEmptyString(commit?.message);
            if (!message) throw createError(400, 'INVALID_INPUT', 'Each commit requires a message');
            const files = normalizeFiles(commit?.files);
            if (!files.length) throw createError(400, 'INVALID_INPUT', 'Each commit requires at least one valid file');

            const applied = await applyFilesToBranch(connection, repoId, branchId, files);
            const commitRecord = await createCommitRecord(
                connection,
                repoId,
                req.authUser.userId,
                message,
                applied.additions,
                applied.deletions
            );
            await insertCommitFiles(connection, commitRecord.commitId, applied.changes);
            pushedCommits.push({ commit_hash: commitRecord.commitHash, message });
        }

        await connection.execute(
            `UPDATE repositories
             SET updated_at = CURRENT_TIMESTAMP
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );

        await connection.execute('COMMIT');
        res.json({
            ok: true,
            message: `Pushed ${pushedCommits.length} commit(s) to ${branchName}`,
            branch: branchName,
            commits: pushedCommits
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/pull/:owner/:repo — pull all files from a repo/branch
router.get('/pull/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const branchName = requireNonEmptyString(req.query.branch) || 'main';
        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const filesResult = await connection.execute(
            `SELECT f.file_name, f.file_path, f.content, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id AND b.branch_name = :branch_name
             ORDER BY f.file_path`,
            { repo_id: repo.repoId, branch_name: branchName }
        );

        const commitsResult = await connection.execute(
            `SELECT c.commit_hash, c.message, c.additions, c.deletions, c.created_at, u.username
             FROM commits c
             JOIN users u ON c.author_id = u.user_id
             WHERE c.repo_id = :repo_id
             ORDER BY c.created_at DESC
             FETCH FIRST 10 ROWS ONLY`,
            { repo_id: repo.repoId }
        );

        res.json({
            branch: branchName,
            files: filesResult.rows,
            recent_commits: commitsResult.rows
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/git/clone — fork/clone a repository
router.post('/clone', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const forkName = requireNonEmptyString(req.body?.fork_name);
        const autoRename = Boolean(req.body?.auto_rename);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'repo_id is required');

        connection = await getConnection();
        const originalRepo = await fetchRepoById(connection, repoId);
        await assertRepoAccess(connection, originalRepo, req.authUser, 'read');

        if (Number(originalRepo.ownerId) === Number(req.authUser.userId)) {
            throw createError(400, 'INVALID_OPERATION', 'You cannot fork your own repository');
        }

        const desiredBaseName = forkName || originalRepo.repoName;
        let finalRepoName = desiredBaseName;

        const existingNameResult = await connection.execute(
            `SELECT repo_name
             FROM repositories
             WHERE owner_id = :owner_id AND repo_name = :repo_name`,
            { owner_id: req.authUser.userId, repo_name: finalRepoName }
        );

        if (existingNameResult.rows.length > 0) {
            if (!autoRename) {
                throw createError(409, 'REPO_EXISTS', `Repository '${finalRepoName}' already exists in your account`);
            }
            let suffix = 1;
            while (true) {
                const candidate = `${desiredBaseName}-fork${suffix === 1 ? '' : `-${suffix}`}`;
                const candidateResult = await connection.execute(
                    `SELECT repo_name
                     FROM repositories
                     WHERE owner_id = :owner_id AND repo_name = :repo_name`,
                    { owner_id: req.authUser.userId, repo_name: candidate }
                );
                if (!candidateResult.rows.length) {
                    finalRepoName = candidate;
                    break;
                }
                suffix += 1;
            }
        }

        const ownerResult = await connection.execute(
            `SELECT username
             FROM users
             WHERE user_id = :owner_id`,
            { owner_id: originalRepo.ownerId }
        );
        const originalOwnerUsername = ownerResult.rows[0]?.[0] || 'unknown';

        const originalDetail = await connection.execute(
            `SELECT description, language, default_branch
             FROM repositories
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );
        const originalDescription = originalDetail.rows[0]?.[0] || null;
        const originalLanguage = originalDetail.rows[0]?.[1] || null;
        const originalDefaultBranch = originalDetail.rows[0]?.[2] || 'main';

        await connection.execute(
            `INSERT INTO repositories (owner_id, repo_name, description, language, default_branch, visibility)
             VALUES (:owner_id, :repo_name, :description, :language, :default_branch, 'private')`,
            {
                owner_id: req.authUser.userId,
                repo_name: finalRepoName,
                description: `Forked from ${originalOwnerUsername}/${originalRepo.repoName}${originalDescription ? ` • ${originalDescription}` : ''}`,
                language: originalLanguage,
                default_branch: originalDefaultBranch
            }
        );

        const newRepoResult = await connection.execute(
            `SELECT repo_id
             FROM repositories
             WHERE owner_id = :owner_id AND repo_name = :repo_name
             ORDER BY created_at DESC
             FETCH FIRST 1 ROW ONLY`,
            { owner_id: req.authUser.userId, repo_name: finalRepoName }
        );
        const newRepoId = newRepoResult.rows[0][0];

        await connection.execute(
            `INSERT INTO branches (repo_id, branch_name, is_default)
             VALUES (:repo_id, :branch_name, 1)`,
            { repo_id: newRepoId, branch_name: originalDefaultBranch }
        );

        const newBranchIdResult = await connection.execute(
            `SELECT branch_id
             FROM branches
             WHERE repo_id = :repo_id AND is_default = 1`,
            { repo_id: newRepoId }
        );
        const newBranchId = newBranchIdResult.rows[0][0];

        await connection.execute(
            `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size)
             SELECT :new_repo_id, :new_branch_id, f.file_name, f.file_path, f.content, f.file_type, f.file_size
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id AND b.branch_name = :default_branch`,
            { new_repo_id: newRepoId, new_branch_id: newBranchId, repo_id: repoId, default_branch: originalDefaultBranch }
        );

        await connection.execute(
            `INSERT INTO forks (original_repo_id, forked_repo_id, user_id)
             VALUES (:original_repo_id, :forked_repo_id, :user_id)`,
            {
                original_repo_id: repoId,
                forked_repo_id: newRepoId,
                user_id: req.authUser.userId
            }
        );

        await connection.execute(
            `UPDATE repositories
             SET forks_count = forks_count + 1
             WHERE repo_id = :repo_id`,
            { repo_id: repoId }
        );

        await connection.execute(
            `UPDATE users
             SET public_repos = public_repos + 1
             WHERE user_id = :user_id`,
            { user_id: req.authUser.userId }
        );

        await connection.execute('COMMIT');
        res.status(201).json({
            ok: true,
            message: 'Repository cloned/forked',
            new_repo_id: newRepoId,
            new_repo_name: finalRepoName,
            forked_from: repoId
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        if (err && (err.errorNum === 1 || String(err.message || '').includes('ORA-00001'))) {
            return sendError(res, createError(409, 'REPO_EXISTS', 'Fork failed: repository name already exists in your account'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/branches/:repo_id — list branches
router.get('/branches/:repo_id', optionalAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.params.repo_id);
        if (!repoId) throw createError(400, 'INVALID_INPUT', 'Invalid repo_id');

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');
        const result = await connection.execute(
            `SELECT branch_id, branch_name, is_default, created_at
             FROM branches
             WHERE repo_id = :repo_id
             ORDER BY is_default DESC, created_at`,
            { repo_id: repoId }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/git/branches — create a new branch
router.post('/branches', requireAuth, async (req, res) => {
    let connection;
    try {
        const repoId = toInt(req.body?.repo_id);
        const branchName = requireNonEmptyString(req.body?.branch_name);
        const sourceBranch = requireNonEmptyString(req.body?.source_branch) || 'main';
        if (!repoId || !branchName) throw createError(400, 'INVALID_INPUT', 'repo_id and branch_name are required');
        if (!validBranchName(branchName) || !validBranchName(sourceBranch)) {
            throw createError(400, 'INVALID_BRANCH', 'Invalid branch name');
        }

        connection = await getConnection();
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');
        const sourceBranchId = await getBranchId(connection, repoId, sourceBranch);
        if (!sourceBranchId) throw createError(404, 'BRANCH_NOT_FOUND', 'Source branch not found');

        await connection.execute(
            `INSERT INTO branches (repo_id, branch_name, is_default)
             VALUES (:repo_id, :branch_name, 0)`,
            { repo_id: repoId, branch_name: branchName }
        );

        const newBranchId = await getBranchId(connection, repoId, branchName);
        await connection.execute(
            `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size)
             SELECT repo_id, :new_branch_id, file_name, file_path, content, file_type, file_size
             FROM repo_files
             WHERE repo_id = :repo_id AND branch_id = :source_branch_id`,
            { new_branch_id: newBranchId, repo_id: repoId, source_branch_id: sourceBranchId }
        );

        await connection.execute('COMMIT');
        res.status(201).json({ ok: true, message: `Branch '${branchName}' created`, branch_id: newBranchId });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        if (err && (err.errorNum === 1 || String(err.message || '').includes('ORA-00001'))) {
            return sendError(res, createError(409, 'BRANCH_EXISTS', 'Branch already exists'));
        }
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// PUT /api/git/branches/:branch_id/default — switch default branch
router.put('/branches/:branch_id/default', requireAuth, async (req, res) => {
    let connection;
    try {
        const branchId = toInt(req.params.branch_id);
        if (!branchId) throw createError(400, 'INVALID_INPUT', 'Invalid branch_id');

        connection = await getConnection();
        const branchResult = await connection.execute(
            `SELECT branch_id, repo_id, branch_name
             FROM branches
             WHERE branch_id = :branch_id`,
            { branch_id: branchId }
        );
        if (!branchResult.rows.length) throw createError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
        const repoId = branchResult.rows[0][1];
        const branchName = branchResult.rows[0][2];

        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        await connection.execute(
            `UPDATE branches
             SET is_default = CASE WHEN branch_id = :branch_id THEN 1 ELSE 0 END
             WHERE repo_id = :repo_id`,
            { branch_id: branchId, repo_id: repoId }
        );
        await connection.execute(
            `UPDATE repositories
             SET default_branch = :branch_name, updated_at = CURRENT_TIMESTAMP
             WHERE repo_id = :repo_id`,
            { branch_name: branchName, repo_id: repoId }
        );

        await connection.execute('COMMIT');
        res.json({ ok: true, message: `Default branch set to '${branchName}'` });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/git/branches/:branch_id — delete a branch
router.delete('/branches/:branch_id', requireAuth, async (req, res) => {
    let connection;
    try {
        const branchId = toInt(req.params.branch_id);
        if (!branchId) throw createError(400, 'INVALID_INPUT', 'Invalid branch_id');

        connection = await getConnection();
        const check = await connection.execute(
            `SELECT branch_id, repo_id, is_default
             FROM branches
             WHERE branch_id = :branch_id`,
            { branch_id: branchId }
        );
        if (!check.rows.length) throw createError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
        if (Number(check.rows[0][2]) === 1) {
            throw createError(400, 'INVALID_OPERATION', 'Cannot delete the default branch');
        }
        const repoId = check.rows[0][1];
        await assertRepoAccessById(connection, repoId, req.authUser, 'write');

        await connection.execute(`DELETE FROM repo_files WHERE branch_id = :branch_id`, { branch_id: branchId });
        await connection.execute(`DELETE FROM branches WHERE branch_id = :branch_id`, { branch_id: branchId });
        await connection.execute('COMMIT');
        res.json({ ok: true, message: 'Branch deleted' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/log/:owner/:repo — commit history
router.get('/log/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const page = Math.max(1, toInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, toInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;

        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT c.commit_id, c.commit_hash, c.message, c.additions, c.deletions,
                    c.created_at, u.username, u.avatar_url
             FROM commits c
             JOIN users u ON c.author_id = u.user_id
             WHERE c.repo_id = :repo_id
             ORDER BY c.created_at DESC
             OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
            { repo_id: repo.repoId, offset, limit }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/diff/:commit_hash — per-file commit changes
router.get('/diff/:commit_hash', optionalAuth, async (req, res) => {
    let connection;
    try {
        const commitHash = requireNonEmptyString(req.params.commit_hash);
        if (!commitHash) throw createError(400, 'INVALID_INPUT', 'commit_hash is required');

        connection = await getConnection();
        const commitResult = await connection.execute(
            `SELECT commit_id, repo_id, commit_hash, message, additions, deletions, created_at
             FROM commits
             WHERE commit_hash = :commit_hash`,
            { commit_hash: commitHash }
        );
        if (!commitResult.rows.length) throw createError(404, 'COMMIT_NOT_FOUND', 'Commit not found');
        const row = commitResult.rows[0];
        const repoId = row[1];
        await assertRepoAccessById(connection, repoId, req.authUser, 'read');

        let changes = [];
        try {
            const changesResult = await connection.execute(
                `SELECT file_path, change_type, additions, deletions
                 FROM commit_files
                 WHERE commit_id = :commit_id
                 ORDER BY file_path`,
                { commit_id: row[0] }
            );
            changes = changesResult.rows;
        } catch (err) {
            if (!err || err.errorNum !== 942) throw err;
        }

        res.json({
            commit: {
                commit_id: row[0],
                repo_id: row[1],
                commit_hash: row[2],
                message: row[3],
                additions: row[4],
                deletions: row[5],
                created_at: row[6]
            },
            files: changes
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/tree/:owner/:repo — file tree
router.get('/tree/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const branchName = requireNonEmptyString(req.query.branch) || 'main';
        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT f.file_id, f.file_name, f.file_path, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id AND b.branch_name = :branch_name
             ORDER BY f.file_path`,
            { repo_id: repo.repoId, branch_name: branchName }
        );
        res.json(result.rows);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/blob/:owner/:repo?file_path=...&branch=...
router.get('/blob/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const branchName = requireNonEmptyString(req.query.branch) || 'main';
        const filePath = requireNonEmptyString(req.query.file_path);
        if (!owner || !repoName || !filePath) {
            throw createError(400, 'INVALID_INPUT', 'owner, repo and file_path are required');
        }

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT f.file_id, f.file_name, f.file_path, f.content, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id
               AND b.branch_name = :branch_name
               AND f.file_path = :file_path`,
            { repo_id: repo.repoId, branch_name: branchName, file_path: filePath }
        );
        if (!result.rows.length) throw createError(404, 'FILE_NOT_FOUND', 'File not found');
        res.json(result.rows[0]);
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

// GET /api/git/readme/:owner/:repo?branch=...
router.get('/readme/:owner/:repo', optionalAuth, async (req, res) => {
    let connection;
    try {
        const owner = requireNonEmptyString(req.params.owner).toLowerCase();
        const repoName = requireNonEmptyString(req.params.repo);
        const branchName = requireNonEmptyString(req.query.branch) || 'main';
        if (!owner || !repoName) throw createError(400, 'INVALID_INPUT', 'owner and repo are required');

        connection = await getConnection();
        const repo = await fetchRepoByOwnerName(connection, owner, repoName);
        await assertRepoAccess(connection, repo, req.authUser, 'read');

        const result = await connection.execute(
            `SELECT f.file_path, f.content, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id
               AND b.branch_name = :branch_name
               AND LOWER(f.file_name) IN ('readme.md', 'readme.markdown', 'readme.txt')
             ORDER BY CASE WHEN LOWER(f.file_path) = 'readme.md' THEN 0 ELSE 1 END
             FETCH FIRST 1 ROW ONLY`,
            { repo_id: repo.repoId, branch_name: branchName }
        );

        if (!result.rows.length) {
            return res.status(404).json({ ok: false, error: { code: 'README_NOT_FOUND', message: 'README not found' } });
        }
        res.json({
            ok: true,
            file_path: result.rows[0][0],
            content: result.rows[0][1],
            last_modified: result.rows[0][2]
        });
    } catch (err) {
        return sendError(res, err);
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
