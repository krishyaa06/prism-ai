import { resolveModelEndpoint } from "@/lib/model";

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelUsage = { promptTokens?: number; completionTokens?: number };

export type ModelResult = { content: string; toolCalls: LlmToolCall[]; usage?: ModelUsage; finishReason?: string };

export type AgentModelRole = "agent" | "research";

export type ModelCall = {
  role: AgentModelRole;
  messages: LlmMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText?: (delta: string) => void;
  maxTokens?: number;
};

/** Pluggable model function so the loop can be tested with a fake model. */
export type ModelFn = (call: ModelCall) => Promise<ModelResult>;

export class ModelError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ModelError";
  }
}

const CHAINS: Record<AgentModelRole, string[]> = {
  agent: ["PRISM_MODEL_AGENT_", "PRISM_MODEL_EXECUTOR_", "PRISM_MODEL_"],
  research: ["PRISM_MODEL_RESEARCH_", "PRISM_MODEL_AGENT_", "PRISM_MODEL_EXECUTOR_", "PRISM_MODEL_"],
};

function pick(role: AgentModelRole, suffix: "ENDPOINT" | "NAME" | "API_KEY") {
  for (const prefix of CHAINS[role]) {
    const value = process.env[`${prefix}${suffix}`];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function resolveAgentModel(role: AgentModelRole) {
  const raw = pick(role, "ENDPOINT");
  if (!raw) throw new ModelError("No model is configured. Set PRISM_MODEL_ENDPOINT, PRISM_MODEL_NAME and PRISM_MODEL_API_KEY.");
  const endpoint = resolveModelEndpoint(raw, role === "agent" ? "executor" : "research");
  return { endpoint, model: pick(role, "NAME") ?? "prism", apiKey: pick(role, "API_KEY") };
}

export function isModelConfigured() {
  try {
    resolveAgentModel("agent");
    return true;
  } catch {
    return false;
  }
}

const REQUEST_TIMEOUT_MS = 120_000;
const FIRST_BYTE_TIMEOUT_MS = 60_000;
const RETRIES = 2;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });

type StreamChoiceDelta = {
  content?: string | null;
  tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
};

/** Accumulates streamed (or complete) OpenAI-style tool call fragments. */
export class ToolCallAccumulator {
  private calls: Array<{ id: string; name: string; arguments: string }> = [];

  add(deltas: NonNullable<StreamChoiceDelta["tool_calls"]>) {
    deltas.forEach((delta, position) => {
      const index = typeof delta.index === "number" ? delta.index : position;
      const current = this.calls[index] ?? (this.calls[index] = { id: "", name: "", arguments: "" });
      if (delta.id) current.id = delta.id;
      if (delta.function?.name) {
        // Most providers send the name once; some resend the full name each chunk.
        const name = delta.function.name;
        if (!current.name || name.startsWith(current.name)) current.name = name;
        else if (name !== current.name) current.name += name;
      }
      if (typeof delta.function?.arguments === "string") current.arguments += delta.function.arguments;
    });
  }

  result(): LlmToolCall[] {
    return this.calls
      .filter((call) => call && call.name)
      .map((call, i) => ({
        id: call.id || `call_${Date.now().toString(36)}_${i}`,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments || "{}" },
      }));
  }
}

/** Parses an SSE body from /chat/completions with stream:true. */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onText: ((delta: string) => void) | undefined,
): Promise<ModelResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const tools = new ToolCallAccumulator();
  let buffer = "";
  let content = "";
  let usage: ModelUsage | undefined;
  let finishReason: string | undefined;

  const handle = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: {
      choices?: Array<{ delta?: StreamChoiceDelta; message?: StreamChoiceDelta; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) throw new ModelError(`Model stream error: ${String(chunk.error.message ?? "unknown").slice(0, 300)}`);
    if (chunk.usage) usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens };
    const choice = chunk.choices?.[0];
    if (!choice) return;
    const delta = choice.delta ?? choice.message;
    if (delta?.content) {
      content += delta.content;
      onText?.(delta.content);
    }
    if (delta?.tool_calls?.length) tools.add(delta.tool_calls);
    if (choice.finish_reason) finishReason = choice.finish_reason;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) handle(buffer);
  return { content, toolCalls: tools.result(), usage, finishReason };
}

function parseCompletionJson(payload: unknown, onText?: (delta: string) => void): ModelResult {
  const choice = (payload as { choices?: Array<{ message?: StreamChoiceDelta & { content?: unknown }; finish_reason?: string }> })
    ?.choices?.[0];
  const raw = choice?.message?.content;
  const content = typeof raw === "string"
    ? raw
    : Array.isArray(raw) ? (raw as Array<{ text?: string }>).map((p) => p?.text ?? "").join("") : "";
  if (content) onText?.(content);
  const tools = new ToolCallAccumulator();
  if (choice?.message?.tool_calls) tools.add(choice.message.tool_calls);
  const u = (payload as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return {
    content,
    toolCalls: tools.result(),
    finishReason: choice?.finish_reason,
    usage: u ? { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens } : undefined,
  };
}

function describeHttpError(status: number, bodyText: string) {
  const lower = bodyText.toLowerCase();
  if (status === 400 && /tool|function/.test(lower)) {
    return "The configured model rejected the tool definitions. Prism Agent requires a model that supports tool calling (function calling) — choose a tool-capable model in PRISM_MODEL_AGENT_NAME or PRISM_MODEL_NAME.";
  }
  if (status === 401 || status === 403) return `The model provider rejected the API key (HTTP ${status}).`;
  if (status === 404) return "The model endpoint or model name was not found (HTTP 404).";
  if (status === 429) return "The model provider is rate limiting requests (HTTP 429). Try again shortly.";
  return `The model provider returned HTTP ${status}.`;
}

export const callChatModel: ModelFn = async ({ role, messages, tools, signal, onText, maxTokens }) => {
  const { endpoint, model, apiKey } = resolveAgentModel(role);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream, application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (endpoint.hostname === "openrouter.ai" || endpoint.hostname.endsWith(".openrouter.ai")) {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_SITE_URL || "https://prism.local";
    headers["X-Title"] = "Prism";
  }
  const body = JSON.stringify({
    model,
    messages,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    stream: true,
    temperature: 0.2,
    max_tokens: maxTokens ?? 4096,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const total = setTimeout(() => controller.abort(new ModelError("The model request timed out.")), REQUEST_TIMEOUT_MS);
    const firstByte = setTimeout(() => controller.abort(new ModelError("The model did not respond in time.")), FIRST_BYTE_TIMEOUT_MS);
    let streamed = false;
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers, body, cache: "no-store", redirect: "error", signal: controller.signal,
      });
      clearTimeout(firstByte);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = new ModelError(describeHttpError(response.status, text), response.status);
        if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
          lastError = error;
          const retryAfter = Number(response.headers.get("retry-after"));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 600 * (attempt + 1) ** 2, signal);
          continue;
        }
        throw error;
      }
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("application/json") || !response.body) {
        return parseCompletionJson(await response.json(), onText);
      }
      const wrapped = onText ? (d: string) => { streamed = true; onText(d); } : undefined;
      return await readChatStream(response.body, wrapped);
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      if (error instanceof ModelError && error.status) throw error;
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      lastError = reason instanceof ModelError ? reason : new ModelError("Could not reach the model provider.");
      // Never retry after text was already forwarded to the user.
      if (streamed || attempt >= RETRIES) throw lastError;
      await sleep(600 * (attempt + 1) ** 2, signal);
    } finally {
      clearTimeout(total);
      clearTimeout(firstByte);
      signal.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new ModelError("Model request failed.");
};
