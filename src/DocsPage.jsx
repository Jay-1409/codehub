const tocItems = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "Quick Start" },
  { id: "cli-reference", label: "CLI Reference" },
  { id: "web-workflow", label: "Web Workflow" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "self-hosting", label: "Self-Hosting (Optional)" },
];

const quickStartSteps = [
  {
    title: "Install CLI",
    detail: "Install once globally from npm.",
    command: "npm install -g @jay_shah/codehub-cli",
  },
  {
    title: "Create account and log in",
    detail: "Authenticate your local session before repo operations.",
    command: "codehub signup\ncodehub login",
  },
  {
    title: "Create or clone repository",
    detail: "Start a new repository or clone an existing one.",
    command: "codehub init my-repo\n# or\ncodehub clone owner/repo",
  },
  {
    title: "Commit and push files",
    detail: "Push all local files tracked in your current folder.",
    command: 'codehub commit "Initial commit"',
  },
];

const cliCommands = [
  { name: "codehub signup", purpose: "Create a new user account." },
  { name: "codehub login", purpose: "Sign in and store auth token locally." },
  { name: "codehub logout", purpose: "Clear local CLI session." },
  {
    name: "codehub init <repo_name> [-d desc] [-p]",
    purpose: "Create repository on server and initialize .codehub locally.",
  },
  {
    name: "codehub clone <owner/repo>",
    purpose: "Clone a repository into a local directory.",
  },
  {
    name: 'codehub commit "message"',
    purpose: "Package local files and push as a commit.",
  },
  {
    name: "codehub issues list <owner/repo>",
    purpose: "View issues from terminal.",
  },
];

const webFlow = [
  "Sign up or log in from the authentication page.",
  "Create a repository from the New Repository section.",
  "Select a repository to access Overview, Commits, Branches, Issues, Pull Requests, and Files.",
  "Use Quick Actions for clone command copy, star/unstar, and delete operations.",
  "Use + Branch, + Issue, and + PR actions from the repository header.",
  "Use Search and owner/repo lookup to quickly open repositories.",
];

const troubleshooting = [
  {
    issue: "Authentication errors",
    fix: "Re-authenticate and retry the command.",
    command: "codehub login",
  },
  {
    issue: "Not a CodeHub repository",
    fix: "Initialize repository metadata in the folder first.",
    command: "codehub init my-repo",
  },
  {
    issue: "Clone target directory not empty",
    fix: "Clone into a new or empty directory.",
    command: "codehub clone owner/repo",
  },
];

const hostingScripts = [
  { name: "npm run dev", purpose: "Run API and frontend together." },
  { name: "npm run server", purpose: "Run Express API only." },
  { name: "npm run client", purpose: "Run Vite frontend only." },
  { name: "npm start", purpose: "Build frontend and start production server." },
  { name: "npm run build", purpose: "Build frontend into dist." },
  { name: "npm run preview", purpose: "Preview built frontend locally." },
];

const hostingEnvVars = [
  {
    key: "DB_USER",
    required: "Yes",
    description: "Oracle database username.",
    example: "DB_USER=system",
  },
  {
    key: "DB_PASSWORD",
    required: "Yes",
    description: "Oracle database password.",
    example: "DB_PASSWORD=your_password",
  },
  {
    key: "DB_CONNECTSTRING",
    required: "Yes",
    description: "Oracle connection string.",
    example: "DB_CONNECTSTRING=localhost:1521/XEPDB1",
  },
  {
    key: "PORT",
    required: "No",
    description: "Express app port. Defaults to 5080.",
    example: "PORT=5080",
  },
  {
    key: "JWT_SECRET",
    required: "Yes",
    description: "Secret for signing authentication tokens.",
    example: "JWT_SECRET=replace_with_a_long_random_secret",
  },
  {
    key: "GIT_PORT",
    required: "No",
    description: "Git service port used by backend integration.",
    example: "GIT_PORT=7001",
  },
  {
    key: "CORS_ORIGINS",
    required: "No",
    description: "Comma-separated allowed frontend origins.",
    example: "CORS_ORIGINS=http://localhost:5173,http://localhost:5080",
  },
];

const selfHostingTroubleshooting = [
  {
    issue: "CLI points to wrong API",
    fix: "Set CODEHUB_API_URL to your deployed server API endpoint.",
    command: "export CODEHUB_API_URL=https://your-server/api",
  },
];

function CommandBlock({ children }) {
  return (
    <pre className="docs-command-block">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage({ onClose }) {
  return (
    <section className="docs-page-pro">
      <header className="docs-pro-hero">
        <div className="docs-pro-hero-left">
          <p className="docs-pro-eyebrow">CodeHub Documentation</p>
          <h1>User Guide</h1>
          <p>
            This documentation is designed for end users first. You only need
            the CLI and your CodeHub account to work with repositories.
            Self-hosting details are included separately as an optional appendix.
          </p>
        </div>
        <div className="docs-pro-hero-right">
          {onClose && (
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Back to App
            </button>
          )}
        </div>
      </header>

      <div className="docs-pro-layout">
        <aside className="docs-pro-toc">
          <h2>Contents</h2>
          <nav aria-label="Documentation sections">
            {tocItems.map((item) => (
              <a key={item.id} href={`#${item.id}`} className="docs-pro-toc-link">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="docs-pro-callout">
            <strong>Note</strong>
            <p>
              Users do not need to run backend server scripts unless they are
              hosting CodeHub themselves.
            </p>
          </div>
        </aside>

        <main className="docs-pro-main">
          <section id="overview" className="docs-pro-section">
            <h2>Overview</h2>
            <p>
              CodeHub provides repository collaboration through a CLI and web
              interface. Most daily tasks are done with the CLI: create repos,
              clone, commit, and track issues.
            </p>
            <ul className="docs-pro-bullet-list">
              <li>Install CLI once.</li>
              <li>Authenticate once per machine/session as needed.</li>
              <li>Manage repositories from terminal and web dashboard.</li>
              <li>Use the web app for visual browsing and collaboration.</li>
            </ul>
          </section>

          <section id="quick-start" className="docs-pro-section">
            <h2>Quick Start</h2>
            <div className="docs-pro-steps">
              {quickStartSteps.map((step, idx) => (
                <article key={step.title} className="docs-pro-step-card">
                  <p className="docs-pro-step-index">Step {idx + 1}</p>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                  <CommandBlock>{step.command}</CommandBlock>
                </article>
              ))}
            </div>
          </section>

          <section id="cli-reference" className="docs-pro-section">
            <h2>CLI Reference</h2>
            <p>
              Install globally from npm:
            </p>
            <CommandBlock>npm install -g @jay_shah/codehub-cli</CommandBlock>
            <p>
              Local development install from source:
            </p>
            <CommandBlock>cd cli && npm install -g .</CommandBlock>
            <div className="docs-pro-table-wrap">
              <table className="docs-pro-table">
                <thead>
                  <tr>
                    <th>Command</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {cliCommands.map((cmd) => (
                    <tr key={cmd.name}>
                      <td>
                        <code>{cmd.name}</code>
                      </td>
                      <td>{cmd.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="web-workflow" className="docs-pro-section">
            <h2>Web Workflow</h2>
            <ul className="docs-pro-checklist">
              {webFlow.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section id="troubleshooting" className="docs-pro-section">
            <h2>Troubleshooting</h2>
            <div className="docs-pro-troubleshoot-grid">
              {troubleshooting.map((item) => (
                <article key={item.issue} className="docs-pro-troubleshoot-card">
                  <h3>{item.issue}</h3>
                  <p>{item.fix}</p>
                  <CommandBlock>{item.command}</CommandBlock>
                </article>
              ))}
            </div>
          </section>

          <section id="self-hosting" className="docs-pro-section">
            <h2>Self-Hosting (Optional)</h2>
            <p>
              This section is for admins/developers running their own CodeHub
              server. End users can skip this.
            </p>
            <h3>Server Scripts</h3>
            <div className="docs-pro-table-wrap">
              <table className="docs-pro-table">
                <thead>
                  <tr>
                    <th>Script</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {hostingScripts.map((script) => (
                    <tr key={script.name}>
                      <td>
                        <code>{script.name}</code>
                      </td>
                      <td>{script.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Environment Variables</h3>
            <div className="docs-pro-table-wrap">
              <table className="docs-pro-table docs-pro-table-wide">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Required</th>
                    <th>Description</th>
                    <th>Example</th>
                  </tr>
                </thead>
                <tbody>
                  {hostingEnvVars.map((env) => (
                    <tr key={env.key}>
                      <td>
                        <code>{env.key}</code>
                      </td>
                      <td>{env.required}</td>
                      <td>{env.description}</td>
                      <td>
                        <code>{env.example}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Self-Hosting Troubleshooting</h3>
            <div className="docs-pro-troubleshoot-grid">
              {selfHostingTroubleshooting.map((item) => (
                <article key={item.issue} className="docs-pro-troubleshoot-card">
                  <h3>{item.issue}</h3>
                  <p>{item.fix}</p>
                  <CommandBlock>{item.command}</CommandBlock>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </section>
  );
}
