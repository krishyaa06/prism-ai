// Shared between the server engine and the browser workspace. See docs/AGENT_ENGINE.md.
export type ArtifactKind = "markdown" | "html" | "code" | "csv" | "json" | "svg" | "text";

export type Artifact = {
  id: string;
  name: string;
  kind: ArtifactKind;
  content: string;
  language?: string;
};

export type PlanStep = { title: string; status: "pending" | "in_progress" | "done" };

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; label: string }
  | { type: "tool_result"; id: string; ok: boolean; summary: string; data?: unknown }
  | { type: "source"; id: number; url: string; title: string; snippet?: string }
  | { type: "artifact"; artifact: Artifact }
  | { type: "subagent"; id: string; task: string; status: "running" | "done" | "failed"; summary?: string }
  | { type: "approval_required"; callId: string; tool: string; args: Record<string, unknown>; reason: string }
  | { type: "question"; text: string; options?: string[] }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { rounds: number; toolCalls: number } };

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AgentRequest = {
  messages: ChatMessage[];
  artifacts?: Artifact[];
  approvals?: { callId: string; approved: boolean; tool?: string; args?: Record<string, unknown> }[];
  settings?: { memory?: boolean; subagents?: boolean; maxRounds?: number };
};
