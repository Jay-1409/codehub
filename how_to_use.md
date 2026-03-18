# CodeHub - Comprehensive User Manual

Welcome to CodeHub! CodeHub is a complete version control and repository management platform. This manual provides a complete guide from a user's perspective on how to use both the **CodeHub CLI** (Command Line Interface) and the **CodeHub Web Interface**.

---

## Part 1: CodeHub CLI Guide

The CodeHub CLI allows you to interact with your repositories, push code, and manage issues directly from your terminal.

### 1. Installation

You can install the CLI directly from npm (recommended):

```bash
npm install -g @jay_shah/codehub-cli
```

If you have downloaded the project source code and want to install from local files, use:

```bash
# Navigate to the cli folder inside the project
cd cli

# Install the CLI tool globally
npm install -g .
```

Once installed, you can verify it by running:
```bash
codehub --version
```

### 1.1 Publishing the CLI to npm (Maintainers)

If you are publishing a new CLI release:

```bash
cd cli
npm version patch
npm publish
```

If your npm account requires one-time verification, npm will prompt for OTP during publish.

### 2. Configuration & Environment

By default, the CLI attempts to connect to the local server at `http://localhost:5080/api`. 
If your CodeHub backend is hosted elsewhere (or on a different port), you must set the `CODEHUB_API_URL` environment variable before running commands:

**Linux/macOS:**
```bash
export CODEHUB_API_URL="http://your-server-url.com/api"
```
**Windows (PowerShell):**
```powershell
$env:CODEHUB_API_URL="http://your-server-url.com/api"
```

To avoid setting environment variables every time, users can save the endpoint once in CLI config:

```bash
codehub set-api https://your-server-url.com
codehub show-api
```

`set-api` automatically normalizes the URL to include `/api`.

### 3. Authentication

Before creating or modifying repositories, you need to authenticate.

*   **Sign Up:** Create a new account directly from the terminal.
    ```bash
    codehub signup
    ```
    *You will be prompted to enter a Username, Full Name, Email, and Password.*

*   **Log In:** Authenticate your session. Your credentials will be saved securely on your local machine.
    ```bash
    codehub login
    ```

*   **Log Out:** Clear your local session.
    ```bash
    codehub logout
    ```

### 4. Managing Repositories

*   **Initialize a New Repository (`init`)**
    Creates a new repository on the CodeHub server and initializes the tracking folder (`.codehub`) in your current local directory.
    ```bash
    # Basic creation
    codehub init my-new-repo

    # Create with a description and make it private
    codehub init my-private-repo -d "My secret project" -p
    ```
    *Note: Ensure you are inside the folder you want to track before running this command.*

*   **Clone an Existing Repository (`clone`)**
    Downloads an existing repository from the CodeHub server to your local machine.
    ```bash
    # Format: codehub clone <username>/<repository_name>
    codehub clone torvalds/linux
    ```

*   **Pushing Code (`commit`)**
    CodeHub CLI simplifies the workflow. The `commit` command automatically packages all files in your current directory (excluding `node_modules`, `.git`, and `.codehub`) and pushes them directly to the server in one step.
    ```bash
    codehub commit "Initial commit with project setup"
    ```

### 5. Managing Issues

You can view open issues for any repository directly from the terminal.
```bash
codehub issues list <username>/<repository_name>

# Example:
codehub issues list johndoe/my-project
```

---

## Part 2: CodeHub Web Interface Guide

The CodeHub website provides a rich graphical interface to browse code, manage repository settings, and collaborate with others.

### 1. Getting Started

1.  **Open the Application:** Navigate to the URL where CodeHub is hosted (e.g., `http://localhost:5080` if running locally).
2.  **Sign Up / Log In:** 
    *   Click the **Sign Up** button to create a new account if you haven't already done so via the CLI.
    *   If you already have an account, click **Log In** and enter your credentials.

### 2. Dashboard & Navigation

Once logged in, you will be taken to your Dashboard. Here you can:
*   See a feed of recent activities.
*   Quickly access your personal repositories.
*   Use the top search bar to find users or other public repositories.

### 3. Creating & Setting Up a Repository via the Web

If you prefer to create repositories via the UI rather than the CLI:
1.  Click the **New** or **+** button next to the repositories list on your dashboard.
2.  **Repository Name:** Choose a unique, memorable name (e.g., `react-dashboard`).
3.  **Description:** (Optional) Provide a brief explanation of what the project does.
4.  **Visibility:** 
    *   **Public:** Anyone on the internet can see this repository.
    *   **Private:** Only you (and specified collaborators) can see this repository.
5.  Click **Create Repository**.

*Once created, the page will display instructions on how to use the CLI to push your first files to this new repository.*

### 4. Browsing Code

When you navigate to a repository (e.g., `YourName/react-dashboard`), you will see the **Code** tab by default.
*   **File Explorer:** Click on folders to navigate the directory structure. Click on files to view their source code with syntax highlighting.
*   **Commits History:** Click on the commit history to see who made changes, when, and what files were affected.

### 5. Issues & Collaboration

The Web UI provides complete tools for issue tracking:
*   **Creating an Issue:** Go to the **Issues** tab of a repository and click **New Issue**. Provide a title and a detailed description of the bug or feature request.
*   **Commenting:** Open any existing issue to read the discussion or add your own comments.
*   **Closing Issues:** Repository owners can mark issues as resolved/closed.

### 6. Pull Requests & Stars

*   **Stars:** If you find a repository interesting or useful, click the **Star** button at the top right of the repository page to save it to your starred list.
*   **Pull Requests (PRs):** If you fork a repository or work on a separate branch, you can open a Pull Request from the **Pull Requests** tab. This allows the repository owner to review your code before merging it into the main project.

---

**Tip:** The CLI and the Web Interface are fully synchronized. A repository created on the web will instantly be cloneable via the CLI, and code pushed via the CLI will immediately be visible on the web!