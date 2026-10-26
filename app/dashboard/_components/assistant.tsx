"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  FilePlus2,
  FileText,
  MessageSquarePlus,
  PanelLeft,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { streamChat } from "@/lib/ai";
import { Markdown } from "@/lib/markdown";
import { type Chat, type Message, timeAgo, uid } from "@/lib/store";
import { useWorkspace } from "./context";

const STARTERS = [
  { title: "Brainstorm", prompt: "Give me 5 creative project ideas for a weekend hackathon." },
  { title: "Explain", prompt: "Explain how large language models work, like I'm new to AI." },
  { title: "Plan", prompt: "Make a 2-week plan to launch my portfolio website." },
  { title: "Write", prompt: "Write a short, friendly announcement for a Discord community event." },
];

export function Assistant() {
  const { chats, setChats, docs, settings, pendingAsk, clearPendingAsk, createDoc, toast, now, aiStatus } =
    useWorkspace();
  const [chatId, setChatId] = useState<string | null>(chats[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [contextDocId, setContextDocId] = useState<string>("");
  const [streaming, setStreaming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chat = chats.find((c) => c.id === chatId) ?? null;
  const contextDoc = docs.find((d) => d.id === contextDocId);

  const scrollDown = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

  useEffect(() => {
    scrollDown();
  }, [chat?.messages.length]);

  const updateChat = (id: string, fn: (c: Chat) => Chat) =>
    setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const send = async (text: string, opts?: { docId?: string; forceNew?: boolean; history?: Message[] }) => {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    const docForContext = docs.find((d) => d.id === (opts?.docId ?? contextDocId));
    const userMsg: Message = {
      role: "user",
      content: docForContext ? `${prompt}\n\n> 📄 ${docForContext.title}` : prompt,
    };

    let id = opts?.forceNew ? null : chatId;
    const base = opts?.history ?? (id ? chats.find((c) => c.id === id)?.messages ?? [] : []);
    const history: Message[] = [...base, userMsg];

    if (!id || !chats.some((c) => c.id === id)) {
      id = uid();
      const newChat: Chat = {
        id,
        title: prompt.length > 48 ? prompt.slice(0, 48) + "…" : prompt,
        messages: [...history, { role: "assistant", content: "" }],
        updatedAt: Date.now(),
      };
      setChats((prev) => [newChat, ...prev]);
      setChatId(id);
    } else {
      updateChat(id, (c) => ({ ...c, messages: [...history, { role: "assistant", content: "" }], updatedAt: Date.now() }));
    }

    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setStreaming(true);
    scrollDown();
    const controller = new AbortController();
    abortRef.current = controller;
    const chatKey = id;

    const setAnswer = (content: string, error = false) =>
      updateChat(chatKey, (c) => {
        const msgs = [...c.messages];
        msgs[msgs.length - 1] = { role: "assistant", content, ...(error ? { error: true } : {}) };
        return { ...c, messages: msgs, updatedAt: Date.now() };
      });

    try {
      await streamChat({
        messages: history.map((m) => (m === userMsg ? { ...m, content: prompt } : m)),
        settings,
        context: docForContext ? `# ${docForContext.title}\n\n${docForContext.content}` : undefined,
        signal: controller.signal,
        onDelta: (t) => {
          setAnswer(t);
          const el = scrollRef.current;
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        updateChat(chatKey, (c) => {
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          msgs[msgs.length - 1] = { ...last, content: last.content || "_Stopped._" };
          return { ...c, messages: msgs };
        });
      } else {
        setAnswer((err as Error).message || "Something went wrong.", true);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scrollDown();
      inputRef.current?.focus();
    }
  };

  // Prompts sent from Overview or document "Ask AI" actions.
  const handledNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingAsk || handledNonce.current === pendingAsk.nonce) return;
    handledNonce.current = pendingAsk.nonce;
    const { prompt, docId } = pendingAsk;
    clearPendingAsk();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (docId) setContextDocId(docId);
    send(prompt, { docId, forceNew: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk?.nonce]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const retry = () => {
    if (!chat) return;
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = chat.messages.lastIndexOf(lastUser);
    const prompt = lastUser.content.replace(/\n\n> 📄 .*$/, "");
    send(prompt, { history: chat.messages.slice(0, idx) });
  };

  const deleteChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === chatId) setChatId(null);
  };

  const saveAsDoc = (content: string) => {
    const firstLine = content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").replace(/\*\*/g, "") ?? "AI answer";
    createDoc({ title: firstLine.slice(0, 60), content });
    toast("Saved as a new document");
  };

  const copy = (content: string, i: number) =>
    navigator.clipboard.writeText(content).then(() => {
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    });

  const messages = chat?.messages ?? [];

  return (
    <div className={`assistantView ${showHistory ? "historyOpen" : ""}`}>
      <aside className="chatHistory">
        <div className="chatHistoryTop">
          <button
            className="primaryButton small wide"
            onClick={() => {
              setChatId(null);
              setShowHistory(false);
              inputRef.current?.focus();
            }}
          >
            <MessageSquarePlus size={15} /> New chat
          </button>
          <button className="iconButton onlyMobile" onClick={() => setShowHistory(false)} aria-label="Close history">
            <X size={16} />
          </button>
        </div>
        <small className="navLabel">HISTORY</small>
        {chats.length ? (
          <ul>
            {chats.map((c) => (
              <li key={c.id} className={c.id === chatId ? "active" : ""}>
                <button
                  onClick={() => {
                    setChatId(c.id);
                    setShowHistory(false);
                  }}
                >
                  <span>{c.title}</span>
                  <small>{timeAgo(c.updatedAt, now)}</small>
                </button>
                <button className="iconButton tiny" aria-label="Delete chat" onClick={() => deleteChat(c.id)}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Your conversations will appear here.</p>
        )}
      </aside>

      <section className="chatPanel">
        <header className="chatHeader">
          <button className="iconButton onlyMobile" onClick={() => setShowHistory(true)} aria-label="Chat history">
            <PanelLeft size={17} />
          </button>
          <div className="chatTitle">
            <strong>{chat?.title ?? "New conversation"}</strong>
            <span className="aiPill inline" data-mode={aiStatus.mode}>
              <span className="statusDot" />
              {aiStatus.label}
            </span>
          </div>
        </header>

        <div className="chatScroll" ref={scrollRef}>
          {!messages.length ? (
            <div className="chatEmpty">
              <div className="orb small" aria-hidden>
                <span>✦</span>
              </div>
              <h2>How can Prism help?</h2>
              <p className="muted">Ask anything, or attach a document so answers stay grounded in your notes.</p>
              <div className="starterGrid">
                {STARTERS.map((s) => (
                  <button key={s.title} className="starter" onClick={() => send(s.prompt)}>
                    <strong>{s.title}</strong>
                    <span>{s.prompt}</span>
                  </button>
                ))}
              </div>
              {aiStatus.mode === "demo" && (
                <p className="notice subtle">
                  Running in demo mode. Add a free Groq or Gemini key in <b>Settings</b> for full AI answers.
                </p>
              )}
            </div>
          ) : (
            <div className="messages">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const pending = streaming && isLast && m.role === "assistant";
                return (
                  <div key={i} className={`message ${m.role} ${m.error ? "error" : ""}`}>
                    {m.role === "assistant" && <div className="avatar">✦</div>}
                    <div className="bubble">
                      {m.role === "assistant" ? (
                        m.content ? (
                          <Markdown source={m.content} />
                        ) : (
                          <div className="typing" aria-label="Prism is thinking">
                            <span />
                            <span />
                            <span />
                          </div>
                        )
                      ) : (
                        <Markdown source={m.content} />
                      )}
                      {m.role === "assistant" && m.content && !pending && (
                        <div className="messageActions">
                          {m.error ? (
                            <button onClick={retry}>
                              <RotateCcw size={13} /> Retry
                            </button>
                          ) : (
                            <>
                              <button onClick={() => copy(m.content, i)}>
                                {copied === i ? <Check size={13} /> : <Copy size={13} />}
                                {copied === i ? "Copied" : "Copy"}
                              </button>
                              <button onClick={() => saveAsDoc(m.content)}>
                                <FilePlus2 size={13} /> Save as doc
                              </button>
                              {isLast && (
                                <button onClick={retry}>
                                  <RotateCcw size={13} /> Regenerate
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {contextDoc && (
            <div className="contextChip">
              <FileText size={13} />
              Using <b>{contextDoc.title}</b> as context
              <button type="button" onClick={() => setContextDocId("")} aria-label="Remove context">
                <X size={13} />
              </button>
            </div>
          )}
          <div className="composerBox">
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Message Prism AI…"
              aria-label="Message"
            />
            <div className="composerRow">
              <select
                value={contextDocId}
                onChange={(e) => setContextDocId(e.target.value)}
                aria-label="Attach a document as context"
                className="contextSelect"
              >
                <option value="">No document attached</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    📄 {d.title || "Untitled document"}
                  </option>
                ))}
              </select>
              {streaming ? (
                <button type="button" className="sendButton stop" onClick={() => abortRef.current?.abort()} aria-label="Stop">
                  <Square size={14} />
                </button>
              ) : (
                <button type="submit" className="sendButton" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
          </div>
          <small className="composerHint">Enter to send · Shift + Enter for a new line</small>
        </form>
      </section>
    </div>
  );
}
