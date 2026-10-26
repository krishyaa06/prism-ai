"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Doc = {
  id: string;
  title: string;
  content: string;
  tag: DocTag;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
};

export type DocTag = "Research" | "Project" | "Planning" | "Personal";
export const DOC_TAGS: DocTag[] = ["Research", "Project", "Planning", "Personal"];

export type Idea = { id: string; text: string; done: boolean; createdAt: number };

export type Message = { role: "user" | "assistant"; content: string; error?: boolean };
export type Chat = { id: string; title: string; messages: Message[]; updatedAt: number };

export type ProviderId = "openai" | "groq" | "gemini" | "openrouter";
export type Settings = {
  name: string;
  provider: ProviderId;
  apiKey: string;
  model: string;
};

export const PROVIDER_INFO: Record<ProviderId, { label: string; model: string; keyUrl: string }> = {
  groq: { label: "Groq (free)", model: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  gemini: { label: "Google Gemini (free)", model: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey" },
  openai: { label: "OpenAI", model: "gpt-4.1-mini", keyUrl: "https://platform.openai.com/api-keys" },
  openrouter: { label: "OpenRouter", model: "openai/gpt-4o-mini", keyUrl: "https://openrouter.ai/keys" },
};

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const now = Date.now();
const H = 3_600_000;

export const SEED_DOCS: Doc[] = [
  {
    id: "welcome",
    title: "Welcome to Prism AI",
    tag: "Personal",
    pinned: true,
    createdAt: now - 2 * H,
    updatedAt: now - 2 * H,
    content: `# Welcome to Prism AI

Prism is your workspace for documents, ideas and AI-assisted thinking. Everything you create is saved in this browser.

## Try this
- Press **Ctrl/⌘ + K** to search everything.
- Open the **AI Assistant** and ask a question.
- Click **Ask AI** on any document to summarize or improve it.
- Capture quick thoughts in **Ideas** and turn them into documents.

## Markdown works
Use # headings, **bold**, *italic*, \`inline code\`, lists and code blocks.`,
  },
  {
    id: "ai-workflows",
    title: "Building reliable AI workflows",
    tag: "Research",
    pinned: false,
    createdAt: now - 26 * H,
    updatedAt: now - 20 * 60_000,
    content: `# Building reliable AI workflows

Reliable AI features start with a clear task definition. Each prompt should have one job, a defined input and an expected output format.

Grounding answers in your own documents reduces hallucinations. Retrieval adds the right context at the right time, so the model answers from facts instead of guesses.

Evaluation matters more than prompt tricks. Keep a small set of test questions and check every change against them before shipping.

Finally, keep API keys on the server and add rate limits, so a public demo cannot drain your credits.`,
  },
  {
    id: "design-systems",
    title: "Product design systems",
    tag: "Project",
    pinned: false,
    createdAt: now - 50 * H,
    updatedAt: now - 30 * H,
    content: `# Product design systems

A design system is a shared language of tokens, components and rules.

- **Tokens:** color, spacing, radius, type scale
- **Components:** buttons, inputs, cards, dialogs
- **Rules:** when to use each component and why

Start small: define tokens first, then build the five components you use most.`,
  },
  {
    id: "roadmap",
    title: "Open-source roadmap",
    tag: "Planning",
    pinned: false,
    createdAt: now - 80 * H,
    updatedAt: now - 52 * H,
    content: `# Open-source roadmap

## Q4
- [x] Landing page and dashboard
- [x] AI assistant with streaming answers
- [ ] Shareable public documents
- [ ] Team workspaces

## Later
- Plugins for Discord and GitHub
- Offline-first sync`,
  },
];

export const SEED_IDEAS: Idea[] = [
  { id: "i1", text: "Discord bot that turns hackathon questions into a live FAQ", done: false, createdAt: now - 5 * H },
  { id: "i2", text: "Weekly focus report from documents I edited", done: false, createdAt: now - 30 * H },
  { id: "i3", text: "Add dark/light theme toggle to Prism", done: true, createdAt: now - 70 * H },
];

export const DEFAULT_SETTINGS: Settings = {
  name: "Builder",
  provider: "groq",
  apiKey: "",
  model: "",
};

const PREFIX = "prism-ai:v1:";
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => fn());

/** Persistent state in localStorage, shared across components and tabs. */
export function usePersistent<T>(key: string, initial: T) {
  const storageKey = PREFIX + key;
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        setValue(raw ? (JSON.parse(raw) as T) : initial);
      } catch {
        setValue(initial);
      }
    };
    read();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    const unsub = subscribe(read);
    const onStorage = (e: StorageEvent) => e.key === storageKey && read();
    window.addEventListener("storage", onStorage);
    return () => {
      unsub();
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          // storage full or blocked; keep in memory
        }
        queueMicrotask(emit);
        return resolved;
      });
    },
    [storageKey],
  );

  return [value, update, ready] as const;
}

export function exportWorkspace() {
  const data: Record<string, unknown> = {};
  for (const key of ["docs", "ideas", "chats", "settings"]) {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) data[key] = JSON.parse(raw);
  }
  if (data.settings) (data.settings as Settings).apiKey = "";
  return JSON.stringify({ app: "prism-ai", version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}

export function importWorkspace(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== "prism-ai" || !parsed.data) throw new Error("Not a Prism AI backup file.");
  for (const [key, value] of Object.entries(parsed.data)) {
    if (["docs", "ideas", "chats", "settings"].includes(key)) {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  }
  emit();
}

export function resetWorkspace() {
  for (const key of ["docs", "ideas", "chats", "settings"]) localStorage.removeItem(PREFIX + key);
  emit();
}

/** Client-only clock, avoids hydration mismatch for greetings and dates. */
export function useNow(intervalMs = 60_000) {
  return useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}

export function greeting(ts: number) {
  if (!ts) return "Welcome back";
  const h = new Date(ts).getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function timeAgo(ts: number, nowTs: number) {
  if (!nowTs) return "";
  const s = Math.max(0, Math.round((nowTs - ts) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
