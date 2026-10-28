"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Token = {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type AdminUser = { id: string; email: string; role: "user" | "admin"; created_at: string };
type Memory = { id: string; category: string; content: string; source: string; created_at: string };
type Connector = { id: string; name: string; description: string; connected: boolean };
type AgentJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  cancel_requested: boolean;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export function DashboardPanel({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorSecrets, setConnectorSecrets] = useState<Record<string, string>>({});
  const [modelConfigured, setModelConfigured] = useState(false);
  const [label, setLabel] = useState("Android phone");
  const [newToken, setNewToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTokens() {
    const response = await fetch("/api/tokens", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load tokens.");
    setTokens(body.tokens as Token[]);
  }

  async function loadUsers() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load accounts.");
    setUsers(body.users as AdminUser[]);
  }

  async function loadMemories() {
    const response = await fetch("/api/memories", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load Prism memory.");
    setMemories(body.memories as Memory[]);
  }

  async function loadConnectors() {
    const response = await fetch("/api/connectors", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load MCP connector catalog.");
    setConnectors(body.connectors as Connector[]);
  }

  async function loadJobs() {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load task history.");
    setJobs(body.jobs as AgentJob[]);
  }

  useEffect(() => {
    void fetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check model gateway status.");
        const body = await response.json();
        setModelConfigured(Boolean(body.modelEndpointConfigured));
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Could not check model gateway status."),
      );
    void loadTokens().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Could not load tokens."),
    );
    void loadMemories().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Could not load Prism memory."),
    );
    void loadConnectors().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Could not load connector catalog."),
    );
    void loadJobs().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : "Could not load task history."),
    );
    const jobsTimer = window.setInterval(() => {
      void loadJobs().catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Could not refresh task history."),
      );
    }, 5000);
    if (isAdmin) {
      void loadUsers().catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Could not load accounts."),
      );
    }
    return () => window.clearInterval(jobsTimer);
  }, [isAdmin]);

  async function cancelJob(id: string) {
    if (!window.confirm("Cancel this queued task?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not cancel task.");
      setMessage(body.canceled ? "Queued task canceled." : "Cancellation requested; the worker will stop the running model call.");
      await loadJobs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel task.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemory(id: string) {
    if (!window.confirm(id === "all" ? "Delete all saved Prism memories?" : "Delete this Prism memory?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not delete memory.");
      setMessage("Prism memory deleted.");
      await loadMemories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete memory.");
    } finally {
      setBusy(false);
    }
  }

  async function connectConnector(connectorId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectorId, credential: connectorSecrets[connectorId] ?? "" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not connect MCP service.");
      setConnectorSecrets((current) => ({ ...current, [connectorId]: "" }));
      setMessage("Connector authorization saved.");
      await loadConnectors();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect MCP service.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectConnector(connectorId: string) {
    if (!window.confirm("Disconnect this service and remove its saved credential?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not disconnect service.");
      setMessage("Connector disconnected.");
      await loadConnectors();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect service.");
    } finally {
      setBusy(false);
    }
  }

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setNewToken("");
    try {
      const response = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create API token.");
      setNewToken(body.token as string);
      setLabel("");
      await loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create API token.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    if (!window.confirm("Revoke this token? Android devices using it will stop connecting.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not revoke token.");
      setMessage("Token revoked.");
      await loadTokens();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not revoke token.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(userId: string, role: "user" | "admin") {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update role.");
      setMessage("Account role updated.");
      await loadUsers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update role.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  return (
    <div className="workspace">
      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="/dashboard" aria-label="Prism home">
          <span className="brand-mark">P</span>
          <span>Prism<small>PHONE AGENT</small></span>
        </a>
        <a className="new-task-link" href="#device">+ <span>New phone task</span></a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="workspace-nav" aria-label="Workspace">
          <a href="#overview"><span>Overview</span></a>
          <a href="#jobs"><span>Task history</span></a>
          <a href="#connectors"><span>Connectors</span><small>{connectors.length}</small></a>
          <a href="#memory"><span>Memory</span></a>
          <a href="#device"><span>Android device</span></a>
          {isAdmin && <a href="#accounts"><span>Accounts</span></a>}
        </nav>
        <div className="sidebar-bottom">
          <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/PRIVACY.md">Privacy draft</a>
          <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/TERMS.md">Terms draft</a>
          <span className="sidebar-account">{email}</span>
          <button className="secondary" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="dashboard">
      <header className="topbar">
        <div><p className="eyebrow">YOUR WORKSPACE</p><h1>Phone agent</h1></div>
        <div className="account"><span className="connection-indicator"><span className="dot" />{modelConfigured ? "Model configured" : "Model setup needed"}</span><span>{isAdmin ? "ADMIN" : "ACCOUNT"}</span></div>
      </header>

      <section className="panel" id="overview">
        <p className="eyebrow">MODEL CONNECTION</p>
        <h2>Your Prism model endpoint</h2>
        <p>Connect an OpenAI-compatible vision model. Provider credentials stay server-side; they are never sent to the Android app.</p>
        <p className={modelConfigured ? "status" : "message"}>
          <span className="dot" /> {modelConfigured ? "Model endpoint configured" : "Model endpoint not configured yet"}
        </p>
        <p className="fineprint">Expected API: OpenAI-compatible <code>POST /v1/chat/completions</code> with text and JPEG image input. Cloud tasks send approved screen context to your configured model host.</p>
      </section>

      <section className="panel" id="jobs">
        <p className="eyebrow">ASYNC TASKS</p>
        <h2>Recent model jobs</h2>
        <p>Shows the latest 50 model-inference jobs. Queued jobs cancel immediately; cancellation of a running model request is sent to the worker and normally takes effect at its next heartbeat.</p>
        <div className="table-wrap">
          <table><thead><tr><th>Submitted</th><th>Status</th><th>Started</th><th>Finished</th><th>Details</th><th></th></tr></thead>
            <tbody>{jobs.map((job) => <tr key={job.id}>
              <td>{new Date(job.created_at).toLocaleString()}</td>
              <td>{job.cancel_requested && job.status === "running" ? "cancel requested" : job.status}</td>
              <td>{job.started_at ? new Date(job.started_at).toLocaleString() : "—"}</td>
              <td>{job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"}</td>
              <td>{job.error ?? "—"}</td>
              <td>{(job.status === "queued" || (job.status === "running" && !job.cancel_requested)) && <button className="danger" disabled={busy} onClick={() => void cancelJob(job.id)}>Cancel</button>}</td>
            </tr>)}
              {jobs.length === 0 && <tr><td colSpan={6}>No recent model jobs.</td></tr>}
            </tbody></table>
        </div>
      </section>

      <section className="panel" id="connectors">
        <p className="eyebrow">MCP CONNECTORS</p>
        <h2>Connected services</h2>
        <p>Prism can load tools from deployment-approved Streamable HTTP MCP servers. The catalog is configured by the service operator; each service may require its own bearer credential and permissions. Credentials are encrypted server-side. Connect only servers you trust.</p>
        <div className="connector-list">
          {connectors.map((connector) => <article className="connector-item" key={connector.id}>
            <div className="connector-info">
              <strong>{connector.name}</strong><small>{connector.description || connector.id}</small>
            </div>
            <label className="connector-key">Service bearer token (optional)
              <input
                type="password"
                autoComplete="new-password"
                value={connectorSecrets[connector.id] ?? ""}
                onChange={(event) => setConnectorSecrets((current) => ({ ...current, [connector.id]: event.target.value }))}
                placeholder={connector.connected ? "Leave empty to keep saved token" : "Blank for public MCP servers"}
              />
            </label>
            <div className="connector-actions">
              <button className="secondary" disabled={busy} onClick={() => void connectConnector(connector.id)}>
                {connector.connected ? "Save / update token" : "Connect"}
              </button>
              {connector.connected && <button className="danger" disabled={busy} onClick={() => void disconnectConnector(connector.id)}>Disconnect</button>}
            </div>
          </article>)}
          {connectors.length === 0 && <p>No MCP connectors are configured by the deployment operator yet.</p>}
        </div>
      </section>

      <section className="panel" id="memory">
        <p className="eyebrow">PERSISTENT MEMORY</p>
        <h2>Your Prism memories</h2>
        <p>Memory is saved only when you opt in for a task in the Android app. These entries are private to your account. Delete individual entries or clear everything.</p>
        <div className="memory-list">
          {memories.map((memory) => <article className="memory-item" key={memory.id}>
            <div><small>{memory.category} • {memory.source} • {new Date(memory.created_at).toLocaleString()}</small><p>{memory.content}</p></div>
            <button className="danger" disabled={busy} onClick={() => void deleteMemory(memory.id)}>Delete</button>
          </article>)}
          {memories.length === 0 && <p>No saved memories.</p>}
        </div>
        {memories.length > 0 && <button className="danger" disabled={busy} onClick={() => void deleteMemory("all")}>Delete all memory</button>}
      </section>

      <section className="panel" id="device">
        <p className="eyebrow">ANDROID ACCESS</p>
        <h2>API tokens</h2>
        <p>Create a token, copy it once, then enter it and your Vercel URL in the Android app. Tokens are stored as hashes and cannot be viewed again.</p>
        <form className="inline-form" onSubmit={createToken}>
          <label>Token label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} required placeholder="My phone" /></label>
          <button className="primary" disabled={busy}>Create token</button>
        </form>
        {newToken && <div className="token-once"><strong>Copy now — shown only once:</strong><code>{newToken}</code><button className="secondary" onClick={() => navigator.clipboard.writeText(newToken)}>Copy token</button></div>}
        <div className="table-wrap">
          <table><thead><tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th>State</th><th></th></tr></thead>
            <tbody>{tokens.map((token) => <tr key={token.id}>
              <td>{token.label}</td><td><code>{token.token_prefix}…</code></td>
              <td>{new Date(token.created_at).toLocaleDateString()}</td>
              <td>{token.last_used_at ? new Date(token.last_used_at).toLocaleString() : "Never"}</td>
              <td>{token.revoked_at ? "Revoked" : "Active"}</td>
              <td>{!token.revoked_at && <button className="danger" disabled={busy} onClick={() => void revokeToken(token.id)}>Revoke</button>}</td>
            </tr>)}
              {tokens.length === 0 && <tr><td colSpan={6}>No tokens yet.</td></tr>}
            </tbody></table>
        </div>
      </section>

      {isAdmin && <section className="panel" id="accounts">
        <p className="eyebrow">ADMINISTRATION</p>
        <h2>Accounts</h2>
        <div className="table-wrap"><table><thead><tr><th>Email</th><th>Joined</th><th>Role</th><th>Change role</th></tr></thead>
          <tbody>{users.map((user) => <tr key={user.id}>
            <td>{user.email}</td><td>{new Date(user.created_at).toLocaleDateString()}</td><td>{user.role}</td>
            <td><button className="secondary" disabled={busy || user.email === email} onClick={() => void updateRole(user.id, user.role === "admin" ? "user" : "admin")}>{user.role === "admin" ? "Make user" : "Make admin"}</button></td>
          </tr>)}</tbody></table></div>
      </section>}

      <p className="message" aria-live="polite">{message}</p>
      </main>
    </div>
  );
}
