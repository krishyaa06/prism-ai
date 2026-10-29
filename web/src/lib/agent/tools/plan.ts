import { z } from "zod";
import { defineTool } from "./types";

export const updatePlanTool = defineTool({
  name: "update_plan",
  description:
    "Show or update the visible step-by-step plan. Call it first for any multi-step task (2–8 short steps), then again as steps progress (mark one step in_progress at a time, done when finished). Always send the full list.",
  parameters: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "done"] },
          },
          required: ["title", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
  schema: z.object({
    steps: z.array(z.object({
      title: z.string().trim().min(1).max(160),
      status: z.enum(["pending", "in_progress", "done"]).catch("pending"),
    })).min(1).max(12),
  }),
  label: (args) => {
    const active = args.steps.find((s) => s.status === "in_progress");
    return active ? `Plan: ${active.title}` : "Updating plan";
  },
  run: async (args, ctx) => {
    ctx.state.plan = args.steps;
    ctx.emit({ type: "plan", steps: args.steps });
    const done = args.steps.filter((s) => s.status === "done").length;
    return { ok: true, summary: `${done}/${args.steps.length} steps done`, content: "Plan updated." };
  },
});
