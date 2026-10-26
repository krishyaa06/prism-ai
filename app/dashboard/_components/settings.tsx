"use client";

import { useRef, useState } from "react";
import { Download, Eye, EyeOff, KeyRound, RotateCcw, Upload, User } from "lucide-react";
import { exportWorkspace, importWorkspace, PROVIDER_INFO, resetWorkspace, type ProviderId } from "@/lib/store";
import { streamChat } from "@/lib/ai";
import { useWorkspace } from "./context";

export function SettingsView() {
  const { settings, setSettings, toast, aiStatus } = useWorkspace();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const info = PROVIDER_INFO[settings.provider];

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      let meta = "";
      const reply = await streamChat({
        messages: [{ role: "user", content: "Reply with exactly: Prism AI is connected." }],
        settings,
        onDelta: () => {},
        onMeta: (m) => (meta = m.mode === "demo" ? "demo" : `${m.provider} · ${m.model}`),
      });
      setTestResult(
        meta === "demo"
          ? { ok: false, text: "No key found, so Prism answered in demo mode. Add a key above." }
          : { ok: true, text: `Connected to ${meta}. Reply: “${reply.trim().slice(0, 80)}”` },
      );
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="view narrow">
      <header className="viewHeader">
        <div>
          <div className="eyebrow">PREFERENCES</div>
          <h1>Settings</h1>
          <p className="muted">Everything is stored locally in this browser.</p>
        </div>
      </header>

      <section className="card settingsCard">
        <h3>
          <User size={16} /> Profile
        </h3>
        <label className="field">
          <span>Display name</span>
          <input
            value={settings.name}
            onChange={(e) => setSettings((s) => ({ ...s, name: e.target.value.slice(0, 40) }))}
            placeholder="Builder"
          />
        </label>
      </section>

      <section className="card settingsCard">
        <h3>
          <KeyRound size={16} /> AI provider
        </h3>
        <p className="muted small">
          Current status:{" "}
          <span className="aiPill inline" data-mode={aiStatus.mode}>
            <span className="statusDot" />
            {aiStatus.label}
          </span>
        </p>
        <p className="muted small">
          Prism works offline in demo mode. For full answers, paste a key from any provider below. Groq and Gemini
          offer free keys. Your key is saved only in this browser and sent only to this app&apos;s own server to
          make the request.
        </p>

        <div className="fieldGrid">
          <label className="field">
            <span>Provider</span>
            <select
              value={settings.provider}
              onChange={(e) => setSettings((s) => ({ ...s, provider: e.target.value as ProviderId, model: "" }))}
            >
              {(Object.keys(PROVIDER_INFO) as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_INFO[id].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model (optional)</span>
            <input
              value={settings.model}
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value.trim() }))}
              placeholder={info.model}
            />
          </label>
        </div>

        <label className="field">
          <span>
            API key ·{" "}
            <a href={info.keyUrl} target="_blank" rel="noreferrer">
              Get a {info.label.replace(" (free)", "")} key ↗
            </a>
          </span>
          <div className="keyInput">
            <input
              type={showKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value.trim() }))}
              placeholder="Paste your API key"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="iconButton" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"}>
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <div className="rowActions">
          <button className="primaryButton small" onClick={test} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          {settings.apiKey && (
            <button
              className="ghostButton"
              onClick={() => {
                setSettings((s) => ({ ...s, apiKey: "" }));
                setTestResult(null);
                toast("API key removed");
              }}
            >
              Remove key
            </button>
          )}
        </div>
        {testResult && <p className={`notice ${testResult.ok ? "success" : "warn"}`}>{testResult.text}</p>}
      </section>

      <section className="card settingsCard">
        <h3>
          <Download size={16} /> Your data
        </h3>
        <p className="muted small">Back up your documents, ideas and chats, or move them to another browser.</p>
        <div className="rowActions">
          <button
            className="secondaryButton"
            onClick={() => {
              const blob = new Blob([exportWorkspace()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `prism-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
              toast("Backup downloaded");
            }}
          >
            <Download size={15} /> Export backup
          </button>
          <button className="secondaryButton" onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                importWorkspace(await file.text());
                toast("Backup imported");
              } catch (err) {
                toast((err as Error).message || "Could not import that file");
              }
            }}
          />
          <button
            className="ghostButton danger"
            onClick={() => {
              if (!confirm("Reset the workspace? All documents, ideas, chats and settings in this browser will be erased.")) return;
              resetWorkspace();
              toast("Workspace reset");
            }}
          >
            <RotateCcw size={15} /> Reset workspace
          </button>
        </div>
      </section>
    </div>
  );
}
