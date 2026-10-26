"use client";

import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, FileText, Lightbulb, MessageSquare, Pin, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { greeting, timeAgo, wordCount } from "@/lib/store";
import { useWorkspace } from "./context";

const SUGGESTIONS = [
  "Give me 3 hackathon ideas for students",
  "Explain retrieval-augmented generation simply",
  "Make a 7-day plan to learn Next.js",
];

export function Overview() {
  const { docs, ideas, chats, settings, go, createDoc, askAI, now, aiStatus } = useWorkspace();
  const [question, setQuestion] = useState("");

  const words = docs.reduce((n, d) => n + wordCount(d.content), 0);
  const weekAgo = now - 7 * 86_400_000;
  const editedThisWeek = docs.filter((d) => d.updatedAt > weekAgo).length;
  const openIdeas = ideas.filter((i) => !i.done).length;
  const doneIdeas = ideas.length - openIdeas;
  const momentum = Math.min(100, editedThisWeek * 15 + doneIdeas * 10 + chats.length * 5);
  const recent = [...docs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt).slice(0, 4);

  const dateLabel = now
    ? new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : "";

  const submit = (q: string) => {
    if (!q.trim()) return;
    askAI(q.trim());
    setQuestion("");
  };

  return (
    <div className="view">
      <header className="viewHeader">
        <div>
          <div className="eyebrow">
            <Sparkles size={14} />
            {dateLabel ? dateLabel.toUpperCase() : "YOUR WORKSPACE"}
          </div>
          <h1>
            {greeting(now)}, <span className="gradientText">{settings.name || "builder"}.</span>
          </h1>
          <p className="muted">What will you explore today?</p>
        </div>
        <div className="headerActions">
          <button className="secondaryButton" onClick={() => go("ideas")}>
            <Lightbulb size={16} /> Capture idea
          </button>
          <button className="primaryButton" onClick={() => createDoc()}>
            <Plus size={16} /> New document
          </button>
        </div>
      </header>

      <div className="overviewGrid">
        <motion.section
          className="card askCard"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="askCardInner">
            <div className="eyebrow">PRISM AI ASSISTANT</div>
            <h2>Start with a question.</h2>
            <p className="muted">
              Summarize your notes, explain a concept or plan your next project.
            </p>
            <form
              className="askForm"
              onSubmit={(e) => {
                e.preventDefault();
                submit(question);
              }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask Prism anything…"
                aria-label="Ask Prism AI"
              />
              <button className="primaryButton" type="submit" disabled={!question.trim()} aria-label="Ask">
                <ArrowRight size={17} />
              </button>
            </form>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="orb" aria-hidden>
            <span>✦</span>
          </div>
          <div className="aiPill" data-mode={aiStatus.mode}>
            <span className="statusDot" />
            {aiStatus.label}
          </div>
        </motion.section>

        <motion.section
          className="card statsCard"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06 }}
        >
          <div className="cardHeader">
            <span className="eyebrow">THIS WEEK</span>
          </div>
          <div className="focusScore">{momentum}%</div>
          <p className="muted">Momentum score</p>
          <div className="progressTrack">
            <motion.div
              className="progressValue"
              initial={{ width: 0 }}
              animate={{ width: `${momentum}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </div>
          <dl className="miniStats">
            <div>
              <dt>Documents</dt>
              <dd>{docs.length}</dd>
            </div>
            <div>
              <dt>Words</dt>
              <dd>{words.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Open ideas</dt>
              <dd>{openIdeas}</dd>
            </div>
            <div>
              <dt>Chats</dt>
              <dd>{chats.length}</dd>
            </div>
          </dl>
        </motion.section>
      </div>

      <section className="section">
        <div className="sectionTitle">
          <div>
            <span className="eyebrow">YOUR LIBRARY</span>
            <h2>Recent documents</h2>
          </div>
          <button className="ghostButton" onClick={() => go("documents")}>
            View all <ArrowRight size={15} />
          </button>
        </div>

        <div className="documentGrid">
          {recent.map((doc, index) => (
            <motion.button
              className="documentCard"
              key={doc.id}
              onClick={() => go("documents", doc.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.06 }}
              whileHover={{ y: -4 }}
            >
              <div className={`documentIcon tag-${doc.tag}`}>
                <FileText size={19} />
              </div>
              {doc.pinned && <Pin size={14} className="pinMark" />}
              <h3>{doc.title || "Untitled document"}</h3>
              <p>{doc.tag}</p>
              <div className="documentFooter">
                <span>{timeAgo(doc.updatedAt, now)}</span>
                <ArrowUpRight size={15} />
              </div>
            </motion.button>
          ))}

          <button className="createCard" onClick={() => createDoc()}>
            <span>
              <Plus size={20} />
            </span>
            <strong>Create a document</strong>
            <small>Start with a blank page</small>
          </button>
        </div>
      </section>

      <section className="section twoCol">
        <div className="card">
          <div className="sectionTitle compact">
            <h3>
              <Lightbulb size={16} /> Latest ideas
            </h3>
            <button className="ghostButton" onClick={() => go("ideas")}>
              Open <ArrowRight size={15} />
            </button>
          </div>
          {ideas.length ? (
            <ul className="plainList">
              {ideas.slice(0, 4).map((i) => (
                <li key={i.id} className={i.done ? "doneText" : undefined}>
                  {i.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No ideas yet. Capture your first one.</p>
          )}
        </div>
        <div className="card">
          <div className="sectionTitle compact">
            <h3>
              <MessageSquare size={16} /> Recent chats
            </h3>
            <button className="ghostButton" onClick={() => go("assistant")}>
              Open <ArrowRight size={15} />
            </button>
          </div>
          {chats.length ? (
            <ul className="plainList">
              {chats.slice(0, 4).map((c) => (
                <li key={c.id}>
                  {c.title}
                  <small>{timeAgo(c.updatedAt, now)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No conversations yet. Ask Prism a question above.</p>
          )}
        </div>
      </section>
    </div>
  );
}
