const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getConnection } = require('../db');

// Generate a random commit hash (like git)
function generateHash() {
    return crypto.randomBytes(20).toString('hex');
}

// ==================== COMMIT ====================
// POST /api/git/commit — commit changes (save files + create commit record)
router.post('/commit', async (req, res) => {
    let connection;
    try {
        const { repo_id, author_id, message, files, branch_name } = req.body;
        // files = [{ file_name, file_path, content, file_type }]

        connection = await getConnection();
        const commit_hash = generateHash();

        // Get branch_id
        const branchResult = await connection.execute(
            `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND branch_name = :branch_name`,
            { repo_id, branch_name: branch_name || 'main' }
        );

        if (branchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        const branch_id = branchResult.rows[0][0];

        let additions = 0;
        let deletions = 0;

        // Upsert each file
        if (files && files.length > 0) {
            for (const file of files) {
                // Check if file already exists
                const existingFile = await connection.execute(
                    `SELECT file_id, content FROM repo_files 
                     WHERE repo_id = :repo_id AND branch_id = :branch_id AND file_path = :file_path`,
                    { repo_id, branch_id, file_path: file.file_path }
                );

                if (existingFile.rows.length > 0) {
                    // Update existing file
                    const oldContent = existingFile.rows[0][1] || '';
                    deletions += oldContent.split('\n').length;
                    additions += (file.content || '').split('\n').length;

                    await connection.execute(
                        `UPDATE repo_files 
                         SET content = :content, file_name = :file_name, file_type = :file_type,
                             file_size = :file_size, last_modified = CURRENT_TIMESTAMP
                         WHERE file_id = :file_id`,
                        {
                            content: file.content,
                            file_name: file.file_name,
                            file_type: file.file_type || 'text',
                            file_size: (file.content || '').length,
                            file_id: existingFile.rows[0][0]
                        }
                    );
                } else {
                    // Insert new file
                    additions += (file.content || '').split('\n').length;

                    await connection.execute(
                        `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size) 
                         VALUES (:repo_id, :branch_id, :file_name, :file_path, :content, :file_type, :file_size)`,
                        {
                            repo_id, branch_id,
                            file_name: file.file_name,
                            file_path: file.file_path,
                            content: file.content,
                            file_type: file.file_type || 'text',
                            file_size: (file.content || '').length
                        }
                    );
                }
            }
        }

        // Create commit record
        await connection.execute(
            `INSERT INTO commits (repo_id, author_id, commit_hash, message, additions, deletions) 
             VALUES (:repo_id, :author_id, :commit_hash, :message, :additions, :deletions)`,
            { repo_id, author_id, commit_hash, message, additions, deletions }
        );

        // Update repo timestamp
        await connection.execute(
            `UPDATE repositories SET updated_at = CURRENT_TIMESTAMP WHERE repo_id = :repo_id`,
            { repo_id }
        );

        await connection.execute('COMMIT');

        res.status(201).json({
            message: 'Commit successful!',
            commit_hash,
            additions,
            deletions,
            files_changed: files ? files.length : 0
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== PUSH ====================
// POST /api/git/push — push multiple commits + files to a branch
router.post('/push', async (req, res) => {
    let connection;
    try {
        const { repo_id, author_id, branch_name, commits: commitList } = req.body;
        // commits = [{ message, files: [{ file_name, file_path, content, file_type }] }]

        connection = await getConnection();

        // Get or create branch
        let branchResult = await connection.execute(
            `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND branch_name = :branch_name`,
            { repo_id, branch_name: branch_name || 'main' }
        );

        let branch_id;
        if (branchResult.rows.length === 0) {
            // Create branch if it doesn't exist
            await connection.execute(
                `INSERT INTO branches (repo_id, branch_name, is_default) VALUES (:repo_id, :branch_name, 0)`,
                { repo_id, branch_name }
            );
            branchResult = await connection.execute(
                `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND branch_name = :branch_name`,
                { repo_id, branch_name }
            );
            branch_id = branchResult.rows[0][0];
        } else {
            branch_id = branchResult.rows[0][0];
        }

        const pushedCommits = [];

        for (const commit of commitList) {
            const commit_hash = generateHash();
            let additions = 0, deletions = 0;

            // Process files for this commit
            if (commit.files && commit.files.length > 0) {
                for (const file of commit.files) {
                    const existing = await connection.execute(
                        `SELECT file_id FROM repo_files 
                         WHERE repo_id = :repo_id AND branch_id = :branch_id AND file_path = :file_path`,
                        { repo_id, branch_id, file_path: file.file_path }
                    );

                    if (existing.rows.length > 0) {
                        await connection.execute(
                            `UPDATE repo_files SET content = :content, file_name = :file_name,
                                 file_size = :file_size, last_modified = CURRENT_TIMESTAMP
                             WHERE file_id = :file_id`,
                            {
                                content: file.content,
                                file_name: file.file_name,
                                file_size: (file.content || '').length,
                                file_id: existing.rows[0][0]
                            }
                        );
                    } else {
                        await connection.execute(
                            `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size) 
                             VALUES (:repo_id, :branch_id, :file_name, :file_path, :content, :file_type, :file_size)`,
                            {
                                repo_id, branch_id,
                                file_name: file.file_name,
                                file_path: file.file_path,
                                content: file.content,
                                file_type: file.file_type || 'text',
                                file_size: (file.content || '').length
                            }
                        );
                    }
                    additions += (file.content || '').split('\n').length;
                }
            }

            // Create commit
            await connection.execute(
                `INSERT INTO commits (repo_id, author_id, commit_hash, message, additions, deletions) 
                 VALUES (:repo_id, :author_id, :commit_hash, :message, :additions, :deletions)`,
                { repo_id, author_id, commit_hash, message: commit.message, additions, deletions }
            );

            pushedCommits.push({ commit_hash, message: commit.message });
        }

        await connection.execute(
            `UPDATE repositories SET updated_at = CURRENT_TIMESTAMP WHERE repo_id = :repo_id`,
            { repo_id }
        );

        await connection.execute('COMMIT');

        res.json({
            message: `Pushed ${pushedCommits.length} commit(s) to ${branch_name}`,
            branch: branch_name,
            commits: pushedCommits
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== PULL ====================
// GET /api/git/pull/:owner/:repo — pull all files from a repo/branch
router.get('/pull/:owner/:repo', async (req, res) => {
    let connection;
    try {
        const branch_name = req.query.branch || 'main';
        connection = await getConnection();

        const result = await connection.execute(
            `SELECT f.file_name, f.file_path, f.content, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             JOIN repositories r ON f.repo_id = r.repo_id
             JOIN users u ON r.owner_id = u.user_id
             WHERE u.username = :owner AND r.repo_name = :repo AND b.branch_name = :branch_name
             ORDER BY f.file_path`,
            { owner: req.params.owner, repo: req.params.repo, branch_name }
        );

        // Get latest commits
        const commits = await connection.execute(
            `SELECT c.commit_hash, c.message, c.additions, c.deletions, c.created_at, u.username
             FROM commits c
             JOIN repositories r ON c.repo_id = r.repo_id
             JOIN users u ON c.author_id = u.user_id
             JOIN users owner ON r.owner_id = owner.user_id
             WHERE owner.username = :owner AND r.repo_name = :repo
             ORDER BY c.created_at DESC
             FETCH FIRST 10 ROWS ONLY`,
            { owner: req.params.owner, repo: req.params.repo }
        );

        res.json({
            branch: branch_name,
            files: result.rows,
            recent_commits: commits.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== CLONE ====================
// POST /api/git/clone — fork/clone a repository
router.post('/clone', async (req, res) => {
    let connection;
    try {
        const { repo_id, user_id } = req.body;
        connection = await getConnection();

        // Get original repo info
        const repoResult = await connection.execute(
            `SELECT repo_name, description, language, default_branch FROM repositories WHERE repo_id = :repo_id`,
            { repo_id }
        );

        if (repoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Repository not found' });
        }

        const original = repoResult.rows[0];

        // Create forked repo
        await connection.execute(
            `INSERT INTO repositories (owner_id, repo_name, description, language, default_branch) 
             VALUES (:user_id, :repo_name, :description, :language, :default_branch)`,
            {
                user_id,
                repo_name: original[0],
                description: 'Forked from: ' + original[1],
                language: original[2],
                default_branch: original[3] || 'main'
            }
        );

        // Get the new repo ID
        const newRepoResult = await connection.execute(
            `SELECT repo_id FROM repositories WHERE owner_id = :user_id AND repo_name = :repo_name ORDER BY created_at DESC FETCH FIRST 1 ROW ONLY`,
            { user_id, repo_name: original[0] }
        );
        const new_repo_id = newRepoResult.rows[0][0];

        // Create default branch for forked repo
        await connection.execute(
            `INSERT INTO branches (repo_id, branch_name, is_default) VALUES (:repo_id, :branch_name, 1)`,
            { repo_id: new_repo_id, branch_name: original[3] || 'main' }
        );

        // Get new branch ID
        const newBranchResult = await connection.execute(
            `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND is_default = 1`,
            { repo_id: new_repo_id }
        );
        const new_branch_id = newBranchResult.rows[0][0];

        // Copy all files from original repo's default branch
        await connection.execute(
            `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size)
             SELECT :new_repo_id, :new_branch_id, f.file_name, f.file_path, f.content, f.file_type, f.file_size
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             WHERE f.repo_id = :repo_id AND b.is_default = 1`,
            { new_repo_id, new_branch_id, repo_id }
        );

        // Record the fork
        await connection.execute(
            `INSERT INTO forks (original_repo_id, forked_repo_id, user_id) 
             VALUES (:repo_id, :new_repo_id, :user_id)`,
            { repo_id, new_repo_id, user_id }
        );

        // Update fork count on original
        await connection.execute(
            `UPDATE repositories SET forks_count = forks_count + 1 WHERE repo_id = :repo_id`,
            { repo_id }
        );

        await connection.execute('COMMIT');

        res.status(201).json({
            message: 'Repository cloned/forked!',
            new_repo_id,
            forked_from: repo_id
        });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== BRANCHES ====================
// GET /api/git/branches/:repo_id — list branches
router.get('/branches/:repo_id', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT branch_id, branch_name, is_default, created_at 
             FROM branches WHERE repo_id = :repo_id ORDER BY is_default DESC, created_at`,
            { repo_id: req.params.repo_id }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// POST /api/git/branches — create a new branch (copies files from source branch)
router.post('/branches', async (req, res) => {
    let connection;
    try {
        const { repo_id, branch_name, source_branch } = req.body;
        connection = await getConnection();

        // Create new branch
        await connection.execute(
            `INSERT INTO branches (repo_id, branch_name, is_default) VALUES (:repo_id, :branch_name, 0)`,
            { repo_id, branch_name }
        );

        // Get new branch ID
        const newBranch = await connection.execute(
            `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND branch_name = :branch_name`,
            { repo_id, branch_name }
        );
        const new_branch_id = newBranch.rows[0][0];

        // Copy files from source branch
        const sourceBranch = await connection.execute(
            `SELECT branch_id FROM branches WHERE repo_id = :repo_id AND branch_name = :source_branch`,
            { repo_id, source_branch: source_branch || 'main' }
        );

        if (sourceBranch.rows.length > 0) {
            await connection.execute(
                `INSERT INTO repo_files (repo_id, branch_id, file_name, file_path, content, file_type, file_size)
                 SELECT repo_id, :new_branch_id, file_name, file_path, content, file_type, file_size
                 FROM repo_files
                 WHERE repo_id = :repo_id AND branch_id = :source_branch_id`,
                { new_branch_id, repo_id, source_branch_id: sourceBranch.rows[0][0] }
            );
        }

        await connection.execute('COMMIT');

        res.status(201).json({ message: `Branch '${branch_name}' created!`, branch_id: new_branch_id });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// DELETE /api/git/branches/:branch_id — delete a branch
router.delete('/branches/:branch_id', async (req, res) => {
    let connection;
    try {
        connection = await getConnection();

        // Don't allow deleting default branch
        const check = await connection.execute(
            `SELECT is_default FROM branches WHERE branch_id = :branch_id`,
            { branch_id: req.params.branch_id }
        );

        if (check.rows.length > 0 && check.rows[0][0] === 1) {
            return res.status(400).json({ error: 'Cannot delete the default branch' });
        }

        // Delete files on that branch
        await connection.execute(
            `DELETE FROM repo_files WHERE branch_id = :branch_id`,
            { branch_id: req.params.branch_id }
        );

        await connection.execute(
            `DELETE FROM branches WHERE branch_id = :branch_id`,
            { branch_id: req.params.branch_id }
        );

        await connection.execute('COMMIT');
        res.json({ message: 'Branch deleted!' });
    } catch (err) {
        if (connection) await connection.execute('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== COMMIT LOG ====================
// GET /api/git/log/:owner/:repo — get commit history
router.get('/log/:owner/:repo', async (req, res) => {
    let connection;
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT c.commit_id, c.commit_hash, c.message, c.additions, c.deletions, 
                    c.created_at, u.username, u.avatar_url
             FROM commits c
             JOIN repositories r ON c.repo_id = r.repo_id
             JOIN users u ON c.author_id = u.user_id
             JOIN users owner ON r.owner_id = owner.user_id
             WHERE owner.username = :owner AND r.repo_name = :repo
             ORDER BY c.created_at DESC
             OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`,
            { owner: req.params.owner, repo: req.params.repo, offset, limit }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== FILE TREE ====================
// GET /api/git/tree/:owner/:repo — get file tree
router.get('/tree/:owner/:repo', async (req, res) => {
    let connection;
    try {
        const branch_name = req.query.branch || 'main';
        connection = await getConnection();

        const result = await connection.execute(
            `SELECT f.file_id, f.file_name, f.file_path, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             JOIN repositories r ON f.repo_id = r.repo_id
             JOIN users u ON r.owner_id = u.user_id
             WHERE u.username = :owner AND r.repo_name = :repo AND b.branch_name = :branch_name
             ORDER BY f.file_path`,
            { owner: req.params.owner, repo: req.params.repo, branch_name }
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

// ==================== FILE CONTENT ====================
// GET /api/git/blob/:owner/:repo?file_path=...&branch=... — get single file content
router.get('/blob/:owner/:repo', async (req, res) => {
    let connection;
    try {
        const branch_name = req.query.branch || 'main';
        const file_path = req.query.file_path;

        if (!file_path) {
            return res.status(400).json({ error: 'file_path query parameter is required' });
        }

        connection = await getConnection();
        const result = await connection.execute(
            `SELECT f.file_id, f.file_name, f.file_path, f.content, f.file_type, f.file_size, f.last_modified
             FROM repo_files f
             JOIN branches b ON f.branch_id = b.branch_id
             JOIN repositories r ON f.repo_id = r.repo_id
             JOIN users u ON r.owner_id = u.user_id
             WHERE u.username = :owner AND r.repo_name = :repo 
                   AND b.branch_name = :branch_name AND f.file_path = :file_path`,
            { owner: req.params.owner, repo: req.params.repo, branch_name, file_path }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (connection) await connection.close();
    }
});

module.exports = router;
