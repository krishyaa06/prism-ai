"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Lightbulb,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  PROVIDER_INFO,
  SEED_DOCS,
  SEED_IDEAS,
  type Chat,
  type Doc,
  type Idea,
  type Settings,
  uid,
  useNow,
  usePersistent,
} from "@/lib/store";
import { WorkspaceContext, type PendingAsk, type View, type WorkspaceApi } from "./context";
import { Overview } from "./overview";
import { Documents } from "./documents";
import { Assistant } from "./assistant";
import { Ideas } from "./ideas";
import { SettingsView } from "./settings";
import { CommandPalette } from "./palette";

const NAV: { id: View; label: string; icon: typeof FileText }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "assistant", label: "AI Assistant", icon: MessageSquare },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
];

const VIEWS: View[] = ["overview", "documents", "assistant", "ideas", "settings"];

function parseHash(): { view: View; docId: string | null } {
  if (typeof window === "undefined") return { view: "overview", docId: null };
  const [view, docId] = window.location.hash.replace(/^#\/?/, "").split("/");
  return {
    view: VIEWS.includes(view as View) ? (view as View) : "overview",
    docId: view === "documents" && docId ? decodeURIComponent(docId) : null,
  };
}

export function Workspace() {
  const [docs, setDocs, docsReady] = usePersistent<Doc[]>("docs", SEED_DOCS);
  const [ideas, setIdeas] = usePersistent<Idea[]>("ideas", SEED_IDEAS);
  const [chats, setChats] = usePersistent<Chat[]>("chats", []);
  const [settings, setSettings] = usePersistent<Settings>("settings", DEFAULT_SETTINGS);
  const [view, setView] = useState<View>("overview");
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [serverMode, setServerMode] = useState<{ mode: "live" | "demo" | "checking"; label: string }>({
    mode: "checking",
    label: "Checking AI…",
  });
  const now = useNow(30_000);

  // Hash routing: #documents/<id>, #assistant, ...
  useEffect(() => {
    const sync = () => {
      const { view, docId } = parseHash();
      setView(view);
      setActiveDocId(docId);
      setNavOpen(false);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = useCallback((next: View, docId?: string | null) => {
    const hash = next === "documents" && docId ? `#documents/${encodeURIComponent(docId)}` : `#${next}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setView(next);
    setActiveDocId(next === "documents" ? docId ?? null : null);
    setNavOpen(false);
    document.querySelector(".appMain")?.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    fetch("/api/chat")
      .then((r) => r.json())
      .then((d) =>
        setServerMode(
          d.mode === "live"
            ? { mode: "live", label: `${d.provider} · ${d.model}` }
            : { mode: "demo", label: "Demo mode" },
        ),
      )
      .catch(() => setServerMode({ mode: "demo", label: "Demo mode" }));
  }, []);

  const aiStatus = useMemo(
    () =>
      settings.apiKey
        ? { mode: "live" as const, label: `Your key · ${PROVIDER_INFO[settings.provider].label.replace(" (free)", "")}` }
        : serverMode,
    [settings.apiKey, settings.provider, serverMode],
  );

  const toast = useCallback((message: string) => {
    const id = uid();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const createDoc = useCallback(
    (partial?: { title?: string; content?: string }) => {
      const id = uid();
      const ts = Date.now();
      setDocs((prev) => [
        {
          id,
          title: partial?.title ?? "Untitled document",
          content: partial?.content ?? "",
          tag: "Personal",
          pinned: false,
          createdAt: ts,
          updatedAt: ts,
        },
        ...prev,
      ]);
      go("documents", id);
      return id;
    },
    [setDocs, go],
  );

  const askAI = useCallback(
    (prompt: string, docId?: string) => {
      setPendingAsk({ prompt, docId, nonce: Date.now() });
      go("assistant");
    },
    [go],
  );

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const api: WorkspaceApi = useMemo(
    () => ({
      docs,
      setDocs,
      ideas,
      setIdeas,
      chats,
      setChats,
      settings,
      setSettings,
      view,
      go,
      activeDocId,
      createDoc,
      askAI,
      pendingAsk,
      clearPendingAsk: () => setPendingAsk(null),
      toast,
      openPalette: () => setPaletteOpen(true),
      aiStatus,
      now,
    }),
    [docs, setDocs, ideas, setIdeas, chats, setChats, settings, setSettings, view, go, activeDocId, createDoc, askAI, pendingAsk, toast, aiStatus, now],
  );

  const initial = (settings.name || "B").trim().charAt(0).toUpperCase();

  return (
    <WorkspaceContext.Provider value={api}>
      <div className={`appShell ${navOpen ? "navOpen" : ""}`}>
        <aside className="appSidebar" aria-label="Workspace navigation">
          <div className="appSidebarTop">
            <Link href="/" className="brand" aria-label="Prism AI home">
              <span className="brandMark">◇</span>PRISM <strong>AI</strong>
            </Link>
            <button className="iconButton onlyMobile" onClick={() => setNavOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
          </div>

          <button className="sidebarSearch" onClick={() => setPaletteOpen(true)}>
            <Search size={15} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>

          <nav className="sidebarNav">
            <small className="navLabel">WORKSPACE</small>
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`navItem ${view === id ? "active" : ""}`}
                onClick={() => go(id)}
                aria-current={view === id ? "page" : undefined}
              >
                <Icon size={16} />
                {label}
                {id === "documents" && <span className="navCount">{docs.length}</span>}
                {id === "ideas" && <span className="navCount">{ideas.filter((i) => !i.done).length}</span>}
              </button>
            ))}

            <button className="newDocButton" onClick={() => createDoc()}>
              <Plus size={16} /> New document
            </button>
          </nav>

          <div className="sidebarFooter">
            <button
              className={`navItem ${view === "settings" ? "active" : ""}`}
              onClick={() => go("settings")}
            >
              <SettingsIcon size={16} /> Settings
            </button>
            <div className="aiStatus" data-mode={aiStatus.mode}>
              <span className="statusDot" />
              <span>{aiStatus.mode === "live" ? "AI connected" : aiStatus.label}</span>
            </div>
            <button className="profileCard" onClick={() => go("settings")}>
              <span className="profileAvatar">{initial}</span>
              <span>
                <strong>{settings.name || "Builder"}</strong>
                <small>Local workspace</small>
              </span>
            </button>
          </div>
        </aside>

        <div className="navScrim" onClick={() => setNavOpen(false)} />

        <div className="appMain">
          <header className="mobileBar">
            <button className="iconButton" onClick={() => setNavOpen(true)} aria-label="Open menu">
              <Menu size={19} />
            </button>
            <Link href="/" className="brand">
              <span className="brandMark">◇</span>PRISM <strong>AI</strong>
            </Link>
            <button className="iconButton" onClick={() => setPaletteOpen(true)} aria-label="Search">
              <Search size={18} />
            </button>
          </header>

          {!docsReady ? (
            <div className="viewLoading">
              <div className="skeleton tall" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : view === "overview" ? (
            <Overview />
          ) : view === "documents" ? (
            <Documents />
          ) : view === "assistant" ? (
            <Assistant />
          ) : view === "ideas" ? (
            <Ideas />
          ) : (
            <SettingsView />
          )}
        </div>

        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

        <div className="toastStack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.message}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
