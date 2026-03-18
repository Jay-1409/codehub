# CodeHub (DBMS Project)

React frontend + existing backend APIs.

## Run

```bash
npm install
cp .env.example .env
npm start
```

Open: `http://localhost:5080` (or your `PORT` from `.env`)

## Dev Mode

```bash
npm run dev
```

- React dev server: `http://localhost:5173`
- API server: `http://localhost:5080`

## CLI Installation

Install the published CLI package:

```bash
npm install -g @jay_shah/codehub-cli
```

Local development install from source:

```bash
cd cli
npm install -g .
```

## Frontend Features

- Login and signup
- User profile view
- User repositories list
- No public-repository listing in UI
- Search my repositories
- Open any repository directly by `owner/repo`
- Repository detail view:
  - branches
  - commits
  - issues
  - pull requests
  - file tree
- Create repository
- Star / unstar repository
- Clone command copy (`codehub clone owner/repo`)
- Fork repository with custom fork name and auto-rename option
- Create and delete branches
- Switch default branch
- Create issues + close/reopen issues
- Issue comments
- Create pull requests + merge/close pull requests
- README markdown preview
- Global repository search (across accessible repos)

## Security + Access

- JWT auth with logout + tracked sessions
- Auth guards on mutating routes
- Role-based repository access (owner / collaborator / public reader)
- Consistent API error format (`{ ok: false, error: { code, message } }`)

## DB Migration

Run the migration once on existing databases:

```sql
@querys/migrations/20260316_security_and_features.sql
```
