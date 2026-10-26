"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FileText, Lightbulb, MessageSquare, Plus, Search, Settings, Sparkles } from "lucide-react";
import { useWorkspace } from "./context";

type Item = { id: string; label: string; hint: string; icon: typeof FileText; run: () => void };

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { docs, ideas, chats, go, createDoc, askAI } = useWorkspace();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const actions: Item[] = [
      { id: "new", label: "New document", hint: "Action", icon: Plus, run: () => createDoc() },
      { id: "chat", label: "Open AI Assistant", hint: "Action", icon: MessageSquare, run: () => go("assistant") },
      { id: "ideas", label: "Capture an idea", hint: "Action", icon: Lightbulb, run: () => go("ideas") },
      { id: "settings", label: "Settings", hint: "Action", icon: Settings, run: () => go("settings") },
    ].filter((a) => match(a.label));

    const ask: Item[] = q
      ? [{ id: "ask", label: `Ask Prism: “${query.trim()}”`, hint: "AI", icon: Sparkles, run: () => askAI(query.trim()) }]
      : [];

    const docItems: Item[] = docs
      .filter((d) => match(d.title) || (q.length > 1 && d.content.toLowerCase().includes(q)))
      .slice(0, 6)
      .map((d) => ({ id: d.id, label: d.title || "Untitled document", hint: d.tag, icon: FileText, run: () => go("documents", d.id) }));

    const ideaItems: Item[] = q
      ? ideas
          .filter((i) => match(i.text))
          .slice(0, 3)
          .map((i) => ({ id: i.id, label: i.text, hint: "Idea", icon: Lightbulb, run: () => go("ideas") }))
      : [];

    const chatItems: Item[] = q
      ? chats
          .filter((c) => match(c.title))
          .slice(0, 3)
          .map((c) => ({ id: c.id, label: c.title, hint: "Chat", icon: MessageSquare, run: () => go("assistant") }))
      : [];

    return [...ask, ...docItems, ...actions, ...ideaItems, ...chatItems];
  }, [query, docs, ideas, chats, go, createDoc, askAI]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (item?: Item) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="paletteBackdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onMouseDown={(e) => e.stopPropagation()}>
        <label className="paletteInput">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Search documents, ideas or ask Prism…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[index]);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul ref={listRef} className="paletteList">
          {items.length ? (
            items.map((item, i) => (
              <li key={item.id + i}>
                <button
                  data-index={i}
                  className={i === index ? "on" : ""}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(item)}
                >
                  <item.icon size={16} />
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                  {i === index && <CornerDownLeft size={13} className="enterHint" />}
                </button>
              </li>
            ))
          ) : (
            <li className="paletteEmpty">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
