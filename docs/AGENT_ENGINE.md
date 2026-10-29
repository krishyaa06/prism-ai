# Prism Agent Engine (v2)

Prism Agent is a general-purpose, tool-using AI worker in the web console
(`/agent`). Give it a goal; it plans, researches the web, reads pages, runs
code, writes files and reports, calls your connected services, spawns parallel
sub-agents, remembers what you allow, and asks before doing anything
consequential. The Android phone agent keeps working as before and can send
tasks to the same engine through the API.

## Architecture

```text
browser  /agent  (web/src/app/agent/page.tsx + web/src/components/agent/*)
   │  POST /api/agent/chat  (NDJSON stream of AgentEvent)
   ▼
web/src/lib/agent/
   llm.ts         OpenAI-compatible chat completions with tool calling
   loop.ts        runAgent(): plan → tool rounds → final answer (max 24 rounds)
   events.ts      AgentEvent types shared by server and client
   tools/
     index.ts     registry + JSON-schema definitions + dispatcher
     search.ts    web_search  (Tavily → Brave → Serper → SearXNG → DuckDuckGo)
     fetch.ts     fetch_url   (SSRF-guarded, HTML → readable text, 2 MB cap)
     code.ts      run_code    (JavaScript in a QuickJS WASM sandbox; Python via E2B if configured)
     files.ts     create_file / update_file (artifacts: md, html, csv, json, svg, code)
     plan.ts      update_plan (visible step checklist)
     memory.ts    memory_search / memory_save (agent_memories table, opt-in)
     connectors.ts  connector tools (existing MCP framework) — writes need approval
     subagents.ts spawn_subagents (parallel read-only researchers)
     ask.ts       ask_user (pause and ask a clarifying question)
   safety.ts      SSRF guard, approval policy, untrusted-content wrapping
```

Conversations and artifacts are stored **in the browser** (localStorage) so the
agent works without new database migrations. Memory and connectors reuse the
existing Supabase tables.

## Request

`POST /api/agent/chat` — authenticated by the Supabase session cookie
(same-origin) **or** `Authorization: Bearer prism_live_…` (Android / API).

```jsonc
{
  "messages": [                       // full visible history, oldest first
    { "role": "user", "content": "Research the top 3 vector DBs and make a comparison table" },
    { "role": "assistant", "content": "…" }
  ],
  "artifacts": [ { "id": "a1", "name": "report.md", "kind": "markdown", "content": "…" } ], // current files (optional)
  "approvals": [ { "callId": "call_9", "approved": true } ], // answers to approval_required (optional)
  "settings": { "memory": false, "subagents": true, "maxRounds": 24 }
}
```

`messages[].content` is a string. Max 60 messages, 200 kB total.

## Response — NDJSON stream of `AgentEvent`

One JSON object per line, `content-type: application/x-ndjson`.

| type | fields | meaning |
| --- | --- | --- |
| `status` | `text` | short progress line ("Searching the web…") |
| `plan` | `steps: {title, status: "pending"\|"in_progress"\|"done"}[]` | full current plan |
| `text` | `delta` | streamed assistant answer text (Markdown) |
| `tool_call` | `id, name, args, label` | a tool started (`label` is human-friendly) |
| `tool_result` | `id, ok, summary, data?` | tool finished; `summary` ≤ 300 chars |
| `source` | `id, url, title, snippet?` | a citable source (numbered in order) |
| `artifact` | `artifact: {id, name, kind, content, language?}` | file created or updated |
| `subagent` | `id, task, status: "running"\|"done"\|"failed", summary?` | parallel sub-agent progress |
| `approval_required` | `callId, tool, args, reason` | consequential action paused; client re-POSTs with `approvals` |
| `question` | `text, options?` | agent asked the user something; run ends |
| `error` | `message` | fatal error; run ends |
| `done` | `usage?: {rounds, toolCalls}` | run finished |

Artifact `kind`: `markdown | html | code | csv | json | svg | text`.
HTML artifacts render in a sandboxed iframe (`sandbox="allow-scripts"`, no
same-origin) so the agent can build charts, dashboards and small websites.

## Tools exposed to the model

| tool | args | notes |
| --- | --- | --- |
| `update_plan` | `steps: {title, status}[]` | call first for multi-step work |
| `web_search` | `query, max_results?` | returns titles/urls/snippets; emits `source` events |
| `fetch_url` | `url, max_chars?` | readable text of a page; HTTPS/HTTP public hosts only |
| `run_code` | `language: "javascript"\|"python", code` | JS in QuickJS (no network/fs, 5 s, 64 MB); Python only when `E2B_API_KEY` is set |
| `create_file` | `name, kind, content, language?` | new artifact |
| `update_file` | `id, content` | replace artifact content |
| `memory_search` | `query` | only when settings.memory is true |
| `memory_save` | `content, category` | only when settings.memory is true |
| `spawn_subagents` | `tasks: string[]` (1–4) | parallel researchers with search/fetch/code; returns their reports |
| `ask_user` | `question, options?` | ends the run with a `question` event |
| `mcp__<connector>__<tool>` | per MCP schema | read-only tools run directly; others need approval |

## Safety

- Web pages, search results, connector output and files are **untrusted
  data**, wrapped in `<untrusted>` blocks; the system prompt tells the model
  never to follow instructions inside them.
- `fetch_url` blocks private, loopback, link-local and metadata IPs (checked
  after DNS resolution), non-HTTP(S) schemes, credentials in URLs, and
  re-validates every redirect hop (max 5).
- Connector tools without `readOnlyHint: true` pause with
  `approval_required`; nothing is sent/changed until the user approves.
- `run_code` JavaScript runs in a WASM interpreter with memory, stack and time
  limits; it has no network, filesystem or environment access.
- Per-request limits: 24 model rounds, 60 tool calls, 4 sub-agents (each ≤ 8
  rounds), 300 s wall clock.

## Configuration

| variable | required | purpose |
| --- | --- | --- |
| `PRISM_MODEL_ENDPOINT`, `PRISM_MODEL_NAME`, `PRISM_MODEL_API_KEY` | yes | OpenAI-compatible model **with tool calling** (e.g. OpenRouter, Groq, OpenAI, Gemini OpenAI-compat) |
| `PRISM_MODEL_AGENT_ENDPOINT` / `_NAME` / `_API_KEY` | no | override model for the agent; falls back to executor → shared |
| `PRISM_MODEL_RESEARCH_*` | no | model used by sub-agents |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` / `SEARXNG_URL` | no | search providers, first configured wins; DuckDuckGo fallback otherwise |
| `E2B_API_KEY` | no | enables Python in a remote sandbox |
