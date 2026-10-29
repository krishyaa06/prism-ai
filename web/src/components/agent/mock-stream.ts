// DEV-ONLY: simulated agent stream used by /agent?mock=1 (non-production) and
// /agent/preview so the workspace can be exercised without a model or server.
import type { AgentEvent, AgentRequest } from "@/lib/agent/events";

type MockRequest = Omit<AgentRequest, "approvals"> & {
  approvals?: { callId: string; approved: boolean; tool?: string; args?: Record<string, unknown> }[];
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const DASHBOARD_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Vector DB dashboard</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b1019;color:#e8f0fa;padding:24px}
h1{font-size:20px;margin:0 0 4px}p{color:#9aaabd;margin:0 0 20px;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:#111827;border:1px solid #263445;border-radius:12px;padding:14px}
.card b{display:block;font-size:22px;color:#52e0c4}.card span{font-size:12px;color:#9aaabd}
.bar{display:flex;align-items:center;gap:10px;margin:8px 0;font-size:13px}
.bar i{display:block;height:12px;border-radius:6px;background:linear-gradient(90deg,#52e0c4,#3aa0ff);transition:width .8s}
</style></head><body>
<h1>Vector database comparison</h1><p>p95 query latency at 1M vectors (lower is better). Illustrative numbers.</p>
<div class="grid"><div class="card"><b>3</b><span>databases compared</span></div><div class="card"><b>9 ms</b><span>best p95 latency</span></div><div class="card"><b>OSS</b><span>2 of 3 open source</span></div></div>
<div id="bars"></div>
<script>
const data=[["Qdrant",9],["Weaviate",14],["Pinecone",12]];
const max=Math.max(...data.map(d=>d[1]));
document.getElementById("bars").innerHTML=data.map(([n,v])=>'<div class="bar"><span style="width:80px">'+n+'</span><i style="width:0" data-w="'+(v/max*70)+'%"></i><span>'+v+' ms</span></div>').join("");
requestAnimationFrame(()=>document.querySelectorAll("i[data-w]").forEach(el=>el.style.width=el.dataset.w));
</script></body></html>`;

const REPORT_MD = `# Vector databases: Qdrant vs Weaviate vs Pinecone

## Summary
All three are production-ready. **Qdrant** leads on raw latency in public benchmarks [1], **Weaviate** has the richest hybrid search [2], and **Pinecone** is the simplest fully managed option [3].

| Database | License | Hosting | Hybrid search |
| --- | --- | --- | :---: |
| Qdrant | Apache-2.0 | Self-host / Cloud | Yes |
| Weaviate | BSD-3 | Self-host / Cloud | Yes |
| Pinecone | Proprietary | Managed only | Yes |

## Recommendation
1. Prototype on the managed tier you already use.
2. Benchmark with *your* embeddings before committing.
3. Prefer open source if data residency matters.

> Numbers vary heavily with index parameters; treat benchmarks as directional.
`;

const CSV = `database,p95_ms,recall_at_10,license
Qdrant,9,0.98,Apache-2.0
Weaviate,14,0.97,BSD-3
Pinecone,12,0.96,Proprietary
`;

const ANSWER = `Here is a comparison of the three most widely used vector databases.

## Key findings
- **Qdrant** posts the lowest p95 latency at 1M vectors in the published benchmark suite [1].
- **Weaviate** combines BM25 and vector search natively, which helps keyword-heavy queries [2].
- **Pinecone** is fully managed and serverless, so there is nothing to operate [3].

| Database | p95 latency | Open source | Best for |
| --- | ---: | :---: | --- |
| Qdrant | 9 ms | Yes | Low-latency self-hosting |
| Weaviate | 14 ms | Yes | Hybrid search |
| Pinecone | 12 ms | No | Zero-ops teams |

I computed the latency ranking with code:

\`\`\`javascript
const rows = [["Qdrant", 9], ["Weaviate", 14], ["Pinecone", 12]];
rows.sort((a, b) => a[1] - b[1]);
console.log(rows.map(([n]) => n).join(" < "));
\`\`\`

I also saved a full report (\`vector-db-report.md\`), the raw data (\`benchmarks.csv\`) and an interactive chart (\`dashboard.html\`) in the Files panel. See the [Qdrant benchmarks](https://qdrant.tech/benchmarks/) for methodology [1][2].`;

function lastUser(request: MockRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    if (request.messages[i].role === "user") return request.messages[i].content.toLowerCase();
  }
  return "";
}

async function* streamText(text: string, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const parts = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < parts.length; i += 3) {
    await sleep(28, signal);
    yield { type: "text", delta: parts.slice(i, i + 3).join("") };
  }
}

export async function* mockStream(request: MockRequest, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const prompt = lastUser(request);
  const approvals = request.approvals ?? [];

  if (prompt.includes("fail")) {
    yield { type: "status", text: "Contacting model…" };
    await sleep(700, signal);
    yield { type: "error", message: "Model endpoint returned 502 Bad Gateway (mock error)." };
    return;
  }

  if (prompt.includes("trip")) {
    yield { type: "status", text: "Thinking about your trip…" };
    await sleep(800, signal);
    yield { type: "question", text: "What kind of trip are you after? This changes the itinerary a lot.", options: ["Food and culture", "Temples and gardens", "Nightlife and shopping", "Relaxed, slow travel"] };
    yield { type: "done", usage: { rounds: 1, toolCalls: 0 } };
    return;
  }

  if (prompt.includes("github") || prompt.includes("connector")) {
    if (approvals.length) {
      const approved = approvals.some((a) => a.approved);
      yield { type: "status", text: approved ? "Posting the comment…" : "Skipping the comment…" };
      await sleep(500, signal);
      if (approved) {
        yield { type: "tool_call", id: "call_gh_2", name: "mcp__github__add_issue_comment", args: { owner: "krishyaa06", repo: "prism-ai", issue_number: 42, body: "Friendly ping: this PR is ready for review." }, label: "GitHub: comment on PR #42" };
        await sleep(700, signal);
        yield { type: "tool_result", id: "call_gh_2", ok: true, summary: "Comment created on krishyaa06/prism-ai#42." };
      }
      yield* streamText(
        approved
          ? "Done. I posted a review reminder on **PR #42**. The other two pull requests are drafts and need no action yet."
          : "Understood, I did **not** post anything. PR #42 is still waiting on a reviewer; the other two are drafts.",
        signal,
      );
      yield { type: "done", usage: { rounds: 2, toolCalls: 2 } };
      return;
    }
    yield { type: "plan", steps: [{ title: "List open pull requests", status: "in_progress" }, { title: "Summarize what needs attention", status: "pending" }, { title: "Ping reviewers if needed", status: "pending" }] };
    yield { type: "status", text: "Checking GitHub…" };
    yield { type: "tool_call", id: "call_gh_1", name: "mcp__github__list_pull_requests", args: { owner: "krishyaa06", repo: "prism-ai", state: "open" }, label: "GitHub: list open pull requests" };
    await sleep(900, signal);
    yield { type: "tool_result", id: "call_gh_1", ok: true, summary: "3 open pull requests: #42 agent-ui (ready), #40 docs (draft), #39 deps (draft)." };
    yield { type: "plan", steps: [{ title: "List open pull requests", status: "done" }, { title: "Summarize what needs attention", status: "done" }, { title: "Ping reviewers if needed", status: "in_progress" }] };
    await sleep(400, signal);
    yield { type: "approval_required", callId: "call_gh_2", tool: "mcp__github__add_issue_comment", args: { owner: "krishyaa06", repo: "prism-ai", issue_number: 42, body: "Friendly ping: this PR is ready for review." }, reason: "Posting a comment is visible to other people on GitHub." };
    return;
  }

  // Default: a rich research run.
  yield { type: "status", text: "Planning the task…" };
  await sleep(500, signal);
  const steps = ["Search for recent benchmarks", "Read primary sources", "Compute rankings with code", "Write report and chart"];
  const plan = (active: number) =>
    steps.map((title, index) => ({ title, status: index < active ? "done" : index === active ? "in_progress" : "pending" }) as const);
  yield { type: "plan", steps: plan(0) };
  yield { type: "status", text: "Searching the web…" };
  yield { type: "tool_call", id: "call_1", name: "web_search", args: { query: "vector database benchmark 2026 qdrant weaviate pinecone", max_results: 6 }, label: "Search: vector database benchmarks 2026" };
  await sleep(900, signal);
  yield { type: "source", id: 1, url: "https://qdrant.tech/benchmarks/", title: "Vector Database Benchmarks - Qdrant", snippet: "Open-source benchmark comparing latency, throughput and recall across engines." };
  yield { type: "source", id: 2, url: "https://weaviate.io/developers/weaviate/search/hybrid", title: "Hybrid search | Weaviate", snippet: "Hybrid search combines vector and BM25 keyword results with fusion." };
  yield { type: "source", id: 3, url: "https://docs.pinecone.io/guides/get-started/overview", title: "Pinecone documentation - Overview", snippet: "Pinecone is a fully managed, serverless vector database." };
  yield { type: "tool_result", id: "call_1", ok: true, summary: "Found 6 results; 3 high-quality primary sources." };

  if (request.settings?.subagents !== false) {
    yield { type: "plan", steps: plan(1) };
    yield { type: "status", text: "Dispatching 3 sub-agents…" };
    yield { type: "tool_call", id: "call_2", name: "spawn_subagents", args: { tasks: ["Qdrant performance and licensing", "Weaviate hybrid search", "Pinecone pricing and limits"] }, label: "Run 3 parallel researchers" };
    const tasks = ["Qdrant performance and licensing", "Weaviate hybrid search", "Pinecone pricing and limits"];
    for (let i = 0; i < tasks.length; i += 1) yield { type: "subagent", id: `sa_${i}`, task: tasks[i], status: "running" };
    await sleep(900, signal);
    yield { type: "subagent", id: "sa_0", task: tasks[0], status: "done", summary: "Apache-2.0; lowest p95 in published suite." };
    await sleep(500, signal);
    yield { type: "subagent", id: "sa_2", task: tasks[2], status: "done", summary: "Serverless pricing by read/write units." };
    await sleep(500, signal);
    yield { type: "subagent", id: "sa_1", task: tasks[1], status: "done", summary: "Native BM25 + vector fusion." };
    yield { type: "tool_result", id: "call_2", ok: true, summary: "3 of 3 sub-agents finished with reports." };
  }

  yield { type: "status", text: "Reading qdrant.tech…" };
  yield { type: "tool_call", id: "call_3", name: "fetch_url", args: { url: "https://qdrant.tech/benchmarks/" }, label: "Read qdrant.tech/benchmarks" };
  await sleep(700, signal);
  yield { type: "tool_result", id: "call_3", ok: true, summary: "Extracted 4,120 characters: methodology, datasets, latency tables." };

  yield { type: "plan", steps: plan(2) };
  yield { type: "status", text: "Running code…" };
  yield { type: "tool_call", id: "call_4", name: "run_code", args: { language: "javascript", code: "const rows=[['Qdrant',9],['Weaviate',14],['Pinecone',12]];\nrows.sort((a,b)=>a[1]-b[1]);\nconsole.log(rows.map(r=>r[0]).join(' < '))" }, label: "Run JavaScript: rank by latency" };
  await sleep(600, signal);
  yield { type: "tool_result", id: "call_4", ok: true, summary: "stdout: Qdrant < Pinecone < Weaviate" };

  if (request.settings?.memory) {
    yield { type: "tool_call", id: "call_m", name: "memory_search", args: { query: "vector database preferences" }, label: "Search memory" };
    await sleep(300, signal);
    yield { type: "tool_result", id: "call_m", ok: true, summary: "1 memory: prefers open-source, self-hosted tools." };
  }

  yield { type: "plan", steps: plan(3) };
  yield { type: "status", text: "Writing files…" };
  yield { type: "tool_call", id: "call_5", name: "create_file", args: { name: "vector-db-report.md", kind: "markdown" }, label: "Create vector-db-report.md" };
  await sleep(400, signal);
  yield { type: "artifact", artifact: { id: "art_report", name: "vector-db-report.md", kind: "markdown", content: REPORT_MD } };
  yield { type: "tool_result", id: "call_5", ok: true, summary: "Created vector-db-report.md (1.1 KB)." };
  yield { type: "tool_call", id: "call_6", name: "create_file", args: { name: "benchmarks.csv", kind: "csv" }, label: "Create benchmarks.csv" };
  await sleep(300, signal);
  yield { type: "artifact", artifact: { id: "art_csv", name: "benchmarks.csv", kind: "csv", content: CSV } };
  yield { type: "tool_result", id: "call_6", ok: true, summary: "Created benchmarks.csv (4 rows)." };
  yield { type: "tool_call", id: "call_7", name: "create_file", args: { name: "dashboard.html", kind: "html" }, label: "Create dashboard.html" };
  await sleep(400, signal);
  yield { type: "artifact", artifact: { id: "art_html", name: "dashboard.html", kind: "html", content: DASHBOARD_HTML } };
  yield { type: "tool_result", id: "call_7", ok: true, summary: "Created dashboard.html (interactive chart)." };

  yield { type: "plan", steps: steps.map((title) => ({ title, status: "done" as const })) };
  yield { type: "status", text: "Writing the answer…" };
  yield* streamText(ANSWER, signal);
  yield { type: "done", usage: { rounds: 6, toolCalls: 7 } };
}

export const MOCK_STATUS = {
  model: { configured: true, name: "mock-model (preview)" },
  search: { provider: "mock" },
  python: false,
  connectors: 1,
  memory: true,
};
