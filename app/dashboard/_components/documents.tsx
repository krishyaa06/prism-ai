"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  Eye,
  FileText,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { AI_ACTIONS } from "@/lib/ai";
import { Markdown } from "@/lib/markdown";
import { DOC_TAGS, type Doc, type DocTag, timeAgo, wordCount } from "@/lib/store";
import { useWorkspace } from "./context";

export function Documents() {
  const { activeDocId, docs } = useWorkspace();
  const doc = docs.find((d) => d.id === activeDocId);
  if (activeDocId && doc) return <Editor key={doc.id} doc={doc} />;
  return <DocumentList missing={!!activeDocId && !doc} />;
}

function DocumentList({ missing }: { missing: boolean }) {
  const { docs, go, createDoc, now } = useWorkspace();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<DocTag | "All">("All");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return [...docs]
      .filter((d) => tag === "All" || d.tag === tag)
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [docs, query, tag]);

  return (
    <div className="view">
      <header className="viewHeader">
        <div>
          <div className="eyebrow">YOUR LIBRARY</div>
          <h1>Documents</h1>
          <p className="muted">
            {docs.length} document{docs.length === 1 ? "" : "s"} · saved in this browser
          </p>
        </div>
        <div className="headerActions">
          <button className="primaryButton" onClick={() => createDoc()}>
            <Plus size={16} /> New document
          </button>
        </div>
      </header>

      {missing && <div className="notice">That document no longer exists. It may have been deleted.</div>}

      <div className="toolbar">
        <label className="searchField">
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents…" />
        </label>
        <div className="segmented" role="tablist" aria-label="Filter by tag">
          {(["All", ...DOC_TAGS] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tag === t} className={tag === t ? "on" : ""} onClick={() => setTag(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <div className="docList">
          {filtered.map((d) => (
            <button key={d.id} className="docRow" onClick={() => go("documents", d.id)}>
              <span className={`documentIcon small tag-${d.tag}`}>
                <FileText size={16} />
              </span>
              <span className="docRowMain">
                <strong>
                  {d.title || "Untitled document"}
                  {d.pinned && <Pin size={12} className="pinInline" />}
                </strong>
                <small>{excerpt(d.content)}</small>
              </span>
              <span className="tagPill" data-tag={d.tag}>
                {d.tag}
              </span>
              <span className="docRowMeta">{timeAgo(d.updatedAt, now)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="emptyState">
          <FileText size={26} />
          <h3>{docs.length ? "No matching documents" : "Your library is empty"}</h3>
          <p className="muted">
            {docs.length ? "Try a different search or tag." : "Create your first document to get started."}
          </p>
          {!docs.length && (
            <button className="primaryButton" onClick={() => createDoc()}>
              <Plus size={16} /> New document
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function excerpt(content: string) {
  return (
    content
      .replace(/[#*`>\-[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110) || "Empty document"
  );
}

function Editor({ doc }: { doc: Doc }) {
  const { setDocs, go, askAI, toast, now } = useWorkspace();
  const [mode, setMode] = useState<"write" | "preview" | "split">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches ? "write" : "split",
  );
  const [aiOpen, setAiOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState({ title: doc.title, content: doc.content });
  const latest = useRef(draft);

  useEffect(() => {
    if (doc.title === "Untitled document" && !doc.content) titleRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<Doc>, immediate = false) => {
    const commit = () => {
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, ...p, updatedAt: Date.now() } : d)));
      setSaved(true);
    };
    if (immediate) return commit();
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(commit, 400);
  };

  const updateDraft = (p: { title?: string; content?: string }) => {
    const next = { ...draft, ...p };
    setDraft(next);
    latest.current = next;
    patch(next);
  };

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // Flush pending edits when leaving the editor.
  useEffect(
    () => () => {
      const { title, content } = latest.current;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id && (d.title !== title || d.content !== content)
            ? { ...d, title, content, updatedAt: Date.now() }
            : d,
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const remove = () => {
    if (!confirm(`Delete "${draft.title || "Untitled document"}"? This cannot be undone.`)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    latest.current = { title: "", content: "" };
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    toast("Document deleted");
    go("documents");
  };

  const download = () => {
    const blob = new Blob([draft.content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(draft.title || "document").replace(/[^\w\- ]+/g, "").trim() || "document"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const words = wordCount(draft.content);

  return (
    <div className="view editorView">
      <div className="editorTop">
        <button className="ghostButton" onClick={() => go("documents")}>
          <ArrowLeft size={15} /> Documents
        </button>
        <div className="editorTools">
          <span className="saveState" data-saved={saved}>
            {saved ? `Saved · ${timeAgo(doc.updatedAt, now)}` : "Saving…"}
          </span>
          <div className="segmented small">
            <button className={mode === "write" ? "on" : ""} onClick={() => setMode("write")} aria-label="Write">
              <Pencil size={14} />
            </button>
            <button className={`hideMobile ${mode === "split" ? "on" : ""}`} onClick={() => setMode("split")}>
              Split
            </button>
            <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")} aria-label="Preview">
              <Eye size={14} />
            </button>
          </div>
          <div className="menuWrap">
            <button className="primaryButton small" onClick={() => setAiOpen((o) => !o)} aria-expanded={aiOpen}>
              <Sparkles size={15} /> Ask AI
            </button>
            {aiOpen && (
              <div className="menu" onMouseLeave={() => setAiOpen(false)}>
                {AI_ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setAiOpen(false);
                      if (!draft.content.trim()) return toast("Write something first, then ask AI.");
                      patch(draft, true);
                      askAI(a.prompt, doc.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="iconButton"
            title={doc.pinned ? "Unpin" : "Pin"}
            aria-label={doc.pinned ? "Unpin document" : "Pin document"}
            onClick={() => {
              patch({ pinned: !doc.pinned }, true);
              toast(doc.pinned ? "Unpinned" : "Pinned to top");
            }}
          >
            {doc.pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <button
            className="iconButton"
            title="Copy Markdown"
            aria-label="Copy Markdown"
            onClick={() => navigator.clipboard.writeText(draft.content).then(() => toast("Copied to clipboard"))}
          >
            <Copy size={16} />
          </button>
          <button className="iconButton" title="Download .md" aria-label="Download Markdown" onClick={download}>
            <Download size={16} />
          </button>
          <button className="iconButton danger" title="Delete" aria-label="Delete document" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="editorMeta">
        <input
          ref={titleRef}
          className="titleInput"
          value={draft.title}
          onChange={(e) => updateDraft({ title: e.target.value })}
          placeholder="Untitled document"
          aria-label="Document title"
        />
        <div className="metaRow">
          <select
            value={doc.tag}
            onChange={(e) => patch({ tag: e.target.value as DocTag }, true)}
            aria-label="Tag"
            className="tagSelect"
            data-tag={doc.tag}
          >
            {DOC_TAGS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <span className="muted small">
            {words} words · {Math.max(1, Math.round(words / 200))} min read
          </span>
        </div>
      </div>

      <div className={`editorBody mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            className="editorArea"
            value={draft.content}
            onChange={(e) => updateDraft({ content: e.target.value })}
            placeholder={"Start writing… Markdown is supported.\n\n# Heading\n- List item\n**bold** and `code`"}
            aria-label="Document content"
            spellCheck
          />
        )}
        {mode !== "write" && (
          <div className="editorPreview">
            {draft.content.trim() ? <Markdown source={draft.content} /> : <p className="muted">Nothing to preview yet.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
