-- Migration: 20260316_security_and_features
-- Adds security and feature tables/constraints for sessions, collaborators, issue comments and commit diffs.

BEGIN
    EXECUTE IMMEDIATE q'[
        ALTER TABLE repositories
        ADD CONSTRAINT chk_repositories_visibility CHECK (visibility IN ('public', 'private'))
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -2260 AND SQLCODE != -2275 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        ALTER TABLE issues
        ADD CONSTRAINT chk_issues_status CHECK (status IN ('open', 'closed'))
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -2260 AND SQLCODE != -2275 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        ALTER TABLE pull_requests
        ADD CONSTRAINT chk_pull_requests_status CHECK (status IN ('open', 'closed', 'merged'))
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -2260 AND SQLCODE != -2275 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        CREATE TABLE issue_comments (
            comment_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            issue_id      NUMBER REFERENCES issues(issue_id) ON DELETE CASCADE,
            author_id     NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
            body          CLOB NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        CREATE TABLE repository_collaborators (
            collaborator_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            repo_id         NUMBER REFERENCES repositories(repo_id) ON DELETE CASCADE,
            user_id         NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
            role            VARCHAR2(20) DEFAULT 'write',
            added_by        NUMBER REFERENCES users(user_id),
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (repo_id, user_id)
        )
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        ALTER TABLE repository_collaborators
        ADD CONSTRAINT chk_repo_collaborators_role CHECK (role IN ('read', 'write', 'admin'))
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -2260 AND SQLCODE != -2275 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        CREATE TABLE user_sessions (
            session_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            user_id       NUMBER REFERENCES users(user_id) ON DELETE CASCADE,
            jti           VARCHAR2(128) NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at    TIMESTAMP NOT NULL,
            revoked_at    TIMESTAMP,
            UNIQUE (user_id, jti)
        )
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        CREATE TABLE commit_files (
            commit_file_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            commit_id      NUMBER REFERENCES commits(commit_id) ON DELETE CASCADE,
            file_path      VARCHAR2(1000) NOT NULL,
            change_type    VARCHAR2(20) DEFAULT 'modified',
            additions      NUMBER DEFAULT 0,
            deletions      NUMBER DEFAULT 0
        )
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -955 THEN RAISE; END IF;
END;
/

BEGIN
    EXECUTE IMMEDIATE q'[
        ALTER TABLE commit_files
        ADD CONSTRAINT chk_commit_files_change_type CHECK (change_type IN ('added', 'modified', 'deleted'))
    ]';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE != -2260 AND SQLCODE != -2275 THEN RAISE; END IF;
END;
/

COMMIT;
