import { z } from "zod";
import { defineTool } from "./types";

export const askUserTool = defineTool({
  name: "ask_user",
  description:
    "Ask the user a clarifying question when the request is ambiguous in a way that materially changes the result, or when you need information only they have. Ends your turn; the user's reply arrives as the next message. Prefer reasonable assumptions for minor details.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array", items: { type: "string" }, maxItems: 6, description: "Optional quick-reply choices." },
    },
    required: ["question"],
    additionalProperties: false,
  },
  schema: z.object({
    question: z.string().trim().min(1).max(1000),
    options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
  }),
  label: () => "Asking you a question",
  run: async (args, ctx) => {
    ctx.emit({ type: "question", text: args.question, ...(args.options?.length ? { options: args.options } : {}) });
    ctx.state.stop = "question";
    return { ok: true, summary: "Waiting for your answer.", content: "Question shown to the user. Stop now and wait for their reply." };
  },
});
