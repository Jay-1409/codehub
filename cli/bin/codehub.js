#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import Configstore from 'configstore';
import readline from 'readline';

// Configstore to save JWT token locally (~/.config/configstore/codehub-cli.json)
const config = new Configstore('codehub-cli');

// FIX: Avoid hardcoded API endpoint so CLI works across environments/ports.
const API_BASE = process.env.CODEHUB_API_URL || 'http://localhost:5080/api';

function getErrorMessage(err) {
    const payload = err?.response?.data;
    if (!payload) return err?.message || 'Unknown error';
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error?.message) return payload.error.message;
    if (typeof payload.message === 'string') return payload.message;
    try {
        return JSON.stringify(payload);
    } catch {
        return err?.message || 'Request failed';
    }
}

// Helper for masking password input
function questionHidden(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Hide password typing
        const onData = (char) => {
            char = char + '';
            switch (char) {
                case '\n': case '\r': case '\u0004':
                    process.stdin.pause();
                    break;
                default:
                    process.stdout.clearLine();
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(query + Array(rl.line.length + 1).join('*'));
                    break;
            }
        };
        process.stdin.on('data', onData);

        rl.question(query, (value) => {
            process.stdin.removeListener('data', onData);
            rl.close();
            resolve(value);
        });
    });
}

function question(query) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(query, (val) => {
            rl.close();
            resolve(val);
        });
    });
}

// Ensure auth token is attached to axios
function setupAxios() {
    const token = config.get('token');
    if (token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
}

program
    .name('codehub')
    .description('CLI tool for CodeHub - A GitHub Alternative')
    .version('1.0.0');

// ==================== SIGNUP ====================
program
    .command('signup')
    .description('Create a new CodeHub account')
    .action(async () => {
        console.log(chalk.blue.bold('Create a CodeHub Account 🚀'));
        const username = await question('Username: ');
        const full_name = await question('Full name (optional): ');
        const email = await question('Email: ');
        const password = await questionHidden('Password: ');
        console.log(''); // newline after password

        try {
            await axios.post(`${API_BASE}/auth/signup`, { username, full_name, email, password });
            console.log(chalk.green('✅ Account created successfully!'));
            console.log(chalk.cyan('Run `codehub login` to authenticate.'));
        } catch (err) {
            console.error(chalk.red('❌ Signup failed:'), getErrorMessage(err));
        }
    });

// ==================== LOGIN ====================
program
    .command('login')
    .description('Authenticate with CodeHub')
    .action(async () => {
        console.log(chalk.blue.bold('Welcome to CodeHub CLI! 🚀'));
        const username = await question('Username: ');
        const password = await questionHidden('Password: ');
        console.log(''); // newline after password

        try {
            const res = await axios.post(`${API_BASE}/auth/login`, { username, password });

            // Save token and user details mapping locally
            config.set('token', res.data.token);
            config.set('user', res.data.user);

            console.log(chalk.green('✅ Successfully logged in!'));
            console.log(chalk.gray(`Logged in as @${res.data.user.username}`));
        } catch (err) {
            console.error(chalk.red('❌ Login failed:'), getErrorMessage(err));
        }
    });

program
    .command('logout')
    .description('Sign out from CodeHub CLI')
    .action(async () => {
        setupAxios();
        const user = config.get('user');
        if (!user) {
            console.log(chalk.yellow('You are not logged in.'));
            return;
        }
        try {
            await axios.post(`${API_BASE}/auth/logout`);
        } catch (err) {
            console.log(chalk.yellow(`Logout request warning: ${getErrorMessage(err)}`));
        }
        config.delete('token');
        config.delete('user');
        console.log(chalk.green('✅ Logged out.'));
    });

// ==================== INIT ====================
program
    .command('init')
    .description('Create a new CodeHub repo and initialize locally')
    .argument('<repo_name>', 'Name of the repository')
    .option('-d, --description <desc>', 'Repository description', '')
    .option('-p, --private', 'Make the repository private')
    .action(async (repo_name, options) => {
        setupAxios();
        const user = config.get('user');
        if (!user) {
            return console.log(chalk.red('❌ You must be logged in. Run `codehub login` first.'));
        }

        try {
            console.log(chalk.blue(`Creating repository '${repo_name}' on CodeHub...`));
            const visibility = options.private ? 'private' : 'public';

            const res = await axios.post(`${API_BASE}/repos`, {
                owner_id: user.user_id,
                repo_name,
                description: options.description,
                visibility,
                language: 'JavaScript' // default for now
            });

            console.log(chalk.green('✅ Repository created on server!'));

            // Initialize local codehub tracking folder
            if (!fs.existsSync('.codehub')) {
                fs.mkdirSync('.codehub');
            }
            fs.writeFileSync('.codehub/config.json', JSON.stringify({
                repo_id: res.data.repo_id,
                owner: user.username,
                repo_name: repo_name
            }, null, 2));

            console.log(chalk.yellow('Initialized empty CodeHub repository locally.'));

            console.log(chalk.green('\n🎉 Done! Next steps:'));
            console.log(chalk.cyan('  1. Create some files'));
            console.log(chalk.cyan('  2. Run `codehub commit "Initial commit"` to push them to the server'));

        } catch (err) {
            console.error(chalk.red('❌ Failed to create repo:'), getErrorMessage(err));
        }
    });

// ==================== CLONE ====================
program
    .command('clone')
    .description('Clone a CodeHub repository')
    .argument('<owner_repo>', 'The owner and repo name (e.g., torvalds/linux)')
    .action(async (owner_repo) => {
        setupAxios();
        const [owner, repo] = owner_repo.split('/');
        if (!owner || !repo) {
            return console.log(chalk.red('❌ Please provide repository in format: owner/repo'));
        }

        console.log(chalk.blue(`Cloning ${owner_repo} via CodeHub API...`));

        try {
            const safeOwner = encodeURIComponent(owner);
            const safeRepo = encodeURIComponent(repo);
            const res = await axios.get(`${API_BASE}/git/pull/${safeOwner}/${safeRepo}`);

            // Create folder
            if (!fs.existsSync(repo)) {
                fs.mkdirSync(repo);
            } else if (fs.readdirSync(repo).length > 0) {
                return console.log(chalk.red(`❌ Target directory '${repo}' is not empty.`));
            }

            // Write files
            for (const file of res.data.files) {
                const filePath = path.join(repo, file[1]); // file_path
                const content = file[2]; // content

                // ensure subdirectories exist
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(filePath, content || '');
            }

            // Create .codehub
            if (!fs.existsSync(path.join(repo, '.codehub'))) {
                fs.mkdirSync(path.join(repo, '.codehub'));
            }
            fs.writeFileSync(path.join(repo, '.codehub/config.json'), JSON.stringify({
                owner: owner,
                repo_name: repo
            }, null, 2));

            console.log(chalk.green(`✅ Cloned successfully into '${repo}' directory!`));
            console.log(chalk.gray(`Downloaded ${res.data.files.length} files.`));
        } catch (err) {
            console.error(chalk.red('❌ Clone failed:'), getErrorMessage(err));
        }
    });

// ==================== COMMIT (PUSH) ====================
program
    .command('commit')
    .description('Commit and push all local files to the CodeHub server')
    .argument('<message>', 'Commit message')
    .action(async (message) => {
        setupAxios();
        const user = config.get('user');
        if (!user) {
            return console.log(chalk.red('❌ You must be logged in. Run `codehub login` first.'));
        }

        if (!fs.existsSync('.codehub/config.json')) {
            return console.log(chalk.red('❌ Not a CodeHub repository. Run `codehub init` first.'));
        }

        const repoConfig = JSON.parse(fs.readFileSync('.codehub/config.json'));
        console.log(chalk.blue(`Packaging files for commit to ${repoConfig.owner}/${repoConfig.repo_name}...`));

        // Read all files recursively
        const getAllFiles = (dir, fileList = []) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                if (file === '.codehub' || file === 'node_modules' || file === '.git') continue;

                if (fs.statSync(filePath).isDirectory()) {
                    getAllFiles(filePath, fileList);
                } else {
                    fileList.push(filePath);
                }
            }
            return fileList;
        };

        const filePaths = getAllFiles('.');
        const filesPayload = filePaths.map(f => {
            const relativePath = path.relative('.', f);
            return {
                file_name: path.basename(f),
                file_path: relativePath,
                content: fs.readFileSync(f, 'utf-8'),
                file_type: 'text'
            };
        });

        if (filesPayload.length === 0) {
            return console.log(chalk.yellow('No files found to commit.'));
        }

        try {
            // We need repo_id for the commit push API
            // Let's get it by fetching repo details if we don't have it
            let repoId = repoConfig.repo_id;
            if (!repoId) {
                const repoRes = await axios.get(`${API_BASE}/repos/${repoConfig.owner}/${repoConfig.repo_name}`);
                repoId = repoRes.data.data[0]; // repo_id
            }

            const payload = {
                repo_id: repoId,
                author_id: user.user_id,
                message: message,
                files: filesPayload,
                branch_name: 'main'
            };

            const res = await axios.post(`${API_BASE}/git/commit`, payload);
            console.log(chalk.green(`✅ Commit pushed! Hash: ${res.data.commit_hash}`));
            console.log(chalk.gray(`Changes: ${res.data.additions} additions, ${res.data.deletions} deletions across ${filesPayload.length} files.`));

        } catch (err) {
            console.error(chalk.red('❌ Commit failed:'), getErrorMessage(err));
        }
    });

// ==================== ISSUES ====================
const issuesCmd = program.command('issues').description('Manage repository issues');

issuesCmd
    .command('list')
    .description('List open issues for a repository')
    .argument('<owner_repo>', 'The owner and repo name (e.g., torvalds/linux)')
    .action(async (owner_repo) => {
        setupAxios();
        const [owner, repo] = owner_repo.split('/');
        if (!owner || !repo) {
            return console.log(chalk.red('❌ Please provide repository in format: owner/repo'));
        }

        try {
            const res = await axios.get(`${API_BASE}/issues/${owner}/${repo}`);
            const issues = res.data;

            console.log(chalk.blue.bold(`\n📝 Open Issues for ${owner}/${repo}\n`));

            if (issues.length === 0) {
                console.log(chalk.gray('No open issues.'));
                return;
            }

            issues.forEach(issue => {
                const status = issue[4] === 'open' ? chalk.green('🟢 Open') : chalk.red('🔴 Closed');
                console.log(`${chalk.cyan(`#${issue[1]}`)} ${chalk.bold(issue[2])} ${chalk.gray(`(by @${issue[7]})`)}`);
                console.log(`   Status: ${status}`);
                console.log('');
            });
        } catch (err) {
            console.error(chalk.red('❌ Failed to fetch issues:'), getErrorMessage(err));
        }
    });

program.parse(process.argv);
