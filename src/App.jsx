import { useState, useEffect, useMemo } from "react";
import "./styles.css";

/* ─────────────────────────────────────────────
   Constants & Pure Helpers
───────────────────────────────────────────── */
const STORAGE_TOKEN = "codehub_token";
const STORAGE_USER = "codehub_user";

function mapUserProfile(row) {
  if (!Array.isArray(row)) return row;
  return {
    userId: row[0],
    username: row[1],
    fullName: row[2],
    email: row[3],
    avatarUrl: row[4],
    bio: row[5],
    location: row[6],
    publicRepos: row[7],
    followers: row[8],
    following: row[9],
    createdAt: row[10],
  };
}

function mapOwnRepoRow(row, ownerFallback) {
  if (!Array.isArray(row)) return row;
  return {
    repoId: row[0],
    repoName: row[1],
    description: row[2],
    language: row[3],
    stars: row[4],
    forks: row[5],
    visibility: row[6],
    createdAt: row[7],
    owner: ownerFallback || "",
  };
}

function mapStarredRepoRow(row) {
  if (!Array.isArray(row)) return row;
  return {
    repoId: row[0],
    repoName: row[1],
    description: row[2],
    language: row[3],
    stars: row[4],
    owner: row[5],
  };
}

function mapSearchRepoRow(row) {
  if (!Array.isArray(row)) return row;
  return {
    repoId: row[0],
    repoName: row[1],
    description: row[2],
    language: row[3],
    stars: row[4],
    forks: row[5],
    visibility: row[6],
    createdAt: row[7],
    owner: row[8],
  };
}

function mapRepoDetail(row) {
  if (!Array.isArray(row)) return row;
  return {
    repoId: row[0],
    repoName: row[1],
    description: row[2],
    language: row[3],
    visibility: row[4],
    defaultBranch: row[5],
    stars: row[6],
    forks: row[7],
    openIssues: row[8],
    createdAt: row[9],
    updatedAt: row[10],
    owner: row[11],
    avatarUrl: row[12],
  };
}

function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdownLite(markdownText) {
  const src = escapeHtml(markdownText);
  const lines = src.split("\n");
  const out = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push("<br/>");
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      const lvl = headingMatch[1].length;
      out.push(`<h${lvl}>${headingMatch[2]}</h${lvl}>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${line.slice(2)}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${line}</p>`);
  }
  if (inList) out.push("</ul>");
  return out
    .join("\n")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
}

function parseOwnerRepo(text) {
  const t = (text || "").trim();
  const idx = t.indexOf("/");
  if (idx < 1 || idx === t.length - 1) return null;
  return { owner: t.slice(0, idx), repo: t.slice(idx + 1) };
}

function normalizeRepoFilePath(filePath, fileName) {
  const raw = String(filePath || fileName || "")
    .trim()
    .replace(/\\/g, "/");
  if (!raw) return "";
  return raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function buildRepoFileTree(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const root = [];
  const foldersByPath = new Map();
  const seenFilePaths = new Set();

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const normalizedPath = normalizeRepoFilePath(row[2], row[1]);
    if (!normalizedPath || seenFilePaths.has(normalizedPath)) continue;
    seenFilePaths.add(normalizedPath);

    const segments = normalizedPath.split("/");
    let cursor = root;
    let runningPath = "";

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      runningPath = runningPath ? `${runningPath}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;

      if (isLeaf) {
        cursor.push({
          type: "file",
          name: segment,
          path: normalizedPath,
          row,
        });
        break;
      }

      let folder = foldersByPath.get(runningPath);
      if (!folder) {
        folder = {
          type: "folder",
          name: segment,
          path: runningPath,
          children: [],
        };
        foldersByPath.set(runningPath, folder);
        cursor.push(folder);
      }
      cursor = folder.children;
    }
  }

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  function sortNodes(nodes) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
    nodes.forEach((node) => {
      if (node.type === "folder") sortNodes(node.children);
    });
    return nodes;
  }

  return sortNodes(root);
}

function getIssueLabelClass(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("bug")) return "bug";
  if (l.includes("feat")) return "feature";
  if (l.includes("doc")) return "docs";
  return "default";
}

/* ─────────────────────────────────────────────
   File Viewer Modal
───────────────────────────────────────────── */
function FileViewerModal({ file, onClose }) {
  if (!file) return null;

  const lines = (file.content || "").split("\n");

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-file-icon">{getFileIcon(file.name)}</span>
            <div>
              <div className="modal-filename">{file.name}</div>
              <div className="modal-filepath">{file.path}</div>
            </div>
          </div>
          <div className="modal-header-right">
            {file.fileType && (
              <span className="modal-meta">{file.fileType}</span>
            )}
            {file.size && <span className="modal-meta">{file.size} bytes</span>}
            {file.updatedAt && (
              <span className="modal-meta">{file.updatedAt}</span>
            )}
            <button
              className="modal-close-btn"
              onClick={onClose}
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="modal-body">
          {!file.content ? (
            <div className="modal-empty">
              No content available for this file.
            </div>
          ) : (
            <div className="code-viewer">
              <div className="code-line-numbers">
                {lines.map((_, i) => (
                  <span key={i} className="line-number">
                    {i + 1}
                  </span>
                ))}
              </div>
              <pre className="code-content">
                <code>{file.content}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getFileIcon(name) {
  if (!name || typeof name !== "string") return "📄";
  const ext = name.split(".").pop().toLowerCase();
  const map = {
    js: "🟨",
    jsx: "⚛️",
    ts: "🔷",
    tsx: "⚛️",
    py: "🐍",
    java: "☕",
    go: "🐹",
    rs: "🦀",
    html: "🌐",
    css: "🎨",
    json: "{ }",
    md: "📝",
    sh: "⚙️",
    sql: "🗄️",
    yml: "⚙️",
    yaml: "⚙️",
  };
  return map[ext] || "📄";
}

/* ─────────────────────────────────────────────
   Sub-Components
───────────────────────────────────────────── */

/* Logo SVG */
function LogoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

/* Empty state */
function EmptyState({ icon = "📭", message = "Nothing here yet." }) {
  return (
    <div className="empty-list">
      <span className="empty-list-icon">{icon}</span>
      <span>{message}</span>
    </div>
  );
}

/* Repo list item */
function RepoListItem({ repo, selected, onSelect }) {
  const isActive = selected && String(selected.repoId) === String(repo.repoId);
  return (
    <li>
      <button
        className={`repo-item ${isActive ? "active" : ""}`}
        onClick={() =>
          onSelect(repo.owner || repo.repoName, repo.repoName, repo.repoId)
        }
        title={`${repo.owner ? repo.owner + "/" : ""}${repo.repoName}`}
      >
        <span className="repo-item-name">
          {repo.owner ? `${repo.owner}/` : ""}
          {repo.repoName}
        </span>
        <span className="repo-item-meta">
          {repo.language && (
            <>
              <span className="repo-item-lang-dot" />
              {repo.language}
            </>
          )}
          {repo.stars > 0 && (
            <>
              <span>·</span>★ {repo.stars}
            </>
          )}
        </span>
      </button>
    </li>
  );
}

function RepoFileTreeNode({
  node,
  depth,
  onOpenFile,
  fileBusy,
  expandedFolders,
  onToggleFolder,
}) {
  const rowStyle = { "--tree-depth": depth };

  if (node.type === "folder") {
    const isExpanded = expandedFolders.has(node.path);
    return (
      <div className="repo-tree-node">
        <button
          type="button"
          className={`repo-tree-row repo-tree-folder ${isExpanded ? "expanded" : ""}`}
          style={rowStyle}
          onClick={() => onToggleFolder(node.path)}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${node.path}`}
          title={`${isExpanded ? "Collapse" : "Expand"} ${node.path}`}
        >
          <span className={`repo-tree-caret ${isExpanded ? "expanded" : ""}`}>
            ▶
          </span>
          <span className="file-icon">{isExpanded ? "📂" : "📁"}</span>
          <div className="repo-tree-main">
            <span className="repo-tree-name">{node.name}</span>
            <span className="repo-tree-sub">{node.path}/</span>
          </div>
        </button>
        {isExpanded &&
          node.children.map((child) => (
            <RepoFileTreeNode
              key={`${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              fileBusy={fileBusy}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
      </div>
    );
  }

  const f = node.row;
  const fileSizeLabel =
    f[4] === null || f[4] === undefined ? "—" : `${f[4]} bytes`;
  return (
    <button
      type="button"
      className="repo-tree-row repo-tree-file file-item-clickable"
      style={rowStyle}
      onClick={() => onOpenFile(f)}
      title={`View ${node.path}`}
    >
      <span className="file-icon">{getFileIcon(node.name)}</span>
      <div className="repo-tree-main">
        <span className="repo-tree-name">{node.name}</span>
        <span className="repo-tree-sub">
          {f[2]} · {f[3] || "text"}
        </span>
      </div>
      <div className="repo-tree-right">
        <span className="file-meta">
          {fileSizeLabel} · {formatDate(f[5])}
        </span>
        <span className="file-open-hint">{fileBusy ? "…" : "→"}</span>
      </div>
    </button>
  );
}

function RepoFileTree({ rows, onOpenFile, fileBusy }) {
  const nodes = useMemo(() => buildRepoFileTree(rows), [rows]);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());

  useEffect(() => {
    setExpandedFolders(new Set());
  }, [rows]);

  function handleToggleFolder(folderPath) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  if (!nodes.length) return null;
  return (
    <div className="repo-tree-list">
      {nodes.map((node) => (
        <RepoFileTreeNode
          key={`${node.type}:${node.path}`}
          node={node}
          depth={0}
          onOpenFile={onOpenFile}
          fileBusy={fileBusy}
          expandedFolders={expandedFolders}
          onToggleFolder={handleToggleFolder}
        />
      ))}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 7l5 5 5-5" />
    </svg>
  );
}

function SectionCard({ id, label, collapsed, onToggle, children }) {
  return (
    <div className={`section-card ${collapsed ? "collapsed" : ""}`} id={id}>
      <button
        type="button"
        className="section-tab"
        onClick={onToggle}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
        aria-expanded={!collapsed}
      >
        <div className="chevron-v">
          <ChevronIcon />
        </div>
        <span className="tab-label">{label}</span>
      </button>
      <div className="section-body-wrap">
        <div className="section-body">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main App
───────────────────────────────────────────── */
export default function App() {
  /* Theme state */
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem("theme") === "dark";
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDarkMode]);

  const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

  /* Auth state */
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  /* Profile & repo lists */
  const [profile, setProfile] = useState(null);
  const [myRepos, setMyRepos] = useState([]);
  const [starredRepos, setStarredRepos] = useState([]);

  /* Selected repo detail */
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repoBranches, setRepoBranches] = useState([]);
  const [repoCommits, setRepoCommits] = useState([]);
  const [repoIssues, setRepoIssues] = useState([]);
  const [repoPulls, setRepoPulls] = useState([]);
  const [repoFiles, setRepoFiles] = useState([]);
  const [repoReadme, setRepoReadme] = useState(null);
  const [issueComments, setIssueComments] = useState({});
  const [issueCommentDrafts, setIssueCommentDrafts] = useState({});
  const [issueCommentBusy, setIssueCommentBusy] = useState({});

  /* Active tab in detail panel */
  const [activeTab, setActiveTab] = useState("overview");

  /* Messages */
  const [authMsg, setAuthMsg] = useState({ text: "", type: "" });
  const [dashMsg, setDashMsg] = useState({ text: "", type: "" });

  /* Search/lookup */
  const [repoSearch, setRepoSearch] = useState("");
  const [repoLookup, setRepoLookup] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);

  /* Fork */
  const [forkName, setForkName] = useState("");
  const [autoRenameFork] = useState(true);
  const [forkBusy, setForkBusy] = useState(false);

  /* Clone copy feedback */
  const [copyFeedback, setCopyFeedback] = useState("");

  /* Star */
  const [starBusy, setStarBusy] = useState(false);

  /* Create repo */
  const [createBusy, setCreateBusy] = useState(false);

  /* Branch management */
  const [newBranchName, setNewBranchName] = useState("");
  const [branchSource, setBranchSource] = useState("main");
  const [branchBusy, setBranchBusy] = useState(false);

  /* Issue form */
  const [issueTitle, setIssueTitle] = useState("");
  const [issueBody, setIssueBody] = useState("");
  const [issueLabel, setIssueLabel] = useState("bug");
  const [issueBusy, setIssueBusy] = useState(false);

  /* PR form */
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prSource, setPrSource] = useState("main");
  const [prTarget, setPrTarget] = useState("main");
  const [prBusy, setPrBusy] = useState(false);

  /* File viewer modal */
  const [viewingFile, setViewingFile] = useState(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [actionModal, setActionModal] = useState("");

  /* Collapsible sidebar sections */
  const [collapsedSections, setCollapsedSections] = useState({
    "sc-profile": true,
    "sc-myrepos": true,
    "sc-starred": true,
    "sc-newrepo": true,
    "sc-quick": true,
  });

  /* ── Close file modal on Escape ── */
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (viewingFile) {
        setViewingFile(null);
        return;
      }
      if (actionModal) setActionModal("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingFile, actionModal]);

  /* ── Hydrate from localStorage ── */
  useEffect(() => {
    const storedToken = localStorage.getItem(STORAGE_TOKEN);
    const storedUser = localStorage.getItem(STORAGE_USER);
    if (!storedToken || !storedUser) return;
    try {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    } catch {
      localStorage.removeItem(STORAGE_TOKEN);
      localStorage.removeItem(STORAGE_USER);
    }
  }, []);

  useEffect(() => {
    if (user) refreshDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Sync fork name when repo changes */
  useEffect(() => {
    if (!selectedRepo) {
      setForkName("");
      setCopyFeedback("");
      return;
    }
    if (user && selectedRepo.owner !== user.username) {
      setForkName(`${selectedRepo.repoName}-fork`);
    } else {
      setForkName("");
    }
    setCopyFeedback("");
  }, [selectedRepo, user]);

  /* Sync branch selects */
  useEffect(() => {
    if (!repoBranches.length) return;
    const def =
      repoBranches.find((b) => Number(b[2]) === 1)?.[1] ||
      repoBranches[0][1] ||
      "main";
    if (!repoBranches.some((b) => b[1] === branchSource)) setBranchSource(def);
    if (!repoBranches.some((b) => b[1] === prSource)) setPrSource(def);
    if (!repoBranches.some((b) => b[1] === prTarget)) setPrTarget(def);
  }, [repoBranches, branchSource, prSource, prTarget]);

  /* ── Derived ── */
  const showDashboard = Boolean(user);

  const filteredMyRepos = useMemo(() => {
    const q = repoSearch.trim().toLowerCase();
    if (!q) return myRepos;
    return myRepos.filter((r) =>
      `${r.owner}/${r.repoName}`.toLowerCase().includes(q),
    );
  }, [myRepos, repoSearch]);

  const shownMyRepos = useMemo(() => {
    if (globalSearchResults.length) return globalSearchResults;
    return filteredMyRepos;
  }, [globalSearchResults, filteredMyRepos]);

  const branchNames = useMemo(
    () => repoBranches.map((b) => b[1]),
    [repoBranches],
  );

  const canFork = useMemo(() => {
    if (!selectedRepo || !user) return false;
    return selectedRepo.owner !== user.username;
  }, [selectedRepo, user]);

  const cloneCommand = useMemo(() => {
    if (!selectedRepo) return "";
    return `codehub clone ${selectedRepo.owner}/${selectedRepo.repoName}`;
  }, [selectedRepo]);

  const isStarred = useMemo(() => {
    if (!selectedRepo) return false;
    return starredRepos.some(
      (r) => Number(r.repoId) === Number(selectedRepo.repoId),
    );
  }, [selectedRepo, starredRepos]);

  /* ── API helper ── */
  async function api(path, options = {}) {
    const opts = { ...options };
    opts.headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, opts);
    const text = await res.text();
    const data = safeParseJson(text);
    if (!res.ok) {
      // FIX: Handle both legacy string errors and new structured `{ error: { message } }` responses.
      const errorMessage =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        data?.message ||
        `Request failed (${res.status})`;
      throw new Error(errorMessage);
    }
    return data;
  }

  /* ── Message helpers ── */
  function setAuthStatus(text, type = "") {
    setAuthMsg({ text, type });
  }
  function setDashStatus(text, type = "") {
    setDashMsg({ text, type });
  }

  function toggleSection(sectionId) {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }

  function openActionModal(type) {
    if (!selectedRepo) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    setActionModal(type);
  }

  function closeActionModal() {
    setActionModal("");
  }

  /* ── Auth handlers ── */
  async function handleLogin(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setAuthStatus("Signing in…", "info");
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: String(fd.get("username") || "").trim(),
          password: String(fd.get("password") || "").trim(),
        }),
      });
      localStorage.setItem(STORAGE_TOKEN, data.token);
      localStorage.setItem(STORAGE_USER, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setAuthStatus("", "");
      setDashStatus("Welcome back, " + data.user.username + "!", "success");
      e.currentTarget.reset();
    } catch (err) {
      setAuthStatus(err.message, "error");
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setAuthStatus("Creating account…", "info");
    try {
      await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          username: String(fd.get("username") || "").trim(),
          full_name: String(fd.get("full_name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          password: String(fd.get("password") || "").trim(),
        }),
      });
      setAuthStatus("Account created! You can now log in.", "success");
      e.currentTarget.reset();
    } catch (err) {
      setAuthStatus(err.message, "error");
    }
  }

  /* ── Dashboard / Data ── */
  function resetRepoDetails() {
    setSelectedRepo(null);
    setRepoBranches([]);
    setRepoCommits([]);
    setRepoIssues([]);
    setRepoPulls([]);
    setRepoFiles([]);
    setRepoReadme(null);
    setIssueComments({});
    setIssueCommentDrafts({});
    setIssueCommentBusy({});
    setActiveTab("overview");
  }

  async function handleLogout() {
    try {
      if (token) await api("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore logout endpoint failure and still clear local session
    }
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
    setToken(null);
    setUser(null);
    setProfile(null);
    setMyRepos([]);
    setStarredRepos([]);
    setRepoSearch("");
    setRepoLookup("");
    setGlobalSearchResults([]);
    resetRepoDetails();
    setAuthStatus("You've been logged out.", "info");
    setDashStatus("", "");
  }

  async function refreshDashboard() {
    if (!user) return;
    setDashStatus("Refreshing…", "info");
    try {
      const [profileRow, myRepoRows, starredRows] = await Promise.all([
        api(`/api/users/${encodeURIComponent(user.username)}`),
        api(`/api/users/${encodeURIComponent(user.username)}/repos`),
        api(`/api/stars/user/${user.user_id}`),
      ]);
      const nextProfile = mapUserProfile(profileRow);
      const nextMyRepos = (myRepoRows || []).map((r) =>
        mapOwnRepoRow(r, user.username),
      );
      const nextStarredRepos = (starredRows || []).map(mapStarredRepoRow);

      setProfile(nextProfile);
      setMyRepos(nextMyRepos);
      setStarredRepos(nextStarredRepos);
      setGlobalSearchResults([]);

      // Auto-select first repo
      const first =
        selectedRepo ||
        (nextMyRepos.length
          ? nextMyRepos[0]
          : nextStarredRepos.length
            ? nextStarredRepos[0]
            : null);
      if (first) {
        await selectRepo(first.owner, first.repoName, first.repoId);
      } else {
        resetRepoDetails();
      }
      setDashStatus("Up to date.", "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  async function selectRepo(owner, repoName, repoId) {
    setSelectedRepo({ owner, repoName, repoId });
    setActiveTab("overview");
    setDashStatus(`Loading ${owner}/${repoName}…`, "info");
    try {
      const detailRes = await api(
        `/api/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
      );
      const repo = mapRepoDetail(detailRes.data || detailRes);
      setSelectedRepo(repo);

      const [branches, commits, issues, pulls, files, readme] =
        await Promise.all([
          api(`/api/git/branches/${repo.repoId}`).catch(() => []),
          api(
            `/api/git/log/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}?limit=8`,
          ).catch(() => []),
          api(
            `/api/issues/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
          ).catch(() => []),
          api(
            `/api/pulls/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
          ).catch(() => []),
          api(
            `/api/git/tree/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
          ).catch(() => []),
          api(
            `/api/git/readme/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
          ).catch(() => null),
        ]);
      setRepoBranches(branches);
      setRepoCommits(commits);
      setRepoIssues(issues);
      setRepoPulls(pulls);
      setRepoFiles(files);
      // FIX: Load README once per repository selection so markdown preview is always in sync.
      setRepoReadme(readme?.content ? readme : null);
      setIssueComments({});
      setIssueCommentDrafts({});
      setIssueCommentBusy({});
      setDashStatus(`${owner}/${repoName} loaded.`, "success");
    } catch (err) {
      resetRepoDetails();
      setDashStatus(err.message, "error");
    }
  }

  async function handleOpenByOwnerRepo() {
    const parsed = parseOwnerRepo(repoLookup);
    if (!parsed) {
      setDashStatus("Use owner/repo format, e.g. jay/project-one", "error");
      return;
    }
    await selectRepo(parsed.owner, parsed.repo);
  }

  async function handleSearchRepositories() {
    const q = repoSearch.trim();
    if (q.length < 2) {
      setGlobalSearchResults([]);
      setDashStatus("Search query should be at least 2 characters.", "error");
      return;
    }
    setSearchBusy(true);
    try {
      const rows = await api(`/api/repos/search?q=${encodeURIComponent(q)}`);
      // FIX: Added repository search over all accessible repos (not just local sidebar list).
      setGlobalSearchResults((rows || []).map(mapSearchRepoRow));
      setDashStatus(`Found ${(rows || []).length} repositories.`, "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setSearchBusy(false);
    }
  }

  /* ── Create Repo ── */
  async function handleCreateRepo(e) {
    e.preventDefault();
    if (!user) {
      setDashStatus("Login required.", "error");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const repoName = String(fd.get("repo_name") || "").trim();
    if (!repoName) {
      setDashStatus("Repository name is required.", "error");
      return;
    }
    setCreateBusy(true);
    setDashStatus("Creating repository…", "info");
    try {
      await api("/api/repos", {
        method: "POST",
        body: JSON.stringify({
          owner_id: user.user_id,
          repo_name: repoName,
          description: String(fd.get("description") || "").trim(),
          language: String(fd.get("language") || "").trim(),
          visibility: "private",
        }),
      });
      e.currentTarget.reset();
      await refreshDashboard();
      await selectRepo(user.username, repoName, null);
      setDashStatus(`Repository "${repoName}" created.`, "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setCreateBusy(false);
    }
  }

  /* ── Clone copy ── */
  async function handleCopyClone() {
    if (!cloneCommand) return;
    try {
      await navigator.clipboard.writeText(cloneCommand);
      setCopyFeedback("Copied!");
      setTimeout(() => setCopyFeedback(""), 2000);
    } catch {
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(""), 2000);
    }
  }

  /* ── Star / Unstar ── */
  async function handleToggleStar() {
    if (!selectedRepo || !user) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    setStarBusy(true);
    try {
      if (isStarred) {
        await api("/api/stars", {
          method: "DELETE",
          body: JSON.stringify({
            user_id: user.user_id,
            repo_id: selectedRepo.repoId,
          }),
        });
        setDashStatus("Repository unstarred.", "success");
      } else {
        await api("/api/stars", {
          method: "POST",
          body: JSON.stringify({
            user_id: user.user_id,
            repo_id: selectedRepo.repoId,
          }),
        });
        setDashStatus("Repository starred! ⭐", "success");
      }
      const rows = await api(`/api/stars/user/${user.user_id}`);
      setStarredRepos((rows || []).map(mapStarredRepoRow));
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setStarBusy(false);
    }
  }

  /* ── Fork ── */
  async function handleFork() {
    if (!user || !selectedRepo) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    if (!canFork) {
      setDashStatus("You can only fork repositories owned by others.", "error");
      return;
    }
    setForkBusy(true);
    setDashStatus(
      `Forking ${selectedRepo.owner}/${selectedRepo.repoName}…`,
      "info",
    );
    try {
      const payload = {
        repo_id: selectedRepo.repoId,
        user_id: user.user_id,
        auto_rename: autoRenameFork,
      };
      const trimmed = forkName.trim();
      if (trimmed) payload.fork_name = trimmed;
      const res = await api("/api/git/clone", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refreshDashboard();
      if (res?.new_repo_name)
        await selectRepo(
          user.username,
          res.new_repo_name,
          res.new_repo_id || null,
        );
      setDashStatus(
        `Fork created: ${res.new_repo_name || "new repository"}.`,
        "success",
      );
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setForkBusy(false);
    }
  }

  /* ── Delete Repo ── */
  async function handleDeleteRepo() {
    if (!selectedRepo) return;
    if (
      !window.confirm(
        `Delete "${selectedRepo.repoName}"? This cannot be undone.`,
      )
    )
      return;
    try {
      await api(`/api/repos/${selectedRepo.repoId}`, { method: "DELETE" });
      await refreshDashboard();
      setDashStatus("Repository deleted.", "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  /* ── Branch CRUD ── */
  async function handleCreateBranch() {
    if (!selectedRepo) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    const name = newBranchName.trim();
    if (!name) {
      setDashStatus("Branch name is required.", "error");
      return;
    }
    setBranchBusy(true);
    try {
      await api("/api/git/branches", {
        method: "POST",
        body: JSON.stringify({
          repo_id: selectedRepo.repoId,
          branch_name: name,
          source_branch: branchSource,
        }),
      });
      setNewBranchName("");
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus(`Branch "${name}" created.`, "success");
      setActionModal("");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setBranchBusy(false);
    }
  }

  async function handleDeleteBranch(branchId, isDefault) {
    if (Number(isDefault) === 1) {
      setDashStatus("Cannot delete the default branch.", "error");
      return;
    }
    try {
      await api(`/api/git/branches/${branchId}`, { method: "DELETE" });
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus("Branch deleted.", "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  async function handleSetDefaultBranch(branchId, branchName) {
    try {
      await api(`/api/git/branches/${branchId}/default`, { method: "PUT" });
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus(`Default branch set to "${branchName}".`, "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  /* ── Issues ── */
  async function handleCreateIssue() {
    if (!selectedRepo || !user) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    const title = issueTitle.trim();
    if (!title) {
      setDashStatus("Issue title is required.", "error");
      return;
    }
    setIssueBusy(true);
    try {
      await api("/api/issues", {
        method: "POST",
        body: JSON.stringify({
          repo_id: selectedRepo.repoId,
          title,
          body: issueBody.trim(),
          label: issueLabel.trim() || null,
        }),
      });
      setIssueTitle("");
      setIssueBody("");
      setIssueLabel("bug");
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus("Issue created.", "success");
      setActionModal("");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setIssueBusy(false);
    }
  }

  async function handleToggleIssue(row) {
    const issueId = row[0];
    const nextStatus = row[3] === "open" ? "closed" : "open";
    try {
      const detail = await api(`/api/issues/detail/${issueId}`);
      await api(`/api/issues/${issueId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: detail[4] || row[2],
          body: detail[5] || "",
          status: nextStatus,
          label: detail[7] || row[4] || null,
        }),
      });
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus(`Issue #${row[1]} ${nextStatus}.`, "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  async function handleLoadIssueComments(issueId) {
    try {
      // FIX: Added issue comments loading to cover open/close/comment issue workflow.
      const rows = await api(`/api/issues/detail/${issueId}/comments`);
      setIssueComments((prev) => ({ ...prev, [issueId]: rows || [] }));
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  async function handleCreateIssueComment(issueId) {
    const body = String(issueCommentDrafts[issueId] || "").trim();
    if (!body) {
      setDashStatus("Comment body is required.", "error");
      return;
    }
    setIssueCommentBusy((prev) => ({ ...prev, [issueId]: true }));
    try {
      await api(`/api/issues/detail/${issueId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setIssueCommentDrafts((prev) => ({ ...prev, [issueId]: "" }));
      await handleLoadIssueComments(issueId);
      setDashStatus("Comment added.", "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setIssueCommentBusy((prev) => ({ ...prev, [issueId]: false }));
    }
  }

  /* ── Pull Requests ── */
  async function handleCreatePr() {
    if (!selectedRepo || !user) {
      setDashStatus("Select a repository first.", "error");
      return;
    }
    const title = prTitle.trim();
    if (!title) {
      setDashStatus("PR title is required.", "error");
      return;
    }
    if (!prSource || !prTarget) {
      setDashStatus("Source and target branches are required.", "error");
      return;
    }
    if (prSource === prTarget) {
      setDashStatus("Source and target must be different branches.", "error");
      return;
    }
    setPrBusy(true);
    try {
      await api("/api/pulls", {
        method: "POST",
        body: JSON.stringify({
          repo_id: selectedRepo.repoId,
          title,
          body: prBody.trim(),
          source_branch: prSource,
          target_branch: prTarget,
        }),
      });
      setPrTitle("");
      setPrBody("");
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus("Pull request created.", "success");
      setActionModal("");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setPrBusy(false);
    }
  }

  /* ── File viewer ── */
  async function handleOpenFile(fileRow) {
    // tree row: [file_id, file_name, file_path, file_type, file_size, last_modified]
    if (!selectedRepo) return;
    const filePath = fileRow[2];
    const fileName = fileRow[1];
    setFileBusy(true);
    setDashStatus(`Loading ${fileName}…`, "info");
    try {
      const branch = selectedRepo.defaultBranch || "main";
      const row = await api(
        `/api/git/blob/${encodeURIComponent(selectedRepo.owner)}/${encodeURIComponent(selectedRepo.repoName)}?file_path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(branch)}`,
      );
      // blob row: [file_id, file_name, file_path, content, file_type, file_size, last_modified]
      setViewingFile({
        name: row[1],
        path: row[2],
        content: row[3],
        fileType: row[4],
        size: row[5],
        updatedAt: formatDate(row[6]),
      });
      setDashStatus("", "");
    } catch (err) {
      setDashStatus(err.message, "error");
    } finally {
      setFileBusy(false);
    }
  }

  async function handlePrAction(prId, action) {
    try {
      await api(`/api/pulls/${prId}/${action}`, { method: "PUT" });
      await selectRepo(
        selectedRepo.owner,
        selectedRepo.repoName,
        selectedRepo.repoId,
      );
      setDashStatus(`Pull request ${action}d.`, "success");
    } catch (err) {
      setDashStatus(err.message, "error");
    }
  }

  /* ─────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────── */
  return (
    <>
      {/* File viewer modal */}
      <FileViewerModal
        file={viewingFile}
        onClose={() => setViewingFile(null)}
      />

      {actionModal && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeActionModal();
          }}
        >
          <div className="modal action-form-modal">
            <div className="modal-header">
              <div className="modal-title-group">
                <div>
                  <div className="modal-filename">
                    {actionModal === "branch" && "Create Branch"}
                    {actionModal === "issue" && "Create Issue"}
                    {actionModal === "pr" && "Create Pull Request"}
                  </div>
                  <div className="modal-filepath">
                    {selectedRepo
                      ? `${selectedRepo.owner}/${selectedRepo.repoName}`
                      : "No repository selected"}
                  </div>
                </div>
              </div>
              <button className="modal-close-btn" onClick={closeActionModal}>
                ✕
              </button>
            </div>

            <div className="action-modal-body">
              {actionModal === "branch" && (
                <>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="New branch name"
                  />
                  <select
                    value={branchSource}
                    onChange={(e) => setBranchSource(e.target.value)}
                  >
                    {branchNames.map((n) => (
                      <option key={n} value={n}>
                        from {n}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm btn-full"
                    onClick={handleCreateBranch}
                    disabled={branchBusy}
                  >
                    {branchBusy ? "Creating…" : "+ Create Branch"}
                  </button>
                </>
              )}

              {actionModal === "issue" && (
                <>
                  <input
                    type="text"
                    placeholder="Issue title"
                    value={issueTitle}
                    onChange={(e) => setIssueTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Label (bug, feature, docs…)"
                    value={issueLabel}
                    onChange={(e) => setIssueLabel(e.target.value)}
                  />
                  <textarea
                    placeholder="Describe the issue…"
                    value={issueBody}
                    onChange={(e) => setIssueBody(e.target.value)}
                    rows={4}
                  />
                  <button
                    className="btn btn-primary btn-sm btn-full"
                    onClick={handleCreateIssue}
                    disabled={issueBusy}
                  >
                    {issueBusy ? "Creating…" : "+ Open Issue"}
                  </button>
                </>
              )}

              {actionModal === "pr" && (
                <>
                  <input
                    type="text"
                    placeholder="Pull request title"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                  />
                  <div className="action-split">
                    <select
                      value={prSource}
                      onChange={(e) => setPrSource(e.target.value)}
                    >
                      {branchNames.map((n) => (
                        <option key={`modal-src-${n}`} value={n}>
                          from {n}
                        </option>
                      ))}
                    </select>
                    <select
                      value={prTarget}
                      onChange={(e) => setPrTarget(e.target.value)}
                    >
                      {branchNames.map((n) => (
                        <option key={`modal-tgt-${n}`} value={n}>
                          into {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    placeholder="Describe the changes…"
                    value={prBody}
                    onChange={(e) => setPrBody(e.target.value)}
                    rows={4}
                  />
                  <button
                    className="btn btn-primary btn-sm btn-full"
                    onClick={handleCreatePr}
                    disabled={prBusy || branchNames.length < 2}
                  >
                    {prBusy ? "Creating…" : "+ Open Pull Request"}
                  </button>
                  {branchNames.length < 2 && (
                    <p className="hint">
                      You need at least 2 branches to open a pull request.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Background orbs */}
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <div className="app-shell">
        {/* ── Top Nav ── */}
        <nav className="app-nav">
          <div className="nav-brand">
            <div className="nav-logo">
              <LogoIcon />
            </div>
            <div className="nav-brand-text">
              <span className="nav-brand-name">CodeHub</span>
              <span className="nav-brand-sub">Version Control Platform</span>
            </div>
          </div>
          <div className="nav-right">
            <button
              className="btn btn-ghost btn-sm"
              onClick={toggleDarkMode}
              title="Toggle Dark Mode"
            >
              {isDarkMode ? "☀️" : "🌙"}
            </button>
            <span className="nav-badge live">Live API</span>
            {user && <span className="nav-badge user">@{user.username}</span>}
            {user && (
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Sign out
              </button>
            )}
          </div>
        </nav>

        {/* ══════════════════════════════════════
            AUTH PAGE
        ══════════════════════════════════════ */}
        {!showDashboard && (
          <div className="auth-page">
            {/* Hero */}
            <div className="auth-hero">
              <div className="auth-hero-badge">🚀 CodeHub Platform</div>
              <h1>
                Code. Collaborate.
                <br />
                <span>Ship faster.</span>
              </h1>
              <p>
                A full-featured version control platform with repositories,
                branches, commits, issues, and pull requests — all in one place.
              </p>
              <div className="auth-feature-row">
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Repositories
                </span>
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Branching
                </span>
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Commits
                </span>
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Issues
                </span>
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Pull Requests
                </span>
                <span className="auth-feature">
                  <span className="auth-feature-dot" />
                  Forking
                </span>
              </div>
            </div>

            {/* Auth cards */}
            <div className="auth-cards">
              {/* Login */}
              <div className="card">
                <div className="card-title">
                  <span className="card-title-icon blue">🔑</span>
                  Sign in to your account
                </div>
                <form onSubmit={handleLogin}>
                  <div className="field">
                    <label>Username</label>
                    <input
                      type="text"
                      name="username"
                      placeholder="your_username"
                      required
                      autoComplete="username"
                    />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input
                      type="password"
                      name="password"
                      placeholder="••••••••"
                      required
                      autoComplete="current-password"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-full"
                    style={{ marginTop: "0.75rem" }}
                  >
                    Sign In
                  </button>
                </form>
              </div>

              {/* Signup */}
              <div className="card">
                <div className="card-title">
                  <span className="card-title-icon green">✨</span>
                  Create a new account
                </div>
                <form onSubmit={handleSignup}>
                  <div className="field">
                    <label>Username</label>
                    <input
                      type="text"
                      name="username"
                      placeholder="choose_username"
                      required
                      autoComplete="username"
                    />
                  </div>
                  <div className="field">
                    <label>Full Name</label>
                    <input
                      type="text"
                      name="full_name"
                      placeholder="Your Full Name"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input
                      type="email"
                      name="email"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div className="field">
                    <label>Password</label>
                    <input
                      type="password"
                      name="password"
                      placeholder="min. 6 characters"
                      minLength={6}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-soft btn-full"
                    style={{ marginTop: "0.75rem" }}
                  >
                    Create Account
                  </button>
                </form>
              </div>
            </div>

            {/* Auth message */}
            {authMsg.text && (
              <div
                style={{ width: "100%", maxWidth: 680, marginTop: "0.5rem" }}
              >
                <div className={`msg-bar ${authMsg.type || "info"}`}>
                  {authMsg.text}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════
            DASHBOARD
        ══════════════════════════════════════ */}
        {showDashboard && (
          <div className="dashboard">
            {/* ── Top bar ── */}
            <div className="dash-topbar">
              <div className="dash-topbar-title">
                <h2>Dashboard</h2>
                <p>Welcome back, {profile?.fullName || user?.username}</p>
              </div>
              <div className="dash-search-group">
                <input
                  type="text"
                  placeholder="🔍  Search my repositories…"
                  value={repoSearch}
                  onChange={(e) => {
                    setRepoSearch(e.target.value);
                    if (!e.target.value.trim()) setGlobalSearchResults([]);
                  }}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleSearchRepositories()
                  }
                />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleSearchRepositories}
                  disabled={searchBusy}
                >
                  {searchBusy ? "Searching…" : "Search All"}
                </button>
                <input
                  type="text"
                  placeholder="Open owner/repo"
                  value={repoLookup}
                  onChange={(e) => setRepoLookup(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleOpenByOwnerRepo()
                  }
                />
                <button
                  className="btn btn-soft btn-sm"
                  onClick={handleOpenByOwnerRepo}
                >
                  Open
                </button>
              </div>
              <div className="dash-topbar-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={refreshDashboard}
                >
                  ↻ Refresh
                </button>
              </div>
            </div>

            {/* ── Stats row ── */}
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-icon blue">📦</div>
                <div className="stat-body">
                  <div className="stat-label">My Repos</div>
                  <div className="stat-value">{myRepos.length}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon amber">⭐</div>
                <div className="stat-body">
                  <div className="stat-label">Starred</div>
                  <div className="stat-value">{starredRepos.length}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon indigo">🌿</div>
                <div className="stat-body">
                  <div className="stat-label">Branches</div>
                  <div className="stat-value">{repoBranches.length}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green">🔀</div>
                <div className="stat-body">
                  <div className="stat-label">Open Issues</div>
                  <div className="stat-value">
                    {repoIssues.filter((r) => r[3] === "open").length}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Main 3-col grid ── */}
            <div className="main-grid">
              {/* ═══ LEFT PANEL ═══ */}
              <aside className="sidebar side-panel">
                <SectionCard
                  id="sc-profile"
                  label="Profile"
                  collapsed={collapsedSections["sc-profile"]}
                  onToggle={() => toggleSection("sc-profile")}
                >
                  <div className="section-title">
                    <span className="section-title-icon">👤</span> Profile
                  </div>
                  {profile ? (
                    <div className="profile-card">
                      <div className="avatar">
                        {profile.avatarUrl ? (
                          <img src={profile.avatarUrl} alt={profile.username} />
                        ) : (
                          (profile.username || "U")[0].toUpperCase()
                        )}
                      </div>
                      <div className="profile-name">
                        {profile.fullName || profile.username}
                      </div>
                      <div className="profile-username">
                        @{profile.username}
                      </div>
                      {profile.bio && (
                        <div className="profile-meta">{profile.bio}</div>
                      )}
                      {profile.location && (
                        <div className="profile-meta">
                          📍 {profile.location}
                        </div>
                      )}
                      {profile.email && (
                        <div className="profile-meta">{profile.email}</div>
                      )}
                      <div className="profile-stats">
                        <div className="profile-stat">
                          <span className="profile-stat-val">
                            {profile.publicRepos}
                          </span>
                          <span className="profile-stat-lbl">Repos</span>
                        </div>
                        <div className="profile-stat">
                          <span className="profile-stat-val">
                            {profile.followers}
                          </span>
                          <span className="profile-stat-lbl">Followers</span>
                        </div>
                        <div className="profile-stat">
                          <span className="profile-stat-val">
                            {profile.following}
                          </span>
                          <span className="profile-stat-lbl">Following</span>
                        </div>
                      </div>
                      <div
                        className="profile-meta"
                        style={{ marginTop: "0.25rem" }}
                      >
                        Joined {formatDate(profile.createdAt)}
                      </div>
                    </div>
                  ) : (
                    <div className="profile-card">
                      <div className="avatar">
                        {(user?.username || "U")[0].toUpperCase()}
                      </div>
                      <div className="profile-name">@{user?.username}</div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  id="sc-quick"
                  label="Quick Actions"
                  collapsed={collapsedSections["sc-quick"]}
                  onToggle={() => toggleSection("sc-quick")}
                >
                  <div className="action-card-header">
                    <span className="action-card-icon">⚡</span>
                    <h3>Quick Actions</h3>
                  </div>
                  <div className="action-card-body">
                    {!selectedRepo ? (
                      <p className="action-placeholder">
                        Select a repository to enable actions.
                      </p>
                    ) : (
                      <>
                        <div className="clone-block">
                          <code>{cloneCommand}</code>
                          <button
                            className="clone-copy-btn"
                            onClick={handleCopyClone}
                          >
                            {copyFeedback || "Copy"}
                          </button>
                        </div>
                        <button
                          className={`star-btn ${isStarred ? "starred" : ""}`}
                          onClick={handleToggleStar}
                          disabled={starBusy}
                        >
                          {starBusy
                            ? "…"
                            : isStarred
                              ? "★ Unstar Repository"
                              : "☆ Star Repository"}
                        </button>
                        <button
                          className="btn btn-danger btn-sm btn-full"
                          onClick={handleDeleteRepo}
                          style={{ marginTop: "0.1rem" }}
                        >
                          🗑 Delete Repository
                        </button>
                      </>
                    )}
                  </div>
                </SectionCard>

                <SectionCard
                  id="sc-myrepos"
                  label="My Repositories"
                  collapsed={collapsedSections["sc-myrepos"]}
                  onToggle={() => toggleSection("sc-myrepos")}
                >
                  <div className="section-title">
                    <span className="section-title-icon">📁</span> My
                    Repositories
                  </div>
                  {globalSearchResults.length > 0 && (
                    <p className="hint" style={{ marginBottom: "0.4rem" }}>
                      Showing global search results for "{repoSearch}".
                    </p>
                  )}
                  {shownMyRepos.length === 0 ? (
                    <EmptyState
                      icon="📂"
                      message={
                        repoSearch
                          ? "No matches found."
                          : "No repositories yet."
                      }
                    />
                  ) : (
                    <ul className="repo-list">
                      {shownMyRepos.map((r) => (
                        <RepoListItem
                          key={`${r.owner}-${r.repoId}`}
                          repo={r}
                          selected={selectedRepo}
                          onSelect={selectRepo}
                        />
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard
                  id="sc-starred"
                  label="Starred Repos"
                  collapsed={collapsedSections["sc-starred"]}
                  onToggle={() => toggleSection("sc-starred")}
                >
                  <div className="section-title">
                    <span className="section-title-icon">⭐</span> Starred Repos
                  </div>
                  {starredRepos.length === 0 ? (
                    <EmptyState icon="🌟" message="No starred repositories." />
                  ) : (
                    <ul className="repo-list">
                      {starredRepos.map((r) => (
                        <RepoListItem
                          key={r.repoId}
                          repo={r}
                          selected={selectedRepo}
                          onSelect={selectRepo}
                        />
                      ))}
                    </ul>
                  )}
                </SectionCard>

                <SectionCard
                  id="sc-newrepo"
                  label="New Repository"
                  collapsed={collapsedSections["sc-newrepo"]}
                  onToggle={() => toggleSection("sc-newrepo")}
                >
                  <div className="section-title">
                    <span className="section-title-icon">➕</span> New
                    Repository
                  </div>
                  <form className="create-form" onSubmit={handleCreateRepo}>
                    <input
                      type="text"
                      name="repo_name"
                      placeholder="Repository name"
                      required
                    />
                    <input
                      type="text"
                      name="description"
                      placeholder="Short description (optional)"
                    />
                    <input
                      type="text"
                      name="language"
                      placeholder="Language (JS, Python…)"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm btn-full"
                      disabled={createBusy}
                    >
                      {createBusy ? "Creating…" : "+ Create Repository"}
                    </button>
                  </form>
                </SectionCard>
              </aside>

              {/* ═══ DETAIL CENTER PANEL ═══ */}
              <div className="detail-panel">
                {!selectedRepo ? (
                  <div className="detail-empty">
                    <div className="detail-empty-icon">🗂️</div>
                    <p>
                      Select or search a repository to view details, commits,
                      issues, and pull requests.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Repo Header */}
                    <div className="repo-header">
                      <div className="repo-header-top">
                        <div>
                          <div className="repo-header-breadcrumb">
                            <span>{selectedRepo.owner}</span>
                            <span>/</span>
                          </div>
                          <div className="repo-title">
                            {selectedRepo.repoName}
                          </div>
                          <div className="repo-description">
                            {selectedRepo.description ||
                              "No description provided."}
                          </div>
                          <div className="repo-meta-pills">
                            {selectedRepo.language && (
                              <span className="repo-pill language">
                                🔷 {selectedRepo.language}
                              </span>
                            )}
                            <span className="repo-pill stars">
                              ⭐ {selectedRepo.stars || 0} stars
                            </span>
                            <span className="repo-pill forks">
                              🍴 {selectedRepo.forks || 0} forks
                            </span>
                            <span className="repo-pill issues">
                              🔴 {selectedRepo.openIssues || 0} issues
                            </span>
                            <span className="repo-pill updated">
                              Updated {formatDate(selectedRepo.updatedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="repo-header-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openActionModal("branch")}
                            disabled={!selectedRepo}
                          >
                            + Branch
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openActionModal("issue")}
                            disabled={!selectedRepo}
                          >
                            + Issue
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openActionModal("pr")}
                            disabled={!selectedRepo || branchNames.length < 2}
                            title={
                              branchNames.length < 2
                                ? "Need at least 2 branches for PR"
                                : "Open pull request form"
                            }
                          >
                            + PR
                          </button>
                          <button
                            className="btn btn-soft btn-sm"
                            onClick={handleFork}
                            disabled={forkBusy || !canFork}
                            title={
                              canFork
                                ? "Fork this repository"
                                : "You can only fork repositories owned by other users"
                            }
                          >
                            {forkBusy ? "Forking…" : "🍴 Fork"}
                          </button>
                          <button
                            className={`star-btn ${isStarred ? "starred" : ""}`}
                            onClick={handleToggleStar}
                            disabled={starBusy}
                          >
                            {starBusy ? "…" : isStarred ? "★ Unstar" : "☆ Star"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Tabs */}
                    <div className="tabs">
                      {[
                        { id: "overview", label: "📋 Overview" },
                        {
                          id: "commits",
                          label: "🔖 Commits",
                          count: repoCommits.length,
                        },
                        {
                          id: "branches",
                          label: "🌿 Branches",
                          count: repoBranches.length,
                        },
                        {
                          id: "issues",
                          label: "🔴 Issues",
                          count: repoIssues.length,
                        },
                        {
                          id: "pulls",
                          label: "🔀 Pull Requests",
                          count: repoPulls.length,
                        },
                        {
                          id: "files",
                          label: "📂 Files",
                          count: repoFiles.length,
                        },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          {tab.label}
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className="tab-count">{tab.count}</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Tab content */}
                    <div className="tab-content">
                      {/* ── Overview ── */}
                      {activeTab === "overview" && (
                        <div className="overview-grid">
                          <div className="overview-card">
                            <div className="overview-card-title">
                              🌿 Branches
                            </div>
                            {repoBranches.length === 0 ? (
                              <EmptyState
                                icon="🌿"
                                message="No branches yet."
                              />
                            ) : (
                              <ul className="detail-list">
                                {repoBranches.map((b) => (
                                  <li key={b[0]} className="detail-item">
                                    <div className="detail-item-body">
                                      <span className="detail-item-main">
                                        {b[1]}
                                        {Number(b[2]) === 1 ? " ✦" : ""}
                                      </span>
                                      <span className="detail-item-sub">
                                        {formatDate(b[3])}
                                      </span>
                                    </div>
                                    {Number(b[2]) === 1 && (
                                      <span className="branch-default-badge">
                                        default
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="overview-card">
                            <div className="overview-card-title">
                              🔖 Recent Commits
                            </div>
                            {repoCommits.length === 0 ? (
                              <EmptyState icon="📝" message="No commits yet." />
                            ) : (
                              <ul className="detail-list">
                                {repoCommits.slice(0, 5).map((c, i) => (
                                  <li key={i} className="detail-item">
                                    <div className="detail-item-body">
                                      <span className="detail-item-main">
                                        {c[2]}
                                      </span>
                                      <span className="detail-item-sub">
                                        {String(c[1]).slice(0, 7)} · {c[6]} ·{" "}
                                        {formatDate(c[5])}
                                      </span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="overview-card">
                            <div className="overview-card-title">
                              🔴 Open Issues
                            </div>
                            {repoIssues.filter((r) => r[3] === "open")
                              .length === 0 ? (
                              <EmptyState icon="✅" message="No open issues." />
                            ) : (
                              <ul className="detail-list">
                                {repoIssues
                                  .filter((r) => r[3] === "open")
                                  .slice(0, 4)
                                  .map((r) => (
                                    <li key={r[0]} className="detail-item">
                                      <div className="detail-item-body">
                                        <span className="detail-item-main">
                                          #{r[1]} {r[2]}
                                        </span>
                                        <span className="detail-item-sub">
                                          {r[4] || "no label"} · {r[7]}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>

                          <div className="overview-card">
                            <div className="overview-card-title">
                              🔀 Open PRs
                            </div>
                            {repoPulls.filter((r) => r[3] === "open").length ===
                            0 ? (
                              <EmptyState
                                icon="✅"
                                message="No open pull requests."
                              />
                            ) : (
                              <ul className="detail-list">
                                {repoPulls
                                  .filter((r) => r[3] === "open")
                                  .slice(0, 4)
                                  .map((r) => (
                                    <li key={r[0]} className="detail-item">
                                      <div className="detail-item-body">
                                        <span className="detail-item-main">
                                          #{r[1]} {r[2]}
                                        </span>
                                        <span className="detail-item-sub">
                                          {r[4]} → {r[5]} · {r[8]}
                                        </span>
                                      </div>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </div>

                          {/* <div className="overview-card wide">
                            <div className="overview-card-title">
                              📂 Repository Files
                            </div>
                            {repoFiles.length === 0 ? (
                              <EmptyState
                                icon="📂"
                                message="No files committed yet."
                              />
                            ) : (
                              <ul
                                className="detail-list"
                                style={{ maxHeight: 180 }}
                              >
                                {repoFiles.map((f, i) => (
                                  <li
                                    key={i}
                                    className="detail-item detail-item-clickable"
                                    onClick={() => handleOpenFile(f)}
                                    title={`View ${f[1]}`}
                                  >
                                    <span className="file-icon">
                                      {getFileIcon(f[1])}
                                    </span>
                                    <div className="detail-item-body">
                                      <span className="detail-item-main">
                                        {f[1]}
                                      </span>
                                      <span className="detail-item-sub">
                                        {f[3] || "text"} · {f[4] || 0} bytes
                                      </span>
                                    </div>
                                    <span className="file-meta">
                                      {formatDate(f[5])}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>*/}

                          <div className="overview-card wide">
                            <div className="overview-card-title">📘 README</div>
                            {!repoReadme?.content ? (
                              <EmptyState
                                icon="📝"
                                message="No README found in this repository."
                              />
                            ) : (
                              <div className="readme-preview">
                                <div
                                  className="markdown-body"
                                  dangerouslySetInnerHTML={{
                                    __html: renderMarkdownLite(
                                      repoReadme.content,
                                    ),
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Commits ── */}
                      {activeTab === "commits" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {repoCommits.length === 0 ? (
                            <EmptyState
                              icon="📝"
                              message="No commits in this repository yet."
                            />
                          ) : (
                            repoCommits.map((c, i) => (
                              <div key={i} className="commit-item">
                                <span className="commit-hash">
                                  {String(c[1]).slice(0, 7)}
                                </span>
                                <div className="commit-body">
                                  <span className="commit-message">{c[2]}</span>
                                  <div className="commit-meta">
                                    <span>{c[6]}</span>
                                    <span>·</span>
                                    <span>{formatDate(c[5])}</span>
                                    <span>·</span>
                                    <span className="commit-diff">
                                      <span className="diff-add">+{c[3]}</span>
                                      <span className="diff-del"> -{c[4]}</span>
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* ── Branches ── */}
                      {activeTab === "branches" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {repoBranches.length === 0 ? (
                            <EmptyState
                              icon="🌿"
                              message="No branches found."
                            />
                          ) : (
                            repoBranches.map((b) => (
                              <div key={b[0]} className="detail-item">
                                <div className="detail-item-body">
                                  <span className="detail-item-main">
                                    {b[1]}
                                  </span>
                                  <span className="detail-item-sub">
                                    Created {formatDate(b[3])}
                                  </span>
                                </div>
                                {Number(b[2]) === 1 ? (
                                  <span className="branch-default-badge">
                                    default
                                  </span>
                                ) : (
                                  <div className="inline-actions">
                                    <button
                                      className="btn btn-ghost btn-xs"
                                      onClick={() =>
                                        handleSetDefaultBranch(b[0], b[1])
                                      }
                                    >
                                      Set default
                                    </button>
                                    <button
                                      className="btn btn-danger btn-xs"
                                      onClick={() =>
                                        handleDeleteBranch(b[0], b[2])
                                      }
                                    >
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* ── Issues ── */}
                      {activeTab === "issues" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {repoIssues.length === 0 ? (
                            <EmptyState
                              icon="✅"
                              message="No issues in this repository."
                            />
                          ) : (
                            repoIssues.map((r) => (
                              <div
                                key={r[0]}
                                className={`issue-item ${r[3] === "closed" ? "closed" : ""}`}
                              >
                                <div className={`issue-icon ${r[3]}`}>
                                  {r[3] === "open" ? "●" : "✓"}
                                </div>
                                <div className="issue-body">
                                  <span className="issue-title">
                                    #{r[1]} {r[2]}
                                  </span>
                                  <div className="issue-meta">
                                    <span>{r[7]}</span>
                                    <span>·</span>
                                    <span>{formatDate(r[5])}</span>
                                    {r[4] && (
                                      <span
                                        className={`issue-label ${getIssueLabelClass(r[4])}`}
                                      >
                                        {r[4]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="issue-comments">
                                    <button
                                      className="btn btn-ghost btn-xs"
                                      onClick={() =>
                                        handleLoadIssueComments(r[0])
                                      }
                                    >
                                      Load comments
                                    </button>
                                    {(issueComments[r[0]] || []).length > 0 && (
                                      <div className="issue-comment-list">
                                        {(issueComments[r[0]] || []).map(
                                          (c) => (
                                            <div
                                              key={c[0]}
                                              className="issue-comment-item"
                                            >
                                              <span className="issue-comment-user">
                                                @{c[3]}
                                              </span>
                                              <span>{c[4]}</span>
                                            </div>
                                          ),
                                        )}
                                      </div>
                                    )}
                                    <div className="issue-comment-form">
                                      <input
                                        type="text"
                                        placeholder="Add a comment…"
                                        value={issueCommentDrafts[r[0]] || ""}
                                        onChange={(e) =>
                                          setIssueCommentDrafts((prev) => ({
                                            ...prev,
                                            [r[0]]: e.target.value,
                                          }))
                                        }
                                      />
                                      <button
                                        className="btn btn-soft btn-xs"
                                        onClick={() =>
                                          handleCreateIssueComment(r[0])
                                        }
                                        disabled={Boolean(
                                          issueCommentBusy[r[0]],
                                        )}
                                      >
                                        {issueCommentBusy[r[0]]
                                          ? "Adding…"
                                          : "Comment"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <button
                                  className={`btn btn-xs ${r[3] === "open" ? "btn-ghost" : "btn-success"}`}
                                  onClick={() => handleToggleIssue(r)}
                                >
                                  {r[3] === "open" ? "Close" : "Reopen"}
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* ── Pull Requests ── */}
                      {activeTab === "pulls" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {repoPulls.length === 0 ? (
                            <EmptyState
                              icon="🔀"
                              message="No pull requests in this repository."
                            />
                          ) : (
                            repoPulls.map((r) => (
                              <div key={r[0]} className="pr-item">
                                <div className={`pr-status-dot ${r[3]}`} />
                                <div className="pr-body">
                                  <span className="pr-title">
                                    #{r[1]} {r[2]}
                                  </span>
                                  <div className="pr-meta">
                                    <span>{r[8]}</span>
                                    <span>·</span>
                                    <span>{formatDate(r[6])}</span>
                                    <span className="pr-branch-arrow">
                                      {r[4]} → {r[5]}
                                    </span>
                                    {r[3] === "merged" && r[7] && (
                                      <span>Merged {formatDate(r[7])}</span>
                                    )}
                                  </div>
                                </div>
                                {r[3] === "open" && (
                                  <div className="pr-actions">
                                    <button
                                      className="btn btn-success btn-xs"
                                      onClick={() =>
                                        handlePrAction(r[0], "merge")
                                      }
                                    >
                                      Merge
                                    </button>
                                    <button
                                      className="btn btn-danger btn-xs"
                                      onClick={() =>
                                        handlePrAction(r[0], "close")
                                      }
                                    >
                                      Close
                                    </button>
                                  </div>
                                )}
                                {r[3] !== "open" && (
                                  <span className={`pr-status-pill ${r[3]}`}>
                                    {r[3]}
                                  </span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* ── Files ── */}
                      {activeTab === "files" && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.4rem",
                          }}
                        >
                          {repoFiles.length === 0 ? (
                            <EmptyState
                              icon="📂"
                              message="No files committed to this repository yet."
                            />
                          ) : (
                            <RepoFileTree
                              rows={repoFiles}
                              onOpenFile={handleOpenFile}
                              fileBusy={fileBusy}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Status bar ── */}
            {dashMsg.text && (
              <div
                className={`msg-bar ${dashMsg.type || "info"}`}
                style={{ marginTop: 0 }}
              >
                {dashMsg.type === "success" && "✓ "}
                {dashMsg.type === "error" && "✕ "}
                {dashMsg.type === "info" && "ℹ "}
                {dashMsg.text}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
