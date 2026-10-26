"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, FileText, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import { timeAgo, uid } from "@/lib/store";
import { useWorkspace } from "./context";

type Filter = "open" | "done" | "all";

export function Ideas() {
  const { ideas, setIdeas, createDoc, askAI, toast, now } = useWorkspace();
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("open");

  const add = () => {
    const value = text.trim();
    if (!value) return;
    setIdeas((prev) => [{ id: uid(), text: value, done: false, createdAt: Date.now() }, ...prev]);
    setText("");
    toast("Idea captured");
  };

  const shown = ideas.filter((i) => (filter === "all" ? true : filter === "done" ? i.done : !i.done));
  const openCount = ideas.filter((i) => !i.done).length;

  return (
    <div className="view">
      <header className="viewHeader">
        <div>
          <div className="eyebrow">QUICK CAPTURE</div>
          <h1>Ideas</h1>
          <p className="muted">
            {openCount} open · {ideas.length - openCount} done
          </p>
        </div>
      </header>

      <form
        className="ideaComposer card"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Lightbulb size={18} className="accentIcon" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture an idea before it disappears…"
          aria-label="New idea"
          maxLength={280}
        />
        <button className="primaryButton small" type="submit" disabled={!text.trim()}>
          <Plus size={15} /> Add
        </button>
      </form>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter ideas">
          {(["open", "done", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {ideas.some((i) => i.done) && (
          <button
            className="ghostButton"
            onClick={() => {
              setIdeas((prev) => prev.filter((i) => !i.done));
              toast("Cleared completed ideas");
            }}
          >
            Clear done
          </button>
        )}
      </div>

      {shown.length ? (
        <ul className="ideaList">
          <AnimatePresence initial={false}>
            {shown.map((idea) => (
              <motion.li
                key={idea.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`ideaItem ${idea.done ? "done" : ""}`}
              >
                <button
                  className={`checkbox ${idea.done ? "on" : ""}`}
                  aria-label={idea.done ? "Mark as open" : "Mark as done"}
                  onClick={() => setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, done: !i.done } : i)))}
                >
                  {idea.done && <Check size={13} />}
                </button>
                <div className="ideaText">
                  <span>{idea.text}</span>
                  <small>{timeAgo(idea.createdAt, now)}</small>
                </div>
                <div className="ideaActions">
                  <button
                    className="iconButton"
                    title="Expand with AI"
                    aria-label="Expand with AI"
                    onClick={() =>
                      askAI(
                        `Help me develop this idea into a small project: "${idea.text}". Give the problem, a solution, key features and a first step.`,
                      )
                    }
                  >
                    <Sparkles size={15} />
                  </button>
                  <button
                    className="iconButton"
                    title="Turn into document"
                    aria-label="Turn into document"
                    onClick={() =>
                      createDoc({
                        title: idea.text.slice(0, 60),
                        content: `# ${idea.text}\n\n## Problem\n\n## Solution\n\n## Next steps\n- [ ] `,
                      })
                    }
                  >
                    <FileText size={15} />
                  </button>
                  <button
                    className="iconButton danger"
                    title="Delete"
                    aria-label="Delete idea"
                    onClick={() => setIdeas((prev) => prev.filter((i) => i.id !== idea.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <div className="emptyState">
          <Lightbulb size={26} />
          <h3>{filter === "done" ? "Nothing completed yet" : "No open ideas"}</h3>
          <p className="muted">Type above and press Enter to capture one.</p>
        </div>
      )}
    </div>
  );
}
