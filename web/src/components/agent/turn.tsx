"use client";

import { memo, useEffect, useState } from "react";
import type { Artifact, PlanStep } from "@/lib/agent/events";
import { Icon, toolIcon } from "./icons";
import { CopyButton, Markdown, safeUrl } from "./markdown";
import type { ActivityItem, AssistantTurn, PendingApproval, SubagentState, UserTurn } from "./state";

export function prettyTool(name: string): string {
  if (name.startsWith("mcp__")) {
    const [, connector = "", tool = ""] = name.split("__");
    return `${connector} · ${tool.replace(/_/g, " ")}`;
  }
  return name.replace(/_/g, " ");
}

function Spinner({ size = 14 }: { size?: number }) {
  return <span className="ag-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

function StatusLine({ text }: { text: string }) {
  return (
    <div className="ag-status" role="status" aria-live="polite">
      <span className="ag-status-orb" aria-hidden="true" />
      <span className="ag-shimmer">{text}</span>
    </div>
  );
}

function Plan({ steps, running }: { steps: PlanStep[]; running: boolean }) {
  const [open, setOpen] = useState(true);
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <section className="ag-card ag-plan" aria-label="Plan">
      <button type="button" className="ag-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="list" size={15} />
        <span>Plan</span>
        <span className="ag-progress" aria-hidden="true">
          <span style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
        </span>
        <span className="ag-muted ag-small">
          {done}/{steps.length}
        </span>
        <Icon name="chevron" size={14} className={`ag-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && (
        <ol className="ag-plan-steps">
          {steps.map((step, index) => (
            <li key={`${index}-${step.title}`} className={`is-${step.status}`}>
              <span className="ag-step-icon" aria-hidden="true">
                {step.status === "done" ? <Icon name="check" size={13} /> : step.status === "in_progress" && running ? <Spinner size={12} /> : <span className="ag-step-dot" />}
              </span>
              <span>{step.title}</span>
              <span className="ag-sr">{step.status === "done" ? "(done)" : step.status === "in_progress" ? "(in progress)" : "(pending)"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const [open, setOpen] = useState(false);
  const hasArgs = Object.keys(item.args ?? {}).length > 0;
  const duration = item.finishedAt ? Math.max(0, item.finishedAt - item.startedAt) : 0;
  return (
    <li className={`ag-act is-${item.state}`}>
      <span className="ag-act-icon" aria-hidden="true">
        <Icon name={toolIcon(item.name)} size={14} />
      </span>
      <div className="ag-act-body">
        <button type="button" className="ag-act-line" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!hasArgs && !item.summary}>
          <span className="ag-act-label">{item.label}</span>
          <span className="ag-act-state">
            {item.state === "running" ? <Spinner size={11} /> : item.state === "ok" ? <Icon name="check" size={13} /> : <Icon name="alert" size={13} />}
            <span className="ag-sr">{item.state === "running" ? "running" : item.state === "ok" ? "succeeded" : "failed"}</span>
          </span>
          {duration > 0 && <span className="ag-muted ag-small ag-act-time">{duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(1)} s`}</span>}
        </button>
        {item.summary && <p className="ag-act-summary">{item.summary}</p>}
        {open && hasArgs && (
          <pre className="ag-json" aria-label="Tool arguments">
            {JSON.stringify(item.args, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}

function Activity({ items, running }: { items: ActivityItem[]; running: boolean }) {
  const [open, setOpen] = useState(true);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setOpen(running);
  }, [running, touched]);
  const failures = items.filter((i) => i.state === "error").length;
  return (
    <section className="ag-card ag-activity" aria-label="Tool activity">
      <button
        type="button"
        className="ag-card-head"
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
      >
        <Icon name="sparkle" size={15} />
        <span>{running ? "Working" : "Worked"} · {items.length} {items.length === 1 ? "step" : "steps"}</span>
        {failures > 0 && <span className="ag-pill ag-pill-warn">{failures} failed</span>}
        <span className="ag-act-strip" aria-hidden="true">
          {items.slice(-6).map((item) => (
            <Icon key={item.id} name={toolIcon(item.name)} size={13} />
          ))}
        </span>
        <Icon name="chevron" size={14} className={`ag-chev ${open ? "is-open" : ""}`} />
      </button>
      {open && <ol className="ag-acts">{items.map((item) => <ActivityRow key={item.id} item={item} />)}</ol>}
    </section>
  );
}

function Subagents({ items }: { items: SubagentState[] }) {
  return (
    <section className="ag-subagents" aria-label="Sub-agents">
      <div className="ag-section-label">
        <Icon name="users" size={14} /> Sub-agents
      </div>
      <div className="ag-sub-grid">
        {items.map((item, index) => (
          <article key={item.id} className={`ag-sub is-${item.status}`}>
            <header>
              <span className="ag-sub-num">R{index + 1}</span>
              <span className={`ag-pill ag-pill-${item.status}`}>
                {item.status === "running" && <Spinner size={9} />}
                {item.status === "running" ? "Researching" : item.status === "done" ? "Done" : "Failed"}
              </span>
            </header>
            <p className="ag-sub-task">{item.task}</p>
            {item.summary ? <p className="ag-sub-summary">{item.summary}</p> : item.status === "running" ? <span className="ag-skel ag-skel-line" /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function ApprovalCard({ approval, disabled, onAnswer }: { approval: PendingApproval; disabled: boolean; onAnswer: (approved: boolean) => void }) {
  if (approval.answered) {
    return (
      <div className={`ag-approval-done ${approval.approved ? "is-yes" : "is-no"}`}>
        <Icon name={approval.approved ? "check" : "x"} size={14} />
        {approval.approved ? "Approved" : "Declined"}: <code>{prettyTool(approval.tool)}</code>
      </div>
    );
  }
  return (
    <section className="ag-card ag-approval" aria-label="Approval required">
      <div className="ag-approval-head">
        <span className="ag-approval-icon">
          <Icon name="shield" size={18} />
        </span>
        <div>
          <strong>Approval needed</strong>
          <p>Prism paused before a consequential action. Nothing has been sent or changed yet.</p>
        </div>
      </div>
      <dl className="ag-approval-meta">
        <dt>Action</dt>
        <dd>
          <code>{prettyTool(approval.tool)}</code>
        </dd>
        {approval.reason && (
          <>
            <dt>Why</dt>
            <dd>{approval.reason}</dd>
          </>
        )}
      </dl>
      <pre className="ag-json" aria-label="Action arguments">
        {JSON.stringify(approval.args, null, 2)}
      </pre>
      <div className="ag-row ag-approval-actions">
        <button type="button" className="ag-btn ag-btn-primary" disabled={disabled} onClick={() => onAnswer(true)}>
          <Icon name="check" size={15} /> Approve
        </button>
        <button type="button" className="ag-btn" disabled={disabled} onClick={() => onAnswer(false)}>
          <Icon name="x" size={15} /> Decline
        </button>
      </div>
    </section>
  );
}

export const UserBubble = memo(function UserBubble({ turn }: { turn: UserTurn }) {
  return (
    <div className="ag-user">
      <div className="ag-user-bubble">
        {turn.attachments?.length ? (
          <div className="ag-user-attach">
            {turn.attachments.map((name) => (
              <span key={name} className="ag-chip ag-chip-static">
                <Icon name="paperclip" size={12} /> {name}
              </span>
            ))}
          </div>
        ) : null}
        <p>{turn.content}</p>
      </div>
    </div>
  );
});

export const AssistantTurnView = memo(function AssistantTurnView({
  turn,
  artifacts,
  isLast,
  busy,
  onApproval,
  onAnswer,
  onRetry,
  onOpenArtifact,
  onOpenSources,
}: {
  turn: AssistantTurn;
  artifacts: Artifact[];
  isLast: boolean;
  busy: boolean;
  onApproval: (turnId: string, callId: string, approved: boolean) => void;
  onAnswer: (text: string) => void;
  onRetry: (turnId: string) => void;
  onOpenArtifact: (id: string) => void;
  onOpenSources: () => void;
}) {
  const activity = turn.activity.filter((a) => a.name !== "update_plan");
  const created = turn.artifactIds.map((id) => artifacts.find((a) => a.id === id)).filter((a): a is Artifact => !!a);
  const nothingYet = turn.running && !turn.text && !activity.length && !turn.plan.length;
  const openApprovals = turn.approvals.filter((a) => !a.answered);
  return (
    <article className="ag-assistant" aria-label="Prism response" aria-busy={turn.running}>
      <div className="ag-avatar" aria-hidden="true">
        <Icon name="spark" size={14} />
      </div>
      <div className="ag-assistant-body">
        {turn.plan.length > 0 && <Plan steps={turn.plan} running={turn.running} />}
        {activity.length > 0 && <Activity items={activity} running={turn.running} />}
        {turn.subagents.length > 0 && <Subagents items={turn.subagents} />}
        {turn.running && turn.status && <StatusLine text={turn.status} />}
        {nothingYet && (
          <div className="ag-skel-group" aria-hidden="true">
            <span className="ag-skel ag-skel-line" style={{ width: "72%" }} />
            <span className="ag-skel ag-skel-line" style={{ width: "54%" }} />
          </div>
        )}
        {turn.text && (
          <div className={`ag-answer ${turn.running ? "is-streaming" : ""}`}>
            <Markdown source={turn.text} sources={turn.sources} />
          </div>
        )}
        {created.length > 0 && (
          <div className="ag-created">
            {created.map((artifact) => (
              <button key={artifact.id} type="button" className="ag-chip" onClick={() => onOpenArtifact(artifact.id)} aria-label={`Open file ${artifact.name}`}>
                <Icon name={artifact.kind === "html" ? "globe" : artifact.kind === "code" || artifact.kind === "json" ? "code" : "file"} size={13} />
                {artifact.name}
              </button>
            ))}
          </div>
        )}
        {turn.sources.length > 0 && !turn.running && (
          <div className="ag-source-row" aria-label="Sources">
            {turn.sources.slice(0, 6).map((source) => {
              const href = safeUrl(source.url);
              let host = source.url;
              try {
                host = new URL(source.url).hostname.replace(/^www\./, "");
              } catch {
                /* raw */
              }
              return href ? (
                <a key={`${source.id}-${source.url}`} className="ag-source-chip" href={href} target="_blank" rel="noopener noreferrer nofollow" title={source.title}>
                  <span className="ag-source-num">{source.id}</span>
                  <span className="ag-source-host">{host}</span>
                </a>
              ) : null;
            })}
            <button type="button" className="ag-link-btn" onClick={onOpenSources}>
              {turn.sources.length > 6 ? `+${turn.sources.length - 6} more` : "View sources"}
            </button>
          </div>
        )}
        {turn.approvals.map((approval) => (
          <ApprovalCard key={approval.callId} approval={approval} disabled={busy || !isLast} onAnswer={(approved) => onApproval(turn.id, approval.callId, approved)} />
        ))}
        {turn.question && (
          <section className="ag-card ag-question" aria-label="Question from Prism">
            <div className="ag-row">
              <Icon name="message" size={16} />
              <strong>Prism needs your input</strong>
            </div>
            <p>{turn.question.text}</p>
            {turn.question.options?.length ? (
              <div className="ag-options">
                {turn.question.options.map((option) => (
                  <button key={option} type="button" className="ag-option" disabled={busy || !isLast} onClick={() => onAnswer(option)}>
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
            {isLast && <small className="ag-muted">Or type your answer below.</small>}
          </section>
        )}
        {turn.error && (
          <div className="ag-error" role="alert">
            <Icon name="alert" size={16} />
            <div>
              <strong>The run failed</strong>
              <p>{turn.error}</p>
            </div>
            {isLast && (
              <button type="button" className="ag-btn" onClick={() => onRetry(turn.id)} disabled={busy}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            )}
          </div>
        )}
        {turn.stopped && !turn.error && (
          <div className="ag-stopped">
            <span>Stopped before finishing.</span>
            {isLast && !openApprovals.length && (
              <button type="button" className="ag-link-btn" onClick={() => onRetry(turn.id)} disabled={busy}>
                Run again
              </button>
            )}
          </div>
        )}
        {!turn.running && turn.text && (
          <div className="ag-turn-foot">
            <CopyButton text={turn.text} label="Copy answer" />
            {turn.usage && (
              <span className="ag-muted ag-small">
                {turn.usage.rounds} {turn.usage.rounds === 1 ? "round" : "rounds"} · {turn.usage.toolCalls} tool {turn.usage.toolCalls === 1 ? "call" : "calls"}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
