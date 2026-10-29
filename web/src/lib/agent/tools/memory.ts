import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { defineTool, errorMessage, shortSummary } from "./types";

export type MemoryRecord = { id: string; category: string; content: string; updated_at?: string };
export type MemoryStore = {
  search(userId: string, query: string): Promise<MemoryRecord[]>;
  save(userId: string, content: string, category: "preference" | "workflow" | "fact"): Promise<MemoryRecord>;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export function isMemoryConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** agent_memories-backed store (service role; always scoped by user_id). */
export function supabaseMemoryStore(): MemoryStore | null {
  if (!isMemoryConfigured()) return null;
  return {
    async search(userId, query) {
      const supabase = createSupabaseAdminClient();
      const base = () => supabase.from("agent_memories").select("id,category,content,updated_at").eq("user_id", userId);
      const { data, error } = await base().ilike("content", `%${escapeLike(query.trim())}%`).order("updated_at", { ascending: false }).limit(10);
      if (error) throw new Error("Could not search memory.");
      if (data?.length) return data as MemoryRecord[];
      const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 5);
      if (!terms.length) return [];
      const filter = terms.map((t) => `content.ilike.%${t}%`).join(",");
      const fallback = await base().or(filter).order("updated_at", { ascending: false }).limit(10);
      if (fallback.error) throw new Error("Could not search memory.");
      return (fallback.data ?? []) as MemoryRecord[];
    },
    async save(userId, content, category) {
      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("agent_memories")
        .insert({ user_id: userId, category, content, source: "task" })
        .select("id,category,content,updated_at")
        .single();
      if (error || !data) throw new Error("Could not save memory.");
      return data as MemoryRecord;
    },
  };
}

export const memorySearchTool = defineTool({
  name: "memory_search",
  description: "Search what the user previously asked Prism to remember (preferences, workflows, facts about them).",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  schema: z.object({ query: z.string().trim().min(1).max(200) }),
  label: (args) => `Checking memory for “${args.query.slice(0, 60)}”`,
  parallelSafe: true,
  run: async (args, ctx) => {
    const store = ctx.deps.memory();
    if (!store) return { ok: false, summary: "Memory is not configured.", content: "Memory storage is not configured on this server." };
    try {
      const rows = await store.search(ctx.userId, args.query);
      if (!rows.length) return { ok: true, summary: "No matching memories.", content: "No matching memories." };
      return {
        ok: true,
        summary: shortSummary(`${rows.length} memories found`),
        content: rows.map((r) => `- (${r.category}) ${r.content}`).join("\n"),
        untrusted: true,
      };
    } catch (error) {
      return { ok: false, summary: shortSummary(errorMessage(error)), content: errorMessage(error) };
    }
  },
});

export const memorySaveTool = defineTool({
  name: "memory_save",
  description:
    "Save a durable memory about the user (a preference, recurring workflow, or fact) when they ask you to remember something or clearly state a lasting preference. Never store secrets, passwords, or sensitive personal data.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "One concise sentence." },
      category: { type: "string", enum: ["preference", "workflow", "fact"] },
    },
    required: ["content", "category"],
    additionalProperties: false,
  },
  schema: z.object({
    content: z.string().trim().min(1).max(2000),
    category: z.enum(["preference", "workflow", "fact"]).catch("preference"),
  }),
  label: () => "Saving to memory",
  run: async (args, ctx) => {
    const store = ctx.deps.memory();
    if (!store) return { ok: false, summary: "Memory is not configured.", content: "Memory storage is not configured on this server." };
    if (/(password|passcode|api[_ -]?key|secret|token|\b\d{12,19}\b)/i.test(args.content)) {
      return { ok: false, summary: "Refused to store sensitive data.", content: "Refused: memories must not contain secrets, credentials or card numbers." };
    }
    try {
      const saved = await store.save(ctx.userId, args.content, args.category);
      return { ok: true, summary: shortSummary(`Remembered: ${saved.content}`), content: `Saved memory ${saved.id}.` };
    } catch (error) {
      return { ok: false, summary: shortSummary(errorMessage(error)), content: errorMessage(error) };
    }
  },
});
