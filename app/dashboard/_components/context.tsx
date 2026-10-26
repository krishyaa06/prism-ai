"use client";

import { createContext, useContext } from "react";
import type { Chat, Doc, Idea, Settings } from "@/lib/store";

export type View = "overview" | "documents" | "assistant" | "ideas" | "settings";

export type PendingAsk = { prompt: string; docId?: string; nonce: number };

export type WorkspaceApi = {
  docs: Doc[];
  setDocs: (fn: (prev: Doc[]) => Doc[]) => void;
  ideas: Idea[];
  setIdeas: (fn: (prev: Idea[]) => Idea[]) => void;
  chats: Chat[];
  setChats: (fn: (prev: Chat[]) => Chat[]) => void;
  settings: Settings;
  setSettings: (fn: (prev: Settings) => Settings) => void;
  view: View;
  go: (view: View, docId?: string | null) => void;
  activeDocId: string | null;
  createDoc: (partial?: { title?: string; content?: string }) => string;
  askAI: (prompt: string, docId?: string) => void;
  pendingAsk: PendingAsk | null;
  clearPendingAsk: () => void;
  toast: (message: string) => void;
  openPalette: () => void;
  aiStatus: { mode: "live" | "demo" | "checking"; label: string };
  now: number;
};

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside the workspace");
  return ctx;
}
