import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callChatModel, readChatStream, resolveAgentModel } from "../../src/lib/agent/llm";

const realFetch = globalThis.fetch;
const ENV_KEYS = ["PRISM_MODEL_ENDPOINT", "PRISM_MODEL_NAME", "PRISM_MODEL_API_KEY", "PRISM_MODEL_AGENT_ENDPOINT", "PRISM_MODEL_AGENT_NAME", "PRISM_MODEL_EXECUTOR_NAME", "PRISM_MODEL_RESEARCH_NAME"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function sse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

const STREAM = [
  'data: {"choices":[{"delta":{"content":"Let me "}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"check."}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"web_search","arguments":""}}]}}]}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"argu',
  'ments":"\\"vector dbs\\"}"}},{"index":1,"id":"call_b","function":{"name":"fetch_url","arguments":"{\\"url\\":\\"https://x.dev\\"}"}}]}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
];

test("readChatStream accumulates text deltas and fragmented tool calls", async () => {
  const deltas: string[] = [];
  const result = await readChatStream(sse(STREAM), (d) => deltas.push(d));
  assert.deepEqual(deltas, ["Let me ", "check."]);
  assert.equal(result.content, "Let me check.");
  assert.equal(result.finishReason, "tool_calls");
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5 });
  assert.deepEqual(result.toolCalls.map((c) => [c.id, c.function.name, JSON.parse(c.function.arguments)]), [
    ["call_a", "web_search", { query: "vector dbs" }],
    ["call_b", "fetch_url", { url: "https://x.dev" }],
  ]);
});

test("model resolution prefers AGENT, then EXECUTOR, then shared settings", () => {
  process.env.PRISM_MODEL_ENDPOINT = "https://shared.example/v1";
  process.env.PRISM_MODEL_NAME = "shared-model";
  process.env.PRISM_MODEL_EXECUTOR_NAME = "executor-model";
  assert.equal(resolveAgentModel("agent").model, "executor-model");
  assert.equal(resolveAgentModel("agent").endpoint.toString(), "https://shared.example/v1/chat/completions");
  process.env.PRISM_MODEL_AGENT_NAME = "agent-model";
  assert.equal(resolveAgentModel("agent").model, "agent-model");
  process.env.PRISM_MODEL_RESEARCH_NAME = "research-model";
  assert.equal(resolveAgentModel("research").model, "research-model");
});

test("callChatModel streams with tools, tool_choice auto and OpenRouter headers", async () => {
  process.env.PRISM_MODEL_ENDPOINT = "https://openrouter.ai/api/v1";
  process.env.PRISM_MODEL_NAME = "some/model";
  process.env.PRISM_MODEL_API_KEY = "sk-test";
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen = { url: url.toString(), headers: init!.headers as Record<string, string>, body: JSON.parse(init!.body as string) };
    return new Response(sse(STREAM), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const result = await callChatModel({
    role: "agent",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "web_search", description: "d", parameters: { type: "object" } } }],
    signal: new AbortController().signal,
  });
  assert.equal(seen!.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen!.headers["X-Title"], "Prism");
  assert.equal(seen!.headers.authorization, "Bearer sk-test");
  assert.equal(seen!.body.tool_choice, "auto");
  assert.equal(seen!.body.stream, true);
  assert.equal(result.toolCalls.length, 2);
});

test("callChatModel explains 400 tool errors and retries 5xx", async () => {
  process.env.PRISM_MODEL_ENDPOINT = "https://api.example.com/v1";
  process.env.PRISM_MODEL_NAME = "m";
  globalThis.fetch = (async () => new Response('{"error":{"message":"tools is not supported for this model"}}', { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(
    callChatModel({ role: "agent", messages: [], tools: [], signal: new AbortController().signal }),
    /requires a model that supports tool calling/,
  );
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const result = await callChatModel({ role: "agent", messages: [], tools: [], signal: new AbortController().signal });
  assert.equal(calls, 2);
  assert.equal(result.content, "ok");
});
