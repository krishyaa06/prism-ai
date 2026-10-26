"use client";

import type { Message, Settings } from "./store";

export type StreamMeta = { mode: string; provider: string; model: string };

/** Streams an assistant reply from /api/chat. Calls onDelta with the full text so far. */
export async function streamChat(opts: {
  messages: Message[];
  settings: Settings;
  context?: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onMeta?: (meta: StreamMeta) => void;
}) {
  const { settings } = opts;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: opts.signal,
    body: JSON.stringify({
      messages: opts.messages
        .filter((m) => !m.error)
        .map(({ role, content }) => ({ role, content })),
      context: opts.context,
      provider: settings.provider,
      apiKey: settings.apiKey || undefined,
      model: settings.model || undefined,
    }),
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }

  opts.onMeta?.({
    mode: res.headers.get("X-Prism-Mode") ?? "live",
    provider: res.headers.get("X-Prism-Provider") ?? "",
    model: res.headers.get("X-Prism-Model") ?? "",
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    opts.onDelta(text);
  }
  text += decoder.decode();
  if (!text.trim()) throw new Error("The model returned an empty answer. Try again.");
  opts.onDelta(text);
  return text;
}

export const AI_ACTIONS = [
  { id: "summarize", label: "Summarize", prompt: "Summarize this document in 3-5 bullet points, then list the key takeaways." },
  { id: "improve", label: "Improve writing", prompt: "Rewrite this document to be clearer and more concise. Keep the Markdown structure." },
  { id: "outline", label: "Make an outline", prompt: "Turn this document into a structured outline with headings and bullet points." },
  { id: "questions", label: "Ask questions", prompt: "What are the 5 most important open questions or gaps in this document?" },
] as const;
