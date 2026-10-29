import type { z } from "zod";
import type { AgentEvent, Artifact, PlanStep } from "../events";
import type { ModelFn } from "../llm";
import type { SearchFn } from "./search";
import type { FetchPageFn } from "./fetch";
import type { RunCodeFn } from "./code";
import type { MemoryStore } from "./memory";
import type { ConnectorProvider } from "./connectors";

export type SourceInput = { url: string; title: string; snippet?: string };

/** Global, de-duplicated source numbering shared by the parent run and its sub-agents. */
export class SourceRegistry {
  private byUrl = new Map<string, number>();
  private items: Array<SourceInput & { id: number }> = [];
  constructor(private readonly emit: (event: AgentEvent) => void) {}

  add(source: SourceInput) {
    const key = source.url.replace(/#.*$/, "");
    const existing = this.byUrl.get(key);
    if (existing) return existing;
    const id = this.items.length + 1;
    const item = { id, url: source.url, title: (source.title || source.url).slice(0, 300), snippet: source.snippet?.slice(0, 500) };
    this.items.push(item);
    this.byUrl.set(key, id);
    this.emit({ type: "source", ...item });
    return id;
  }

  list() {
    return [...this.items];
  }
}

export type AgentDeps = {
  model: ModelFn;
  search: SearchFn;
  fetchPage: FetchPageFn;
  runCode: RunCodeFn;
  /** Returns null when memory storage is unavailable. */
  memory: () => MemoryStore | null;
  connectors: ConnectorProvider;
  now: () => Date;
};

export type RunState = {
  artifacts: Map<string, Artifact>;
  plan: PlanStep[];
  sources: SourceRegistry;
  toolCalls: number;
  rounds: number;
  stop: null | "question" | "approval";
  deadline: number;
  artifactSeq: number;
};

export type ToolContext = {
  userId: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  state: RunState;
  deps: AgentDeps;
  callId: string;
  settings: { memory: boolean; subagents: boolean };
  /** Depth 0 = main agent, 1 = sub-agent. */
  depth: number;
  /** Runs a restricted research sub-agent and resolves with its final report. Main agent only. */
  runSubagent?: (task: string, signal: AbortSignal) => Promise<{ report: string; rounds: number; toolCalls: number }>;
};

export type ToolOutcome = {
  ok: boolean;
  /** ≤ 300 chars, shown in the UI. */
  summary: string;
  /** Text fed back to the model. */
  content: string;
  /** Wrap `content` in an <untrusted> block. */
  untrusted?: boolean;
  data?: unknown;
};

export type ToolDef<Args = Record<string, unknown>> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType<Args>;
  label: (args: Args) => string;
  run: (args: Args, ctx: ToolContext) => Promise<ToolOutcome>;
  /** Safe to run concurrently with other parallel-safe calls in the same round. */
  parallelSafe?: boolean;
};

export function defineTool<Args>(def: ToolDef<Args>): ToolDef<Args> {
  return def;
}

export function shortSummary(text: string, max = 300) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown error";
}
