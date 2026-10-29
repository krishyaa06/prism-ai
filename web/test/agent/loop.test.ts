import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, AgentRequest } from "../../src/lib/agent/events";
import { ModelError, type ModelCall, type ModelResult } from "../../src/lib/agent/llm";
import { runAgent } from "../../src/lib/agent/loop";
import { parseAgentRequest } from "../../src/lib/agent/schema";
import type { ConnectorTool } from "../../src/lib/agent/tools/connectors";
import type { AgentDeps } from "../../src/lib/agent/tools/types";

let callSeq = 0;
const tc = (name: string, args: Record<string, unknown>, id = `call_${++callSeq}`) =>
  ({ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } });

function harness(model: (call: ModelCall, index: number) => ModelResult | Promise<ModelResult>, overrides: Partial<AgentDeps> = {}) {
  const events: AgentEvent[] = [];
  const calls: ModelCall[] = [];
  const deps: Partial<AgentDeps> = {
    model: async (call) => {
      calls.push({ ...call, messages: [...call.messages] });
      return model(call, calls.length - 1);
    },
    search: async (query) => ({
      provider: "mock",
      results: [
        { title: `${query} — Guide`, url: "https://guide.example/a", snippet: "Guide snippet" },
        { title: `${query} — Docs`, url: "https://docs.example/b", snippet: "Docs snippet" },
      ],
    }),
    fetchPage: async (url) => ({ url, title: "Fetched", text: "page text", contentType: "text/html", truncated: false }),
    memory: () => null,
    connectors: { list: async () => [], call: async () => "ok" },
    now: () => new Date("2026-10-29T12:00:00Z"),
    ...overrides,
  };
  const run = (req: AgentRequest) => runAgent(req, { userId: "user-1", emit: (e) => events.push(e), signal: new AbortController().signal, deps });
  return { events, calls, run, types: () => events.filter((e) => e.type !== "status").map((e) => e.type) };
}

const text = (content: string): ModelResult => ({ content, toolCalls: [] });
const tools = (...toolCalls: ReturnType<typeof tc>[]): ModelResult => ({ content: "", toolCalls });

test("runAgent: plan → search → file → streamed answer emits the expected event sequence", async () => {
  const h = harness(async (call, i) => {
    if (i === 0) return tools(tc("update_plan", { steps: [{ title: "Research", status: "in_progress" }, { title: "Write report", status: "pending" }] }));
    if (i === 1) return tools(tc("web_search", { query: "vector databases" }));
    if (i === 2) return tools(tc("create_file", { name: "report.md", kind: "markdown", content: "# Report\nQdrant is fast [1]." }));
    call.onText?.("Done — see ");
    call.onText?.("report.md [1].");
    return text("Done — see report.md [1].");
  });
  await h.run({ messages: [{ role: "user", content: "Compare vector databases" }] });
  assert.deepEqual(h.types(), [
    "tool_call", "plan", "tool_result",
    "tool_call", "source", "source", "tool_result",
    "tool_call", "artifact", "tool_result",
    "text", "text", "done",
  ]);
  const sources = h.events.filter((e) => e.type === "source");
  assert.deepEqual(sources.map((s) => s.type === "source" && s.id), [1, 2]);
  const artifact = h.events.find((e) => e.type === "artifact");
  assert.ok(artifact?.type === "artifact" && artifact.artifact.name === "report.md" && artifact.artifact.kind === "markdown");
  const done = h.events.at(-1);
  assert.deepEqual(done, { type: "done", usage: { rounds: 4, toolCalls: 3 } });

  // System prompt has the date and tool results are wrapped as untrusted.
  const system = h.calls[0].messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content as string, /October 29, 2026/);
  const toolMsg = h.calls[2].messages.find((m) => m.role === "tool" && /Guide/.test(m.content));
  assert.match(toolMsg!.content as string, /^<untrusted source="web_search">[\s\S]*\[1\] vector databases — Guide/);
  // memory tools are hidden unless enabled; subagents on by default.
  const names = h.calls[0].tools.map((t) => t.function.name);
  assert.ok(names.includes("spawn_subagents") && !names.includes("memory_search"));
  const labels = h.events.filter((e) => e.type === "tool_call").map((e) => e.type === "tool_call" && e.label);
  assert.deepEqual(labels, ["Plan: Research", "Searching “vector databases”", "Creating report.md"]);
});

test("runAgent passes existing artifacts as context and update_file edits them", async () => {
  const h = harness(async (_call, i) => i === 0
    ? tools(tc("update_file", { id: "a1", content: "v2" }))
    : text("Updated."));
  await h.run({
    messages: [{ role: "user", content: "Change the file" }],
    artifacts: [{ id: "a1", name: "notes.md", kind: "markdown", content: "v1 original content" }],
  });
  assert.match(h.calls[0].messages[0].content as string, /id=a1 name=notes\.md[\s\S]*v1 original content/);
  const artifact = h.events.find((e) => e.type === "artifact");
  assert.ok(artifact?.type === "artifact" && artifact.artifact.id === "a1" && artifact.artifact.content === "v2");
});

const CONNECTORS: ConnectorTool[] = [
  { connectorId: "github", connectorName: "GitHub", toolName: "search_issues", title: "Search issues", description: "Find issues", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
  { connectorId: "github", connectorName: "GitHub", toolName: "create_issue", title: "Create issue", description: "Open an issue", inputSchema: { type: "object", properties: { title: { type: "string" } } }, annotations: {} },
];

test("connector tools: read-only runs directly, writes pause with approval_required", async () => {
  const executed: string[] = [];
  const h = harness(async () => tools(
    tc("mcp__github__search_issues", { q: "bug" }, "c_read"),
    tc("mcp__github__create_issue", { title: "Fix bug" }, "c_write"),
  ), { connectors: { list: async () => CONNECTORS, call: async (_u, _c, tool) => { executed.push(tool); return "result"; } } });
  await h.run({ messages: [{ role: "user", content: "File an issue" }] });
  assert.deepEqual(executed, ["search_issues"]);
  assert.deepEqual(h.types(), ["tool_call", "tool_result", "tool_call", "approval_required", "tool_result", "done"]);
  const approval = h.events.find((e) => e.type === "approval_required");
  assert.deepEqual(approval && approval.type === "approval_required" && { callId: approval.callId, tool: approval.tool, args: approval.args },
    { callId: "c_write", tool: "mcp__github__create_issue", args: { title: "Fix bug" } });
  assert.equal(h.calls.length, 1, "run ends after approval is requested");
});

test("approvals round-trip: approved calls run before the model continues; declines are noted", async () => {
  const executed: Array<[string, unknown]> = [];
  const connectors = { list: async () => CONNECTORS, call: async (_u: string, _c: string, tool: string, args: unknown) => { executed.push([tool, args]); return "Issue #42 created"; } };
  const approved = harness(() => text("Created issue #42."), { connectors });
  await approved.run({
    messages: [{ role: "user", content: "File an issue" }, { role: "assistant", content: "I need approval." }],
    approvals: [{ callId: "c_write", approved: true, tool: "mcp__github__create_issue", args: { title: "Fix bug" } }],
  });
  assert.deepEqual(executed, [["create_issue", { title: "Fix bug" }]]);
  const msgs = approved.calls[0].messages;
  const assistantCall = msgs.find((m) => m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length);
  assert.ok(assistantCall);
  const toolMsg = msgs.find((m) => m.role === "tool");
  assert.match(toolMsg!.content as string, /User approved[\s\S]*Issue #42 created/);
  assert.deepEqual(approved.types(), ["tool_call", "tool_result", "done"]);

  executed.length = 0;
  const declined = harness(() => text("Okay, I won't."), { connectors });
  await declined.run({
    messages: [{ role: "user", content: "File an issue" }],
    approvals: [{ callId: "c_write", approved: false, tool: "mcp__github__create_issue", args: { title: "Fix bug" } }],
  });
  assert.equal(executed.length, 0);
  assert.match(declined.calls[0].messages.find((m) => m.role === "tool")!.content as string, /declined/);
});

test("ask_user emits a question and ends the run", async () => {
  const h = harness(() => tools(tc("ask_user", { question: "Which region?", options: ["EU", "US"] }), tc("web_search", { query: "x" })));
  await h.run({ messages: [{ role: "user", content: "Find data centers" }] });
  assert.equal(h.calls.length, 1);
  const q = h.events.find((e) => e.type === "question");
  assert.deepEqual(q, { type: "question", text: "Which region?", options: ["EU", "US"] });
  assert.ok(!h.events.some((e) => e.type === "source"), "calls after ask_user are skipped");
  assert.equal(h.events.at(-1)?.type, "done");
});

test("spawn_subagents runs parallel researchers with globally numbered sources", async () => {
  const searchResults: Record<string, Array<{ title: string; url: string; snippet: string }>> = {
    alpha: [{ title: "A1", url: "https://a.example/1", snippet: "" }, { title: "Shared", url: "https://shared.example/", snippet: "" }],
    beta: [{ title: "B1", url: "https://b.example/1", snippet: "" }, { title: "Shared", url: "https://shared.example/", snippet: "" }],
  };
  const h = harness(async (call, i) => {
    if (call.role === "research") {
      const task = call.messages[1].content as string;
      const key = task.includes("alpha") ? "alpha" : "beta";
      const hasResults = call.messages.some((m) => m.role === "tool");
      if (!hasResults) return tools(tc("web_search", { query: key }));
      call.onText?.("SHOULD NOT STREAM");
      return text(`Report on ${key} [1].`);
    }
    if (i === 0) return tools(tc("spawn_subagents", { tasks: ["Research alpha", "Research beta"] }));
    return text("Synthesis.");
  }, { search: async (q) => ({ provider: "mock", results: searchResults[q] }) });
  await h.run({ messages: [{ role: "user", content: "Compare alpha and beta" }] });
  const sub = h.events.filter((e) => e.type === "subagent");
  assert.equal(sub.filter((e) => e.type === "subagent" && e.status === "running").length, 2);
  assert.equal(sub.filter((e) => e.type === "subagent" && e.status === "done").length, 2);
  const ids = h.events.filter((e) => e.type === "source").map((e) => e.type === "source" && e.id);
  assert.deepEqual([...ids].sort(), [1, 2, 3]);
  assert.ok(!h.events.some((e) => e.type === "text" && /SHOULD NOT STREAM/.test(e.delta)));
  const research = h.calls.filter((c) => c.role === "research");
  assert.deepEqual([...new Set(research[0].tools.map((t) => t.function.name))].sort(), ["fetch_url", "run_code", "web_search"]);
  const toolMsg = h.calls.at(-1)!.messages.find((m) => m.role === "tool");
  assert.match(toolMsg!.content as string, /Report on alpha[\s\S]*Report on beta/);
  const done = h.events.at(-1);
  assert.ok(done?.type === "done" && done.usage!.toolCalls === 3);
});

test("round limit forces a final answer without tools", async () => {
  const h = harness(async (call) => call.tools.length ? tools(tc("web_search", { query: "loop" })) : text("Final."));
  await h.run({ messages: [{ role: "user", content: "Keep searching" }], settings: { maxRounds: 3 } });
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].tools.length, 0);
  assert.match(h.calls[2].messages.at(-1)!.content as string, /tool budget/);
  assert.deepEqual(h.events.at(-1), { type: "done", usage: { rounds: 3, toolCalls: 2 } });
});

test("invalid tool arguments and unknown tools are reported back to the model", async () => {
  const h = harness(async (_c, i) => i === 0
    ? { content: "", toolCalls: [{ id: "bad", type: "function", function: { name: "web_search", arguments: "{not json" } }, tc("nope", {}), tc("fetch_url", {})] }
    : text("ok"));
  await h.run({ messages: [{ role: "user", content: "x" }] });
  const results = h.events.filter((e) => e.type === "tool_result");
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.type === "tool_result" && !r.ok));
  const toolMsgs = h.calls[1].messages.filter((m) => m.role === "tool").map((m) => m.content);
  assert.match(toolMsgs[0] as string, /not valid JSON/);
  assert.match(toolMsgs[1] as string, /Unknown tool/);
  assert.match(toolMsgs[2] as string, /Invalid arguments for fetch_url/);
});

test("model errors become a safe error event without leaking internals", async () => {
  const known = harness(() => { throw new ModelError("The model provider rejected the API key (HTTP 401)."); });
  await known.run({ messages: [{ role: "user", content: "x" }] });
  assert.deepEqual(known.events.at(-1), { type: "error", message: "The model provider rejected the API key (HTTP 401)." });
  const original = console.error;
  console.error = () => undefined;
  const unknown = harness(() => { throw new Error("db password=secret123 at /srv/app.js:10"); });
  await unknown.run({ messages: [{ role: "user", content: "x" }] });
  console.error = original;
  const last = unknown.events.at(-1);
  assert.ok(last?.type === "error" && !/secret123|app\.js/.test(last.message));
});

test("request schema enforces message, size and approval limits", () => {
  assert.equal(parseAgentRequest({ messages: [{ role: "user", content: "hi" }] }).ok, true);
  assert.equal(parseAgentRequest({ messages: [] }).ok, false);
  assert.equal(parseAgentRequest({ messages: Array.from({ length: 61 }, () => ({ role: "user", content: "x" })) }).ok, false);
  assert.equal(parseAgentRequest({ messages: [{ role: "user", content: "x".repeat(150_000) }, { role: "assistant", content: "y".repeat(60_000) }] }).ok, false);
  assert.equal(parseAgentRequest({ messages: [{ role: "system", content: "x" }] }).ok, false);
  assert.equal(parseAgentRequest({ messages: [{ role: "user", content: "x" }], approvals: [{ callId: "c", approved: true, tool: "bad name!" }] }).ok, false);
  assert.equal(parseAgentRequest({ messages: [{ role: "user", content: "x" }], settings: { maxRounds: 99 } }).ok, false);
});
