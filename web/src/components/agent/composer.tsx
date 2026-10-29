"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Artifact } from "@/lib/agent/events";
import { Icon } from "./icons";
import { kindFromFilename, MAX_ATTACHMENT_BYTES, uid, type AgentSettings } from "./state";

export type ComposerHandle = { setText: (text: string) => void; focus: () => void };

const ACCEPT = ".txt,.csv,.tsv,.json,.md,.markdown,.log,.yaml,.yml,text/plain,text/csv,text/markdown,application/json";

export const Composer = forwardRef<ComposerHandle, {
  running: boolean;
  settings: AgentSettings;
  memoryAvailable: boolean;
  onSettings: (settings: AgentSettings) => void;
  onSend: (text: string, attachments: Artifact[]) => void;
  onStop: () => void;
  placeholder?: string;
}>(function Composer({ running, settings, memoryAvailable, onSettings, onSend, onStop, placeholder }, ref) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Artifact[]>([]);
  const [notice, setNotice] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    setText: (value: string) => {
      setText(value);
      window.requestAnimationFrame(() => {
        const area = areaRef.current;
        if (!area) return;
        area.focus();
        area.setSelectionRange(value.length, value.length);
      });
    },
    focus: () => areaRef.current?.focus(),
  }));

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function submit() {
    const value = text.trim();
    if (!value || running) return;
    onSend(value, attachments);
    setText("");
    setAttachments([]);
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: Artifact[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setNotice(`${file.name} is larger than 200 KB and was not attached.`);
        continue;
      }
      try {
        const content = await file.text();
        if (content.includes("\u0000")) {
          setNotice(`${file.name} looks like a binary file. Attach text, CSV, JSON or Markdown.`);
          continue;
        }
        next.push({ id: uid("file"), name: file.name, kind: kindFromFilename(file.name), content });
      } catch {
        setNotice(`Could not read ${file.name}.`);
      }
    }
    if (next.length) setAttachments((current) => [...current, ...next].slice(0, 5));
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="ag-composer-wrap">
      <form
        className={`ag-composer ${running ? "is-running" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {attachments.length > 0 && (
          <div className="ag-attachments">
            {attachments.map((file) => (
              <span key={file.id} className="ag-chip ag-chip-static">
                <Icon name="paperclip" size={12} />
                {file.name}
                <button type="button" className="ag-chip-x" onClick={() => setAttachments((list) => list.filter((f) => f.id !== file.id))} aria-label={`Remove ${file.name}`}>
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label className="ag-sr" htmlFor="ag-input">
          Message Prism
        </label>
        <textarea
          id="ag-input"
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={placeholder ?? "Give Prism a goal…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="ag-composer-bar">
          <div className="ag-row ag-composer-tools">
            <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
            <button type="button" className="ag-icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach a text, CSV, JSON or Markdown file (max 200 KB)" title="Attach file (max 200 KB)">
              <Icon name="paperclip" size={16} />
            </button>
            <button
              type="button"
              className={`ag-toggle ${settings.memory ? "is-on" : ""}`}
              aria-pressed={settings.memory}
              onClick={() => onSettings({ ...settings, memory: !settings.memory })}
              title={memoryAvailable ? "Let Prism search and save memories" : "Memory is not available on this deployment"}
              disabled={!memoryAvailable}
            >
              <Icon name="brain" size={14} /> Memory
            </button>
            <button
              type="button"
              className={`ag-toggle ${settings.subagents ? "is-on" : ""}`}
              aria-pressed={settings.subagents}
              onClick={() => onSettings({ ...settings, subagents: !settings.subagents })}
              title="Allow Prism to run parallel research sub-agents"
            >
              <Icon name="users" size={14} /> Sub-agents
            </button>
          </div>
          {running ? (
            <button type="button" className="ag-send ag-stop" onClick={onStop} aria-label="Stop the agent">
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button type="submit" className="ag-send" disabled={!text.trim()} aria-label="Send">
              <Icon name="send" size={16} />
            </button>
          )}
        </div>
      </form>
      <p className="ag-composer-note" aria-live="polite">
        {notice || "Enter to send, Shift+Enter for a new line. Prism asks before consequential actions."}
      </p>
    </div>
  );
});
