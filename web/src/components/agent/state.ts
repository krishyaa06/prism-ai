import type { AgentEvent, Artifact, ArtifactKind, ChatMessage, PlanStep } from "@/lib/agent/events";

export type ActivityItem = {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  state: "running" | "ok" | "error";
  summary?: string;
  startedAt: number;
  finishedAt?: number;
};

export type Source = { id: number; url: string; title: string; snippet?: string };

export type SubagentState = {
  id: string;
  task: string;
  status: "running" | "done" | "failed";
  summary?: string;
};

export type ApprovalAnswer = {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  approved: boolean;
};

export type PendingApproval = {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  answered?: boolean;
  approved?: boolean;
};

export type UserTurn = {
  role: "user";
  id: string;
  content: string;
  attachments?: string[];
  createdAt: number;
};

export type AssistantTurn = {
  role: "assistant";
  id: string;
  createdAt: number;
  running: boolean;
  status?: string;
  plan: PlanStep[];
  activity: ActivityItem[];
  subagents: SubagentState[];
  text: string;
  sources: Source[];
  artifactIds: string[];
  approvals: PendingApproval[];
  answeredApprovals: ApprovalAnswer[];
  question?: { text: string; options?: string[]; answered?: boolean };
  error?: string;
  stopped?: boolean;
  usage?: { rounds: number; toolCalls: number };
};

export type Turn = UserTurn | AssistantTurn;

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
  artifacts: Artifact[];
};

export const MAX_MESSAGES = 60;
export const MAX_HISTORY_BYTES = 190_000;
export const MAX_ATTACHMENT_BYTES = 200 * 1024;

export function uid(prefix = "id"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${random}`;
}

export function newAssistantTurn(): AssistantTurn {
  return {
    role: "assistant",
    id: uid("turn"),
    createdAt: Date.now(),
    running: true,
    status: "Thinking…",
    plan: [],
    activity: [],
    subagents: [],
    text: "",
    sources: [],
    artifactIds: [],
    approvals: [],
    answeredApprovals: [],
  };
}

/** Text the assistant contributes to the conversation history. */
export function assistantContent(turn: AssistantTurn): string {
  if (turn.text.trim()) return turn.text;
  if (turn.question) return turn.question.text;
  if (turn.error) return `(The previous run failed: ${turn.error})`;
  return "";
}

/** Build the history sent to the API: role + content only, newest 60, size-capped. */
export function buildHistory(turns: Turn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else {
      const content = assistantContent(turn);
      if (content) messages.push({ role: "assistant", content });
    }
  }
  let trimmed = messages.slice(-MAX_MESSAGES);
  const size = (list: ChatMessage[]) => list.reduce((sum, m) => sum + m.content.length + 32, 0);
  while (trimmed.length > 1 && size(trimmed) > MAX_HISTORY_BYTES) trimmed = trimmed.slice(1);
  // The API expects history to start with a user message.
  while (trimmed.length > 1 && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

/** Reset the visible streaming state before re-running a turn (retry / approval). */
export function resetForRerun(turn: AssistantTurn, keepActivity: boolean): AssistantTurn {
  return {
    ...turn,
    running: true,
    status: "Resuming…",
    text: "",
    error: undefined,
    stopped: false,
    question: undefined,
    usage: undefined,
    activity: keepActivity ? turn.activity : [],
    subagents: keepActivity ? turn.subagents : [],
    sources: keepActivity ? turn.sources : [],
    plan: keepActivity ? turn.plan : [],
  };
}

export type ApplyResult = { turn: AssistantTurn; artifact?: Artifact };

export function applyEvent(turn: AssistantTurn, event: AgentEvent): ApplyResult {
  switch (event.type) {
    case "status":
      return { turn: { ...turn, status: event.text } };
    case "plan":
      return { turn: { ...turn, plan: Array.isArray(event.steps) ? event.steps : turn.plan } };
    case "text":
      return { turn: { ...turn, text: turn.text + (event.delta ?? "") } };
    case "tool_call": {
      const item: ActivityItem = {
        id: event.id,
        name: event.name,
        label: event.label || event.name,
        args: event.args ?? {},
        state: "running",
        startedAt: Date.now(),
      };
      const exists = turn.activity.some((a) => a.id === event.id);
      return {
        turn: {
          ...turn,
          activity: exists ? turn.activity.map((a) => (a.id === event.id ? { ...a, ...item } : a)) : [...turn.activity, item],
        },
      };
    }
    case "tool_result":
      return {
        turn: {
          ...turn,
          activity: turn.activity.map((a) =>
            a.id === event.id
              ? { ...a, state: event.ok ? "ok" : "error", summary: event.summary, finishedAt: Date.now() }
              : a,
          ),
        },
      };
    case "source": {
      if (turn.sources.some((s) => s.id === event.id && s.url === event.url)) return { turn };
      const others = turn.sources.filter((s) => s.id !== event.id);
      const next = [...others, { id: event.id, url: event.url, title: event.title, snippet: event.snippet }];
      next.sort((a, b) => a.id - b.id);
      return { turn: { ...turn, sources: next } };
    }
    case "artifact": {
      const artifact = event.artifact;
      if (!artifact || typeof artifact.id !== "string") return { turn };
      const artifactIds = turn.artifactIds.includes(artifact.id) ? turn.artifactIds : [...turn.artifactIds, artifact.id];
      return { turn: { ...turn, artifactIds }, artifact };
    }
    case "subagent": {
      const exists = turn.subagents.some((s) => s.id === event.id);
      const item: SubagentState = { id: event.id, task: event.task, status: event.status, summary: event.summary };
      return {
        turn: {
          ...turn,
          subagents: exists
            ? turn.subagents.map((s) => (s.id === event.id ? { ...s, ...item, task: item.task || s.task } : s))
            : [...turn.subagents, item],
        },
      };
    }
    case "approval_required": {
      const pending: PendingApproval = { callId: event.callId, tool: event.tool, args: event.args ?? {}, reason: event.reason };
      const approvals = [...turn.approvals.filter((a) => a.callId !== event.callId), pending];
      return { turn: { ...turn, approvals, status: "Waiting for your approval" } };
    }
    case "question":
      return { turn: { ...turn, question: { text: event.text, options: event.options }, running: false, status: undefined } };
    case "error":
      return { turn: { ...turn, error: event.message || "Something went wrong.", running: false, status: undefined } };
    case "done":
      return { turn: { ...turn, running: false, status: undefined, usage: event.usage } };
    default:
      return { turn };
  }
}

export function upsertArtifact(list: Artifact[], artifact: Artifact): Artifact[] {
  const index = list.findIndex((a) => a.id === artifact.id);
  if (index === -1) return [...list, artifact];
  const next = list.slice();
  next[index] = { ...list[index], ...artifact };
  return next;
}

export function kindFromFilename(name: string): ArtifactKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "json") return "json";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "svg") return "svg";
  if (["js", "ts", "tsx", "jsx", "py", "css", "sh", "sql", "yaml", "yml", "go", "rs", "java", "kt"].includes(ext)) return "code";
  return "text";
}

export function mimeFor(artifact: Artifact): string {
  switch (artifact.kind) {
    case "markdown":
      return "text/markdown;charset=utf-8";
    case "html":
      return "text/html;charset=utf-8";
    case "csv":
      return "text/csv;charset=utf-8";
    case "json":
      return "application/json;charset=utf-8";
    case "svg":
      return "image/svg+xml;charset=utf-8";
    default:
      return "text/plain;charset=utf-8";
  }
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New task";
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}

// ---------- persistence ----------

export const STORAGE_KEY = "prism-agent-conversations-v1";
export const SETTINGS_KEY = "prism-agent-settings-v1";

export function loadConversations(key: string): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.turns))
      .map((c) => ({
        ...c,
        artifacts: Array.isArray(c.artifacts) ? c.artifacts : [],
        turns: c.turns.map((t) =>
          t.role === "assistant" && t.running
            ? { ...t, running: false, status: undefined, stopped: true }
            : t,
        ),
      }));
  } catch {
    return [];
  }
}

export function saveConversations(key: string, conversations: Conversation[]): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(conversations));
    return true;
  } catch {
    return false;
  }
}

export type AgentSettings = { memory: boolean; subagents: boolean };

export function loadSettings(): AgentSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { memory: false, subagents: true };
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    return { memory: parsed.memory === true, subagents: parsed.subagents !== false };
  } catch {
    return { memory: false, subagents: true };
  }
}

export function saveSettings(settings: AgentSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

/** Parse an NDJSON response body into AgentEvents. */
export async function* readNdjson(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = parseLine(line);
          if (event) yield event;
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const last = buffer.trim();
    if (last) {
      const event = parseLine(last);
      if (event) yield event;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function parseLine(line: string): AgentEvent | null {
  try {
    const parsed = JSON.parse(line) as AgentEvent;
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") return parsed;
  } catch {
    /* skip malformed line */
  }
  return null;
}
