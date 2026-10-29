"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Conversation } from "./state";

function groupLabel(time: number): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= start) return "Today";
  if (time >= start - 6 * 86_400_000) return "Previous 7 days";
  return "Older";
}

export function Sidebar({
  conversations,
  activeId,
  runningId,
  email,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  activeId: string | null;
  runningId: string | null;
  email: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) => c.title.toLowerCase().includes(q) || c.turns.some((t) => (t.role === "user" ? t.content : t.text).toLowerCase().includes(q)),
    );
  }, [conversations, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const label = groupLabel(c.updatedAt);
      map.set(label, [...(map.get(label) ?? []), c]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function focusItem(offset: number | "first" | "last") {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(".ag-conv-btn") ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (offset === "first") next = 0;
    else if (offset === "last") next = buttons.length - 1;
    else next = current === -1 ? 0 : Math.min(buttons.length - 1, Math.max(0, current + offset));
    buttons[next].focus();
  }

  function onListKey(event: React.KeyboardEvent, conversation: Conversation) {
    if (editing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem("first");
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem("last");
    } else if (event.key === "F2") {
      event.preventDefault();
      startRename(conversation);
    } else if (event.key === "Delete") {
      event.preventDefault();
      confirmDelete(conversation);
    }
  }

  function startRename(conversation: Conversation) {
    setEditing(conversation.id);
    setDraft(conversation.title);
  }

  function commitRename() {
    if (editing && draft.trim()) onRename(editing, draft.trim().slice(0, 120));
    setEditing(null);
  }

  function confirmDelete(conversation: Conversation) {
    if (window.confirm(`Delete "${conversation.title}"? Its messages and files will be removed from this browser.`)) onDelete(conversation.id);
  }

  return (
    <div className="ag-sidebar-inner">
      <div className="ag-side-top">
        <a className="ag-brand" href="/dashboard" aria-label="Prism dashboard">
          <Image src="/prism-logo.png" alt="" width={32} height={32} className="ag-brand-logo" />
          <span>
            Prism<small>AGENT</small>
          </span>
        </a>
        {onClose && (
          <button type="button" className="ag-icon-btn ag-only-mobile" onClick={onClose} aria-label="Close sidebar">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <button type="button" className="ag-new" onClick={onNew}>
        <Icon name="plus" size={16} /> New task
        <kbd className="ag-kbd" aria-hidden="true">Ctrl K</kbd>
      </button>
      <label className="ag-search">
        <Icon name="search" size={14} />
        <span className="ag-sr">Search tasks</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" />
      </label>
      <nav className="ag-convs" aria-label="Task history">
        {!filtered.length && <p className="ag-muted ag-small ag-pad-x">{query ? "No matching tasks." : "Your tasks will appear here."}</p>}
        <ul ref={listRef}>
          {groups.map(([label, items]) => (
            <li key={label} className="ag-conv-group">
              <p className="ag-side-label">{label}</p>
              <ul>
                {items.map((conversation) => (
                  <li key={conversation.id} className={`ag-conv ${conversation.id === activeId ? "is-active" : ""}`}>
                    {editing === conversation.id ? (
                      <input
                        className="ag-rename"
                        value={draft}
                        autoFocus
                        aria-label="Rename task"
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ag-conv-btn"
                          onClick={() => onSelect(conversation.id)}
                          onKeyDown={(e) => onListKey(e, conversation)}
                          aria-current={conversation.id === activeId ? "page" : undefined}
                          title={`${conversation.title} (F2 to rename, Delete to remove)`}
                        >
                          {conversation.id === runningId && <span className="ag-conv-live" aria-label="Running" />}
                          <span className="ag-conv-title">{conversation.title}</span>
                        </button>
                        <span className="ag-conv-actions">
                          <button type="button" className="ag-icon-btn ag-tiny" onClick={() => startRename(conversation)} aria-label={`Rename ${conversation.title}`} title="Rename">
                            <Icon name="edit" size={13} />
                          </button>
                          <button type="button" className="ag-icon-btn ag-tiny" onClick={() => confirmDelete(conversation)} aria-label={`Delete ${conversation.title}`} title="Delete">
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ag-side-bottom">
        <a href="/dashboard" className="ag-side-link">
          <Icon name="panel" size={14} /> Dashboard &amp; settings
        </a>
        <span className="ag-muted ag-small ag-email" title={email}>
          {email}
        </span>
        <span className="ag-muted ag-small">Tasks are stored in this browser only.</span>
      </div>
    </div>
  );
}
