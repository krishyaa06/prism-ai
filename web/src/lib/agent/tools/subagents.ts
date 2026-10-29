import { z } from "zod";
import { wrapUntrusted } from "../safety";
import { defineTool, errorMessage, shortSummary } from "./types";

export const MAX_SUBAGENTS = 4;

export const spawnSubagentsTool = defineTool({
  name: "spawn_subagents",
  description:
    "Run 1–4 research sub-agents in parallel, each with web_search, fetch_url and run_code. Use for wide research (e.g. one sub-agent per company, product, city or sub-question). Give each a self-contained task with exactly what to find and return. Returns their reports; their sources are already numbered for citation.",
  parameters: {
    type: "object",
    properties: {
      tasks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_SUBAGENTS },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
  schema: z.object({ tasks: z.array(z.string().trim().min(3).max(2000)).min(1).max(MAX_SUBAGENTS) }),
  label: (args) => `Starting ${args.tasks.length} parallel researcher${args.tasks.length === 1 ? "" : "s"}`,
  run: async (args, ctx) => {
    const spawn = ctx.runSubagent;
    if (!spawn || ctx.depth > 0) {
      return { ok: false, summary: "Sub-agents are unavailable here.", content: "Sub-agents cannot be spawned in this context; do the research yourself." };
    }
    const settled = await Promise.all(args.tasks.map(async (task, index) => {
      const id = `${ctx.callId}_s${index + 1}`;
      ctx.emit({ type: "subagent", id, task, status: "running" });
      try {
        const result = await spawn(task, ctx.signal);
        ctx.emit({ type: "subagent", id, task, status: "done", summary: shortSummary(result.report, 300) });
        return { task, ok: true, report: result.report };
      } catch (error) {
        ctx.emit({ type: "subagent", id, task, status: "failed", summary: shortSummary(errorMessage(error)) });
        return { task, ok: false, report: `Failed: ${errorMessage(error)}` };
      }
    }));
    const okCount = settled.filter((s) => s.ok).length;
    const content = settled
      .map((s, i) => `## Sub-agent ${i + 1}: ${s.task}\n${wrapUntrusted(`subagent ${i + 1}`, s.report, 6_000)}`)
      .join("\n\n");
    return {
      ok: okCount > 0,
      summary: `${okCount}/${settled.length} sub-agents finished`,
      content,
      data: { reports: settled.map((s) => ({ task: s.task, ok: s.ok })) },
    };
  },
});
