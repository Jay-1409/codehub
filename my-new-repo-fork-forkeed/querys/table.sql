-- =============================================
-- CodeHub Database Schema
-- Run in SQL*Plus as: codeHubDb/1234@//localhost:1521/XEPDB1
-- =============================================

-- 1. Users
CREATE TABLE users (
    user_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      VARCHAR2(50) UNIQUE NOT NULL,
    full_name     VARCHAR2(100),
    email         VARCHAR2(100) UNIQUE,
    password_hash VARCHAR2(256) NOT NULL,
    avatar_url    VARCHAR2(255),
    bio           VARCHAR2(500),
    location      VARCHAR2(100),
    public_repos  NUMBER DEFAULT 0,
    followers_count NUMBER DEFAULT 0,
    following_count NUMBER DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Repositories
CREATE TABLE repositories (
    repo_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id       NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    repo_name      VARCHAR2(100) NOT NULL,
    description    VARCHAR2(500),
    visibility     VARCHAR2(10) DEFAULT 'public',
    default_branch VARCHAR2(50) DEFAULT 'main',
    language       VARCHAR2(50),
    stars_count    NUMBER DEFAULT 0,
    forks_count    NUMBER DEFAULT 0,
    open_issues_count NUMBER DEFAULT 0,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_id, repo_name)
);

-- 3. Branches
CREATE TABLE branches (
    branch_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id     NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    branch_name VARCHAR2(100) NOT NULL,
    is_default  NUMBER(1) DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, branch_name)
);

-- 4. Commits
CREATE TABLE commits (
    commit_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id     NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    author_id   NUMBER REFERENCES users(user_id),
    commit_hash VARCHAR2(256) UNIQUE NOT NULL,
    message     VARCHAR2(500) NOT NULL,
    additions   NUMBER DEFAULT 0,
    deletions   NUMBER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Issues
CREATE TABLE issues (
    issue_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id      NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    author_id    NUMBER REFERENCES users(user_id),
    issue_number NUMBER NOT NULL,
    title        VARCHAR2(300) NOT NULL,
    body         CLOB,
    status       VARCHAR2(20) DEFAULT 'open',
    label        VARCHAR2(50),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at    TIMESTAMP,
    UNIQUE (repo_id, issue_number)
);

-- 6. Pull Requests
CREATE TABLE pull_requests (
    pr_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id       NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    author_id     NUMBER REFERENCES users(user_id),
    pr_number     NUMBER NOT NULL,
    title         VARCHAR2(300) NOT NULL,
    body          CLOB,
    status        VARCHAR2(20) DEFAULT 'open',
    source_branch VARCHAR2(100),
    target_branch VARCHAR2(100),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    merged_at     TIMESTAMP,
    UNIQUE (repo_id, pr_number)
);

-- 7. Stars
CREATE TABLE stars (
    star_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    repo_id    NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, repo_id)
);

-- 8. Forks
CREATE TABLE forks (
    fork_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    original_repo_id NUMBER REFERENCES repositories(repo_id),
    forked_repo_id   NUMBER REFERENCES repositories(repo_id),
    user_id          NUMBER REFERENCES users(user_id),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Followers
CREATE TABLE followers (
    follow_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    follower_id  NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    following_id NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (follower_id, following_id)
);

-- 10. Repo Files
CREATE TABLE repo_files (
    file_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id       NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    branch_id     NUMBER REFERENCES branches(branch_id),
    file_name     VARCHAR2(255) NOT NULL,
    file_path     VARCHAR2(1000) NOT NULL,
    content       CLOB,
    file_type     VARCHAR2(50),
    file_size     NUMBER DEFAULT 0,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
