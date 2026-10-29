import type { AgentEvent, AgentRequest } from "./events";
import { ModelError, type AgentModelRole, type LlmMessage, type LlmToolCall, type ToolSpec } from "./llm";
import { buildSystemPrompt, SUBAGENT_PROMPT } from "./prompt";
import { approvalReason, connectorNeedsApproval, MAX_TOOL_RESULT_CHARS, truncate, wrapUntrusted } from "./safety";
import { buildConnectorToolTable, type ConnectorTool, type ConnectorToolTable } from "./tools/connectors";
import { defaultDeps, executeTool, labelFor, parseToolArguments, selectTools, toToolSpec, type AnyTool } from "./tools/index";
import { errorMessage, shortSummary, SourceRegistry, type AgentDeps, type RunState, type ToolContext, type ToolOutcome } from "./tools/types";

export const LIMITS = {
  maxRounds: 24,
  maxToolCalls: 60,
  wallClockMs: 280_000,
  /** Stop calling tools when less than this much wall-clock time remains. */
  finalizeReserveMs: 35_000,
  subagentRounds: 8,
  subagentToolCalls: 20,
};

export type RunAgentContext = {
  userId: string;
  emit(event: AgentEvent): void;
  signal: AbortSignal;
  /** Dependency overrides (tests, alternative providers). */
  deps?: Partial<AgentDeps>;
  /** Override limits (tests). */
  limits?: Partial<typeof LIMITS>;
};

type LoopOptions = {
  messages: LlmMessage[];
  tools: AnyTool[];
  connectors: ConnectorToolTable | null;
  maxRounds: number;
  maxToolCalls: number;
  role: AgentModelRole;
  state: RunState;
  depth: number;
  ctx: Omit<ToolContext, "callId" | "state">;
  streamText: boolean;
  finalizeReserveMs: number;
};

/** Truncates long string values so tool_call events stay small (artifacts are sent separately). */
function displayArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  return out;
}

function toModelContent(name: string, outcome: ToolOutcome) {
  return outcome.untrusted ? wrapUntrusted(name, outcome.content, MAX_TOOL_RESULT_CHARS) : truncate(outcome.content, MAX_TOOL_RESULT_CHARS);
}

async function runConnectorCall(
  table: ConnectorToolTable,
  name: string,
  args: Record<string, unknown>,
  ctx: Omit<ToolContext, "callId" | "state">,
): Promise<ToolOutcome> {
  const tool = table.byName.get(name) as ConnectorTool;
  try {
    const text = await ctx.deps.connectors.call(ctx.userId, tool.connectorId, tool.toolName, args);
    return { ok: true, summary: shortSummary(`${tool.connectorName}: ${text || "done"}`), content: text || "(empty result)", untrusted: true };
  } catch (error) {
    return { ok: false, summary: shortSummary(`${tool.connectorName} error: ${errorMessage(error)}`), content: `Connector error: ${errorMessage(error)}` };
  }
}

/** The shared model ↔ tools loop used by the main agent and its sub-agents. Returns the final text. */
async function runLoop(options: LoopOptions): Promise<string> {
  const { messages, tools, connectors, state, ctx, depth } = options;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs: ToolSpec[] = [...tools.map(toToolSpec), ...(connectors?.specs ?? [])];
  const seenIds = new Set<string>();
  let finalText = "";
  let textEmitted = false;
  let finalizing = false;

  for (let round = 1; round <= options.maxRounds; round++) {
    if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error("aborted");
    const remaining = state.deadline - Date.now();
    const mustFinish = round === options.maxRounds || remaining < options.finalizeReserveMs || state.toolCalls >= options.maxToolCalls;
    if (mustFinish && !finalizing) {
      finalizing = true;
      messages.push({
        role: "user",
        content: "[Prism system notice] The tool budget for this task is used up. Do not call tools. Write your final answer now using the information gathered so far, and say what remains unverified.",
      });
    }
    if (depth === 0) ctx.emit({ type: "status", text: round === 1 ? "Thinking…" : finalizing ? "Writing the answer…" : "Working…" });

    const roundSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(Math.max(5_000, remaining))]);
    let roundText = "";
    const result = await ctx.deps.model({
      role: options.role,
      messages,
      tools: finalizing ? [] : specs,
      signal: roundSignal,
      onText: options.streamText
        ? (delta) => {
            if (!roundText && textEmitted) ctx.emit({ type: "text", delta: "\n\n" });
            roundText += delta;
            ctx.emit({ type: "text", delta });
          }
        : undefined,
    });
    state.rounds++;
    if (roundText) textEmitted = true;
    if (result.content) finalText += (finalText ? "\n\n" : "") + result.content;

    if (!result.toolCalls.length || finalizing) return finalText;

    // Unique call ids (some providers reuse ids such as "call_0" every round).
    const calls: LlmToolCall[] = result.toolCalls.map((call, i) => {
      let id = call.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || `call_${round}_${i}`;
      while (seenIds.has(id)) id = `${id}_${round}${i}`;
      seenIds.add(id);
      return { ...call, id };
    });
    messages.push({ role: "assistant", content: result.content || null, tool_calls: calls });

    const runOne = async (call: LlmToolCall): Promise<string> => {
      const name = call.function.name;
      if (state.stop) return "Skipped: the run is paused waiting for the user.";
      if (state.toolCalls >= options.maxToolCalls) return "Skipped: tool call limit reached. Answer with what you have.";
      state.toolCalls++;
      const args = parseToolArguments(call.function.arguments);
      const builtin = byName.get(name);
      const connector = connectors?.byName.get(name);
      ctx.emit({ type: "tool_call", id: call.id, name, args: displayArgs(args ?? {}), label: connector ? `${connector.connectorName}: ${connector.title}` : labelFor(builtin, name, args ?? {}) });

      let outcome: ToolOutcome;
      if (!args) {
        outcome = { ok: false, summary: "Invalid JSON arguments.", content: "Your arguments were not valid JSON. Retry with a valid JSON object." };
      } else if (builtin) {
        outcome = await executeTool(builtin, args, { ...ctx, callId: call.id, state });
      } else if (connector && connectors) {
        if (connectorNeedsApproval(connector.annotations)) {
          ctx.emit({
            type: "approval_required",
            callId: call.id,
            tool: name,
            args,
            reason: approvalReason(connector.connectorName, connector.title, connector.annotations),
          });
          state.stop = "approval";
          outcome = { ok: true, summary: "Waiting for your approval.", content: "Paused: waiting for the user's approval." };
        } else {
          outcome = await runConnectorCall(connectors, name, args, ctx);
        }
      } else {
        outcome = { ok: false, summary: `Unknown tool ${name}.`, content: `Unknown tool "${name}". Available tools: ${[...byName.keys(), ...(connectors?.byName.keys() ?? [])].join(", ")}.` };
      }
      ctx.emit({ type: "tool_result", id: call.id, ok: outcome.ok, summary: shortSummary(outcome.summary), ...(outcome.data !== undefined ? { data: outcome.data } : {}) });
      return toModelContent(name, outcome);
    };

    const parallel = calls.length > 1 && calls.every((c) => byName.get(c.function.name)?.parallelSafe);
    const contents = parallel ? await Promise.all(calls.map(runOne)) : [];
    if (!parallel) for (const call of calls) contents.push(await runOne(call));
    calls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: contents[i] }));

    if (state.stop) return finalText;
  }
  return finalText;
}

function newState(sources: SourceRegistry, deadline: number): RunState {
  return { artifacts: new Map(), plan: [], sources, toolCalls: 0, rounds: 0, stop: null, deadline, artifactSeq: 0 };
}

/** Executes connector calls the user approved (or records declines) before the model continues. */
async function applyApprovals(
  approvals: NonNullable<AgentRequest["approvals"]>,
  table: ConnectorToolTable,
  messages: LlmMessage[],
  state: RunState,
  ctx: Omit<ToolContext, "callId" | "state">,
) {
  const calls: LlmToolCall[] = [];
  const results: string[] = [];
  const notes: string[] = [];
  for (const approval of approvals.slice(0, 10)) {
    if (!approval.tool || !approval.args) {
      notes.push(`Approval answer for ${approval.callId} arrived without the action details, so nothing was executed.`);
      continue;
    }
    const id = approval.callId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60) || `approved_${calls.length}`;
    calls.push({ id, type: "function", function: { name: approval.tool, arguments: JSON.stringify(approval.args) } });
    const connector = table.byName.get(approval.tool);
    if (!approval.approved) {
      ctx.emit({ type: "tool_call", id, name: approval.tool, args: displayArgs(approval.args), label: `${connector ? `${connector.connectorName}: ${connector.title}` : approval.tool} (declined)` });
      ctx.emit({ type: "tool_result", id, ok: false, summary: "You declined this action." });
      results.push("The user declined this action. Do not retry it. Continue without it, or ask what they would prefer.");
      continue;
    }
    if (!connector) {
      results.push(`Tool "${approval.tool}" is no longer available, so the approved action was not executed.`);
      continue;
    }
    state.toolCalls++;
    ctx.emit({ type: "tool_call", id, name: approval.tool, args: displayArgs(approval.args), label: `${connector.connectorName}: ${connector.title} (approved)` });
    const outcome = await runConnectorCall(table, approval.tool, approval.args, ctx);
    ctx.emit({ type: "tool_result", id, ok: outcome.ok, summary: outcome.summary });
    results.push(`User approved. ${toModelContent(approval.tool, outcome)}`);
  }
  if (calls.length) {
    messages.push({ role: "assistant", content: null, tool_calls: calls });
    calls.forEach((call, i) => messages.push({ role: "tool", tool_call_id: call.id, content: results[i] }));
  }
  messages.push({
    role: "user",
    content: `[Prism system notice] The user answered your approval request${notes.length ? `. ${notes.join(" ")}` : ""}. The results are above. Continue the task.`,
  });
}

function publicErrorMessage(error: unknown) {
  if (error instanceof ModelError) return error.message;
  if (error instanceof Error && /timed? ?out|TimeoutError/i.test(`${error.name} ${error.message}`)) {
    return "The task ran out of time. Try a narrower request or continue from here.";
  }
  return "The agent hit an unexpected error. Please try again.";
}

/** Runs one agent turn, streaming AgentEvents through ctx.emit. Always ends with `done` or `error` unless aborted. */
export async function runAgent(req: AgentRequest, ctx: RunAgentContext): Promise<void> {
  const limits = { ...LIMITS, ...ctx.limits };
  const deps: AgentDeps = { ...defaultDeps(), ...ctx.deps };
  const sources = new SourceRegistry(ctx.emit);
  const state = newState(sources, Date.now() + limits.wallClockMs);
  for (const artifact of req.artifacts ?? []) state.artifacts.set(artifact.id, artifact);
  state.artifactSeq = state.artifacts.size;
  const settings = { memory: req.settings?.memory === true, subagents: req.settings?.subagents !== false };
  const maxRounds = Math.min(Math.max(Math.trunc(req.settings?.maxRounds ?? limits.maxRounds), 1), limits.maxRounds);
  let subToolCalls = 0;
  let subRounds = 0;

  try {
    const tools = selectTools({ depth: 0, ...settings });
    const connectorList = await deps.connectors.list(ctx.userId).catch(() => [] as ConnectorTool[]);
    const table = buildConnectorToolTable(connectorList, tools.map((t) => t.name));
    const connectorSummary = [...new Map(connectorList.map((c) => [c.connectorId, c.connectorName])).entries()]
      .map(([id, name]) => ({ name, tools: connectorList.filter((c) => c.connectorId === id).length }));

    const baseCtx: Omit<ToolContext, "callId" | "state"> = {
      userId: ctx.userId,
      signal: ctx.signal,
      emit: ctx.emit,
      deps,
      settings,
      depth: 0,
      runSubagent: async (task, signal) => {
        const subState = newState(sources, state.deadline);
        const subMessages: LlmMessage[] = [
          { role: "system", content: SUBAGENT_PROMPT(deps.now()) },
          { role: "user", content: task },
        ];
        const report = await runLoop({
          messages: subMessages,
          tools: selectTools({ depth: 1, memory: false, subagents: false }),
          connectors: null,
          maxRounds: limits.subagentRounds,
          maxToolCalls: limits.subagentToolCalls,
          role: "research",
          state: subState,
          depth: 1,
          // Sub-agent events stay internal; only sources surface (via the shared registry).
          ctx: { ...baseCtx, signal, depth: 1, emit: () => undefined, runSubagent: undefined },
          streamText: false,
          finalizeReserveMs: limits.finalizeReserveMs,
        });
        subToolCalls += subState.toolCalls;
        subRounds += subState.rounds;
        if (!report.trim()) throw new Error("The sub-agent returned no report.");
        return { report, rounds: subState.rounds, toolCalls: subState.toolCalls };
      },
    };

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt({
          now: deps.now(),
          toolNames: [...tools.map((t) => t.name), ...table.byName.keys()],
          artifacts: [...state.artifacts.values()],
          connectors: connectorSummary,
          memory: settings.memory,
          subagents: settings.subagents,
        }),
      },
      ...req.messages.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    ];

    if (req.approvals?.length) await applyApprovals(req.approvals, table, messages, state, baseCtx);

    await runLoop({
      messages,
      tools,
      connectors: table,
      maxRounds,
      maxToolCalls: limits.maxToolCalls,
      role: "agent",
      state,
      depth: 0,
      ctx: baseCtx,
      streamText: true,
      finalizeReserveMs: limits.finalizeReserveMs,
    });
    ctx.emit({ type: "done", usage: { rounds: state.rounds + subRounds, toolCalls: state.toolCalls + subToolCalls } });
  } catch (error) {
    if (ctx.signal.aborted) return;
    if (!(error instanceof ModelError)) console.error("[prism-agent] run failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
    ctx.emit({ type: "error", message: publicErrorMessage(error) });
  }
}
