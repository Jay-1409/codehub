-- =============================================
-- CodeHub Database Schema
-- Run in SQL*Plus using your local DB credentials and connect string.
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
-- FIX: Enforce repository visibility values to prevent invalid permission states.
ALTER TABLE repositories
ADD CONSTRAINT chk_repositories_visibility CHECK (visibility IN ('public', 'private'));

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
-- FIX: Enforce valid issue status values for consistent open/close behavior.
ALTER TABLE issues
ADD CONSTRAINT chk_issues_status CHECK (status IN ('open', 'closed'));

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
-- FIX: Enforce valid pull-request status values for consistent workflow.
ALTER TABLE pull_requests
ADD CONSTRAINT chk_pull_requests_status CHECK (status IN ('open', 'closed', 'merged'));

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

-- 11. Issue Comments
CREATE TABLE issue_comments (
    comment_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    issue_id      NUMBER REFERENCES issues(issue_id) ON DELETE CASCADE,
    author_id     NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    body          CLOB NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Repository Collaborators
CREATE TABLE repository_collaborators (
    collaborator_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id         NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
    user_id         NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    role            VARCHAR2(20) DEFAULT 'write',
    added_by        NUMBER REFERENCES users(user_id),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (repo_id, user_id)
);
-- FIX: Enforce collaborator role values for role-based repository access.
ALTER TABLE repository_collaborators
ADD CONSTRAINT chk_repo_collaborators_role CHECK (role IN ('read', 'write', 'admin'));

-- 13. User Sessions (JWT session tracking for logout/session invalidation)
CREATE TABLE user_sessions (
    session_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
    jti           VARCHAR2(128) NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP NOT NULL,
    revoked_at    TIMESTAMP,
    UNIQUE (user_id, jti)
);

-- 14. Commit File Changes (for commit diff summaries)
CREATE TABLE commit_files (
    commit_file_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    commit_id      NUMBER REFERENCES commits(commit_id) ON DELETE CASCADE,
    file_path      VARCHAR2(1000) NOT NULL,
    change_type    VARCHAR2(20) DEFAULT 'modified',
    additions      NUMBER DEFAULT 0,
    deletions      NUMBER DEFAULT 0
);
-- FIX: Enforce valid commit file change types for stable diff rendering.
ALTER TABLE commit_files
ADD CONSTRAINT chk_commit_files_change_type CHECK (change_type IN ('added', 'modified', 'deleted'));

COMMIT;
