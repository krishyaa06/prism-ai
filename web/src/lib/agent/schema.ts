import { z } from "zod";
import type { AgentRequest } from "./events";

export const MAX_MESSAGES = 60;
export const MAX_MESSAGE_BYTES = 200_000;
export const MAX_ARTIFACTS = 30;
export const MAX_ARTIFACT_CHARS = 400_000;
export const MAX_BODY_BYTES = 4_000_000;

const artifactSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["markdown", "html", "code", "csv", "json", "svg", "text"]),
  content: z.string().max(MAX_ARTIFACT_CHARS),
  language: z.string().max(40).optional(),
});

export const agentRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_MESSAGE_BYTES),
  })).min(1).max(MAX_MESSAGES)
    .refine((messages) => messages.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0) <= MAX_MESSAGE_BYTES, {
      message: `Conversation exceeds ${MAX_MESSAGE_BYTES / 1000} kB.`,
    })
    .refine((messages) => messages.some((m) => m.role === "user" && m.content.trim()), { message: "At least one user message is required." }),
  artifacts: z.array(artifactSchema).max(MAX_ARTIFACTS).optional(),
  approvals: z.array(z.object({
    callId: z.string().min(1).max(100),
    approved: z.boolean(),
    tool: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
  })).max(10).optional(),
  settings: z.object({
    memory: z.boolean().optional(),
    subagents: z.boolean().optional(),
    maxRounds: z.number().int().min(1).max(24).optional(),
  }).optional(),
});

export function parseAgentRequest(value: unknown): { ok: true; data: AgentRequest } | { ok: false; message: string } {
  const parsed = agentRequestSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Invalid request: ${issue ? `${issue.path.join(".") || "body"} — ${issue.message}` : "malformed body"}` };
  }
  return { ok: true, data: parsed.data as AgentRequest };
}
