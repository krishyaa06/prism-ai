"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, AgentRequest, Artifact, ChatMessage } from "@/lib/agent/events";
import { RightPanel, type SourceGroup } from "./artifacts-panel";
import { Composer, type ComposerHandle } from "./composer";
import { Header, type AgentStatus } from "./header";
import { Icon, type IconName } from "./icons";
import { Sidebar } from "./sidebar";
import {
  applyEvent,
  buildHistory,
  loadConversations,
  loadSettings,
  newAssistantTurn,
  readNdjson,
  resetForRerun,
  saveConversations,
  saveSettings,
  STORAGE_KEY,
  titleFrom,
  uid,
  upsertArtifact,
  type AgentSettings,
  type ApprovalAnswer,
  type AssistantTurn,
  type Conversation,
  type Turn,
  type UserTurn,
} from "./state";
import { AssistantTurnView, UserBubble } from "./turn";

type WireApproval = ApprovalAnswer;
type WireRequest = Omit<AgentRequest, "approvals"> & { approvals?: WireApproval[] };

const EXAMPLES: { icon: IconName; title: string; prompt: string }[] = [
  { icon: "search", title: "Research and write a report", prompt: "Research the current state of solid-state batteries (players, timelines, open problems) and write a cited report as a Markdown file." },
  { icon: "globe", title: "Build an HTML dashboard", prompt: "Build an interactive HTML dashboard with a chart of global EV sales by year, using sourced figures." },
  { icon: "code", title: "Analyze CSV data with code", prompt: "Analyze the attached CSV with code: summarize each column, find the main trends and save a cleaned CSV." },
  { icon: "list", title: "Compare products in a table", prompt: "Compare the top 3 vector databases (Qdrant, Weaviate, Pinecone) in a table: pricing, licensing, hosting and hybrid search." },
  { icon: "message", title: "Plan a trip", prompt: "Plan a 4-day trip to Kyoto in spring with a day-by-day itinerary, rough costs and booking tips." },
  { icon: "plug", title: "Work with GitHub", prompt: "Using my GitHub connector, list my open pull requests and summarize which ones need attention." },
];

function isWide(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 1200px)").matches;
}

async function errorFromResponse(response: Response): Promise<string> {
  if (response.status === 401) return "Your session has expired. Sign in again from the home page.";
  if (response.status === 404) return "The agent API (/api/agent/chat) is not available on this deployment yet.";
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { error?: string; message?: string };
      if (body.error || body.message) return String(body.error ?? body.message);
    } catch {
      /* not JSON */
    }
    if (text.trim()) return `${response.status}: ${text.trim().slice(0, 300)}`;
  } catch {
    /* ignore */
  }
  return `Request failed with status ${response.status}.`;
}

export function AgentWorkspace({ email, forceMock = false }: { email: string; forceMock?: boolean }) {
  const [mock, setMock] = useState(forceMock);
  const [loaded, setLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [running, setRunning] = useState<{ convId: string; turnId: string } | null>(null);
  const [settings, setSettings] = useState<AgentSettings>({ memory: false, subagents: true });
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"files" | "sources">("files");
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  const storageKey = mock ? `${STORAGE_KEY}-preview` : STORAGE_KEY;

  // ----- boot -----
  useEffect(() => {
    const useMock = forceMock || (process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("mock") === "1");
    setMock(useMock);
    const key = useMock ? `${STORAGE_KEY}-preview` : STORAGE_KEY;
    const list = loadConversations(key);
    setConversations(list);
    setSettings(loadSettings());
    const fromHash = window.location.hash.startsWith("#t=") ? window.location.hash.slice(3) : null;
    if (fromHash && list.some((c) => c.id === fromHash)) setActiveId(fromHash);
    setLoaded(true);
  }, [forceMock]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    if (mock) {
      void import("./mock-stream").then(({ MOCK_STATUS }) => {
        if (!cancelled) setStatus(MOCK_STATUS);
      });
      return () => {
        cancelled = true;
      };
    }
    fetch("/api/agent/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as AgentStatus;
        if (!cancelled) setStatus(body);
      })
      .catch(() => {
        if (!cancelled) setStatusFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, mock]);

  // ----- persistence (debounced) -----
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => {
      const ok = saveConversations(storageKey, conversations);
      setStorageWarning(!ok);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [conversations, loaded, storageKey]);

  useEffect(() => {
    if (!loaded) return;
    const hash = activeId ? `#t=${activeId}` : "";
    if (window.location.hash !== hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  }, [activeId, loaded]);

  function updateSettings(next: AgentSettings) {
    setSettings(next);
    saveSettings(next);
  }

  const active = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId]);

  // ----- auto scroll -----
  useEffect(() => {
    const el = chatRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [active]);

  function onChatScroll() {
    const el = chatRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  // ----- keyboard shortcuts -----
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        newTask();
      }
      if (event.key === "Escape") {
        setSidebarOpen(false);
        if (!isWide()) setPanelOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- mutations -----
  const patchConversation = useCallback((convId: string, fn: (c: Conversation) => Conversation) => {
    setConversations((list) => list.map((c) => (c.id === convId ? fn(c) : c)));
  }, []);

  const patchTurn = useCallback(
    (convId: string, turnId: string, fn: (t: AssistantTurn) => AssistantTurn) => {
      patchConversation(convId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        turns: c.turns.map((t) => (t.id === turnId && t.role === "assistant" ? fn(t) : t)),
      }));
    },
    [patchConversation],
  );

  const run = useCallback(
    async (convId: string, turnId: string, messages: ChatMessage[], artifacts: Artifact[], approvals?: WireApproval[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning({ convId, turnId });
      stickRef.current = true;
      let autoOpened = false;

      const apply = (event: AgentEvent) => {
        setConversations((list) =>
          list.map((c) => {
            if (c.id !== convId) return c;
            let artifactsNext = c.artifacts;
            const turns = c.turns.map((t) => {
              if (t.id !== turnId || t.role !== "assistant") return t;
              const result = applyEvent(t, event);
              if (result.artifact) artifactsNext = upsertArtifact(artifactsNext, result.artifact);
              return result.turn;
            });
            return { ...c, turns, artifacts: artifactsNext, updatedAt: Date.now() };
          }),
        );
        if (event.type === "artifact" && event.artifact?.id) {
          setSelectedArtifact(event.artifact.id);
          if (!autoOpened && isWide()) {
            autoOpened = true;
            setPanelOpen(true);
            setPanelTab("files");
          }
        }
      };

      const request: WireRequest = {
        messages,
        artifacts: artifacts.length ? artifacts : undefined,
        approvals: approvals?.length ? approvals : undefined,
        settings: { memory: settings.memory, subagents: settings.subagents },
      };

      try {
        let events: AsyncIterable<AgentEvent>;
        if (mock) {
          const { mockStream } = await import("./mock-stream");
          events = mockStream(request, controller.signal);
        } else {
          const response = await fetch("/api/agent/chat", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/x-ndjson" },
            body: JSON.stringify(request),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            apply({ type: "error", message: await errorFromResponse(response) });
            return;
          }
          events = readNdjson(response.body, controller.signal);
        }
        let terminal = false;
        for await (const event of events) {
          if (controller.signal.aborted) break;
          if (event.type === "done" || event.type === "error" || event.type === "question") terminal = true;
          apply(event);
        }
        if (controller.signal.aborted) {
          patchTurn(convId, turnId, (t) => ({ ...t, running: false, status: undefined, stopped: true }));
        } else if (!terminal) {
          patchTurn(convId, turnId, (t) => ({ ...t, running: false, status: undefined }));
        }
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          patchTurn(convId, turnId, (t) => ({ ...t, running: false, status: undefined, stopped: true }));
        } else {
          apply({ type: "error", message: error instanceof Error ? `Connection problem: ${error.message}` : "Connection problem." });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRunning((current) => (current?.turnId === turnId ? null : current));
      }
    },
    [mock, patchTurn, settings.memory, settings.subagents],
  );

  function send(text: string, attachments: Artifact[]) {
    if (running) return;
    const now = Date.now();
    let conversation = active;
    if (!conversation) {
      conversation = { id: uid("task"), title: titleFrom(text), createdAt: now, updatedAt: now, turns: [], artifacts: [] };
    }
    const userTurn: UserTurn = { role: "user", id: uid("turn"), content: text, createdAt: now, attachments: attachments.map((a) => a.name) };
    const assistant = newAssistantTurn();
    const prior: Turn[] = [...conversation.turns, userTurn];
    const artifacts = attachments.reduce((list, a) => upsertArtifact(list, a), conversation.artifacts);
    const next: Conversation = {
      ...conversation,
      title: conversation.turns.length ? conversation.title : titleFrom(text),
      updatedAt: now,
      turns: [...prior, assistant],
      artifacts,
    };
    setConversations((list) => (list.some((c) => c.id === next.id) ? list.map((c) => (c.id === next.id ? next : c)) : [next, ...list]));
    setActiveId(next.id);
    if (attachments.length) setSelectedArtifact(attachments[attachments.length - 1].id);
    void run(next.id, assistant.id, buildHistory(prior), artifacts);
  }

  function historyBefore(conversation: Conversation, turnId: string): ChatMessage[] {
    const index = conversation.turns.findIndex((t) => t.id === turnId);
    return buildHistory(conversation.turns.slice(0, index === -1 ? conversation.turns.length : index));
  }

  function answerApproval(turnId: string, callId: string, approved: boolean) {
    if (running) return;
    const conversation = conversationsRef.current.find((c) => c.turns.some((t) => t.id === turnId));
    if (!conversation) return;
    const turn = conversation.turns.find((t): t is AssistantTurn => t.id === turnId && t.role === "assistant");
    const pending = turn?.approvals.find((a) => a.callId === callId);
    if (!turn || !pending) return;
    const answer: ApprovalAnswer = { callId: pending.callId, tool: pending.tool, args: pending.args, approved };
    const answered = [...turn.answeredApprovals.filter((a) => a.callId !== callId), answer];
    const approvals = turn.approvals.map((a) => (a.callId === callId ? { ...a, answered: true, approved } : a));
    const stillOpen = approvals.some((a) => !a.answered);
    if (stillOpen) {
      patchTurn(conversation.id, turnId, (t) => ({ ...t, approvals, answeredApprovals: answered }));
      return;
    }
    patchTurn(conversation.id, turnId, (t) => ({ ...resetForRerun(t, true), approvals, answeredApprovals: answered, status: approved ? "Continuing with your approval…" : "Continuing without that action…" }));
    void run(conversation.id, turnId, historyBefore(conversation, turnId), conversation.artifacts, answered);
  }

  function retry(turnId: string) {
    if (running) return;
    const conversation = conversationsRef.current.find((c) => c.turns.some((t) => t.id === turnId));
    if (!conversation) return;
    const turn = conversation.turns.find((t): t is AssistantTurn => t.id === turnId && t.role === "assistant");
    if (!turn) return;
    patchTurn(conversation.id, turnId, (t) => ({ ...resetForRerun(t, false), approvals: t.approvals.filter((a) => a.answered), status: "Retrying…" }));
    void run(conversation.id, turnId, historyBefore(conversation, turnId), conversation.artifacts, turn.answeredApprovals);
  }

  function stop() {
    abortRef.current?.abort();
  }

  function newTask() {
    setActiveId(null);
    setSidebarOpen(false);
    setSelectedArtifact(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function selectConversation(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
    setSelectedArtifact(null);
    stickRef.current = true;
    const conv = conversationsRef.current.find((c) => c.id === id);
    if (conv?.artifacts.length && isWide()) setPanelOpen(true);
  }

  function deleteConversation(id: string) {
    if (running?.convId === id) stop();
    setConversations((list) => list.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function openArtifact(id: string) {
    setSelectedArtifact(id);
    setPanelTab("files");
    setPanelOpen(true);
  }

  function openSources() {
    setPanelTab("sources");
    setPanelOpen(true);
  }

  const sourceGroups: SourceGroup[] = useMemo(() => {
    if (!active) return [];
    const groups: SourceGroup[] = [];
    let question = "";
    for (const turn of active.turns) {
      if (turn.role === "user") question = turn.content;
      else groups.push({ turnId: turn.id, question: titleFrom(question), sources: turn.sources });
    }
    return groups;
  }, [active]);

  const turns = active?.turns ?? [];
  const artifacts = active?.artifacts ?? [];
  const isRunningHere = !!running && running.convId === active?.id;
  const busy = !!running;
  const modelMissing = !!status && !status.model?.configured;
  const lastAssistant = [...turns].reverse().find((t): t is AssistantTurn => t.role === "assistant");

  return (
    <div className={`ag-root ${panelOpen ? "panel-open" : ""} ${sidebarOpen ? "sidebar-open" : ""}`}>
      <a className="ag-skip" href="#ag-input">
        Skip to message box
      </a>
      <aside className="ag-sidebar" aria-label="Tasks">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          runningId={running?.convId ?? null}
          email={email}
          onSelect={selectConversation}
          onNew={newTask}
          onRename={(id, title) => patchConversation(id, (c) => ({ ...c, title }))}
          onDelete={deleteConversation}
          onClose={() => setSidebarOpen(false)}
        />
      </aside>
      {sidebarOpen && <button type="button" className="ag-backdrop ag-backdrop-left" aria-label="Close task history" onClick={() => setSidebarOpen(false)} />}

      <main className="ag-main">
        <Header
          title={active?.title ?? "New task"}
          status={status}
          statusFailed={statusFailed}
          panelOpen={panelOpen}
          panelCount={artifacts.length}
          onMenu={() => setSidebarOpen(true)}
          onTogglePanel={() => setPanelOpen((v) => !v)}
          mock={mock}
        />
        {modelMissing && (
          <div className="ag-banner" role="alert">
            <Icon name="alert" size={16} />
            <div>
              <strong>Connect a model to start.</strong> Prism Agent needs an OpenAI-compatible model with tool calling. Set <code>PRISM_MODEL_ENDPOINT</code>, <code>PRISM_MODEL_NAME</code> and <code>PRISM_MODEL_API_KEY</code> on the server.{" "}
              <a href="/dashboard#overview">Open dashboard</a> ·{" "}
              <a href="https://github.com/krishyaa06/prism-ai/blob/main/docs/AGENT_ENGINE.md" target="_blank" rel="noopener noreferrer">
                Setup guide
              </a>
            </div>
          </div>
        )}
        {storageWarning && (
          <div className="ag-banner ag-banner-soft" role="status">
            <Icon name="alert" size={16} />
            <div>Browser storage is full, so recent changes may not be saved. Delete old tasks to free space.</div>
          </div>
        )}

        <div className="ag-chat" ref={chatRef} onScroll={onChatScroll}>
          {!turns.length ? (
            <div className="ag-empty">
              <div className="ag-empty-logo">
                <Image src="/prism-logo.png" alt="Prism" width={64} height={64} priority />
              </div>
              <h2>What should Prism do?</h2>
              <p className="ag-muted">Give it a goal. Prism plans, searches the web, runs code, writes files and asks before anything consequential.</p>
              <div className="ag-examples">
                {EXAMPLES.map((example) => (
                  <button key={example.title} type="button" className="ag-example" onClick={() => composerRef.current?.setText(example.prompt)}>
                    <span className="ag-example-icon">
                      <Icon name={example.icon} size={16} />
                    </span>
                    <span>
                      <strong>{example.title}</strong>
                      <small>{example.prompt}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ag-thread" aria-live="off">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <UserBubble key={turn.id} turn={turn} />
                ) : (
                  <AssistantTurnView
                    key={turn.id}
                    turn={turn}
                    artifacts={artifacts}
                    isLast={turn.id === lastAssistant?.id && turns[turns.length - 1].id === turn.id}
                    busy={busy}
                    onApproval={answerApproval}
                    onAnswer={(text) => send(text, [])}
                    onRetry={retry}
                    onOpenArtifact={openArtifact}
                    onOpenSources={openSources}
                  />
                ),
              )}
            </div>
          )}
        </div>

        <Composer
          ref={composerRef}
          running={isRunningHere || busy}
          settings={settings}
          memoryAvailable={status ? status.memory : true}
          onSettings={updateSettings}
          onSend={send}
          onStop={stop}
          placeholder={turns.length ? "Ask a follow-up or give a new instruction…" : undefined}
        />
      </main>

      {panelOpen && <button type="button" className="ag-backdrop ag-backdrop-right" aria-label="Close files and sources" onClick={() => setPanelOpen(false)} />}
      <aside className="ag-right" aria-label="Files and sources" aria-hidden={!panelOpen} inert={!panelOpen}>
        <RightPanel
          artifacts={artifacts}
          selectedId={selectedArtifact}
          onSelect={setSelectedArtifact}
          sourceGroups={sourceGroups}
          tab={panelTab}
          onTab={setPanelTab}
          onClose={() => setPanelOpen(false)}
        />
      </aside>
    </div>
  );
}
