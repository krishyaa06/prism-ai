"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon, type IconName } from "./icons";

export type AgentStatus = {
  model: { configured: boolean; name?: string };
  search: { provider: string };
  python: boolean;
  connectors: number;
  memory: boolean;
};

type Tip = { text: string; left: number; top: number; host: Element } | null;

function Badge({ icon, label, value, tip, tone = "normal", onTip }: { icon: IconName; label: string; value: string; tip: string; tone?: "normal" | "warn" | "off"; onTip: (tip: Tip) => void }) {
  function show(event: React.SyntheticEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const host = event.currentTarget.closest(".ag-root");
    if (!host) return;
    onTip({ text: tip, left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)), top: rect.bottom + 8, host });
  }
  return (
    <span
      className={`ag-badge tone-${tone}`}
      tabIndex={0}
      aria-label={`${label}: ${value}. ${tip}`}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onTip(null)}
      onBlur={() => onTip(null)}
    >
      <Icon name={icon} size={13} />
      <span className="ag-badge-label">{label}</span>
      <span className="ag-badge-value">{value}</span>
    </span>
  );
}

export function StatusBadges({ status, failed }: { status: AgentStatus | null; failed: boolean }) {
  const [tip, setTip] = useState<Tip>(null);
  const tipNode = tip
    ? createPortal(
        <span className="ag-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.text}
        </span>,
        tip.host,
      )
    : null;
  if (failed)
    return (
      <div className="ag-badges">
        <Badge icon="alert" label="Status" value="Unavailable" tip="Could not load /api/agent/status. The agent may still work." tone="warn" onTip={setTip} />
        {tipNode}
      </div>
    );
  if (!status)
    return (
      <div className="ag-badges" aria-hidden="true">
        {[86, 92, 70, 96].map((w, i) => (
          <span key={i} className="ag-skel ag-skel-badge" style={{ width: w }} />
        ))}
      </div>
    );
  const provider = status.search?.provider || "none";
  return (
    <div className="ag-badges">
      <Badge
        icon="spark" onTip={setTip}
        label="Model"
        value={status.model?.configured ? status.model.name || "Configured" : "Not set"}
        tip={status.model?.configured ? "OpenAI-compatible model with tool calling, configured on the server." : "Set PRISM_MODEL_ENDPOINT, PRISM_MODEL_NAME and PRISM_MODEL_API_KEY."}
        tone={status.model?.configured ? "normal" : "warn"}
      />
      <Badge icon="search" onTip={setTip} label="Search" value={provider} tip={provider.toLowerCase().includes("duck") ? "Using the free DuckDuckGo fallback. Add a Tavily, Brave or Serper key for better results." : `Web search via ${provider}.`} />
      <Badge icon="code" onTip={setTip} label="Code" value={status.python ? "JS + Python" : "JS"} tip={status.python ? "JavaScript in a WASM sandbox; Python in a remote E2B sandbox." : "JavaScript runs in a WASM sandbox. Set E2B_API_KEY to enable Python."} />
      <Badge icon="plug" onTip={setTip} label="Connectors" value={String(status.connectors ?? 0)} tip="Connected services from your dashboard. Write actions always ask for approval." tone={status.connectors ? "normal" : "off"} />
      <Badge icon="brain" onTip={setTip} label="Memory" value={status.memory ? "Available" : "Off"} tip={status.memory ? "Turn Memory on in the composer to let Prism recall and save facts." : "Memory storage is not available on this deployment."} tone={status.memory ? "normal" : "off"} />
      {tipNode}
    </div>
  );
}

export function Header({
  title,
  status,
  statusFailed,
  panelOpen,
  panelCount,
  onMenu,
  onTogglePanel,
  mock,
}: {
  title: string;
  status: AgentStatus | null;
  statusFailed: boolean;
  panelOpen: boolean;
  panelCount: number;
  onMenu: () => void;
  onTogglePanel: () => void;
  mock: boolean;
}) {
  return (
    <header className="ag-header">
      <button type="button" className="ag-icon-btn ag-menu-btn" onClick={onMenu} aria-label="Open task history">
        <Icon name="menu" size={18} />
      </button>
      <div className="ag-header-main">
        <h1 className="ag-title" title={title}>
          {title}
          {mock && <span className="ag-pill ag-pill-mock">Mock data</span>}
        </h1>
        <StatusBadges status={status} failed={statusFailed} />
      </div>
      <div className="ag-row ag-header-actions">
        <ThemeToggle />
        <button type="button" className={`ag-icon-btn ag-panel-btn ${panelOpen ? "is-on" : ""}`} onClick={onTogglePanel} aria-label={panelOpen ? "Hide files and sources" : "Show files and sources"} aria-pressed={panelOpen} title="Files and sources">
          <Icon name="panel" size={17} />
          {panelCount > 0 && <span className="ag-dot-count">{panelCount}</span>}
        </button>
      </div>
    </header>
  );
}
