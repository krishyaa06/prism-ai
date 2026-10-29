import type { ToolSpec } from "../llm";
import { callChatModel } from "../llm";
import { askUserTool } from "./ask";
import { runCode, runCodeTool } from "./code";
import { mcpConnectorProvider } from "./connectors";
import { fetchPage, fetchUrlTool } from "./fetch";
import { createFileTool, updateFileTool } from "./files";
import { memorySaveTool, memorySearchTool, supabaseMemoryStore } from "./memory";
import { updatePlanTool } from "./plan";
import { webSearch, webSearchTool } from "./search";
import { spawnSubagentsTool } from "./subagents";
import { errorMessage, shortSummary, type AgentDeps, type ToolContext, type ToolDef, type ToolOutcome } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

export const BUILTIN_TOOLS: AnyTool[] = [
  updatePlanTool,
  webSearchTool,
  fetchUrlTool,
  runCodeTool,
  createFileTool,
  updateFileTool,
  memorySearchTool,
  memorySaveTool,
  spawnSubagentsTool,
  askUserTool,
];

export const SUBAGENT_TOOL_NAMES = new Set(["web_search", "fetch_url", "run_code"]);

export function selectTools(options: { depth: number; memory: boolean; subagents: boolean }): AnyTool[] {
  if (options.depth > 0) return BUILTIN_TOOLS.filter((tool) => SUBAGENT_TOOL_NAMES.has(tool.name));
  return BUILTIN_TOOLS.filter((tool) => {
    if (tool.name.startsWith("memory_")) return options.memory;
    if (tool.name === "spawn_subagents") return options.subagents;
    return true;
  });
}

export function toToolSpec(tool: AnyTool): ToolSpec {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export function defaultDeps(): AgentDeps {
  return {
    model: callChatModel,
    search: webSearch,
    fetchPage,
    runCode,
    memory: supabaseMemoryStore,
    connectors: mcpConnectorProvider,
    now: () => new Date(),
  };
}

export function parseToolArguments(raw: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Validates arguments and runs a built-in tool; never throws. */
export async function executeTool(tool: AnyTool, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, summary: shortSummary(`Invalid arguments: ${issues}`), content: `Invalid arguments for ${tool.name}: ${issues}. Fix them and try again.` };
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return { ok: false, summary: shortSummary(`${tool.name} failed: ${errorMessage(error)}`), content: `${tool.name} failed: ${errorMessage(error)}` };
  }
}

export function labelFor(tool: AnyTool | undefined, name: string, args: Record<string, unknown>) {
  if (!tool) return name;
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) return tool.name.replace(/_/g, " ");
  try {
    return tool.label(parsed.data).slice(0, 120);
  } catch {
    return tool.name;
  }
}
