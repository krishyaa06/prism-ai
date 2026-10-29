"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Artifact } from "@/lib/agent/events";
import { Icon, type IconName } from "./icons";
import { CopyButton, Markdown, safeUrl } from "./markdown";
import { mimeFor, type Source } from "./state";

export type SourceGroup = { turnId: string; question: string; sources: Source[] };

const KIND_ICON: Record<Artifact["kind"], IconName> = {
  markdown: "file",
  html: "globe",
  code: "code",
  csv: "list",
  json: "code",
  svg: "sparkle",
  text: "file",
};

const KIND_LABEL: Record<Artifact["kind"], string> = {
  markdown: "Markdown",
  html: "HTML",
  code: "Code",
  csv: "CSV",
  json: "JSON",
  svg: "SVG",
  text: "Text",
};

function formatBytes(text: string): string {
  const bytes = new Blob([text]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function parseCsv(text: string, delimiter: string, maxRows: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows + 1), truncated: true };
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((c) => c !== "")), truncated: false };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgDocument(svg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style></head><body>${svg}</body></html>`;
}

function downloadArtifact(artifact: Artifact) {
  const blob = new Blob([artifact.content], { type: mimeFor(artifact) });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = artifact.name || "file.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Open HTML in a new tab, still isolated inside a sandboxed, opaque-origin iframe. */
function openHtmlInTab(artifact: Artifact) {
  const doc = artifact.kind === "svg" ? svgDocument(artifact.content) : artifact.content;
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttr(artifact.name)}</title><style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts" title="${escapeAttr(artifact.name)}" srcdoc="${escapeAttr(doc)}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html;charset=utf-8" }));
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function LinedText({ text }: { text: string }) {
  const lines = useMemo(() => {
    const all = text.split("\n");
    return all.length > 5000 ? [...all.slice(0, 5000), `… ${all.length - 5000} more lines`] : all;
  }, [text]);
  return (
    <div className="ag-lined" role="region" aria-label="File contents">
      <pre>
        {lines.map((line, index) => (
          <span className="ag-line" key={index}>
            <span className="ag-ln" aria-hidden="true">{index + 1}</span>
            <span className="ag-lc">{line || " "}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}

function CsvTable({ artifact }: { artifact: Artifact }) {
  const { rows, truncated } = useMemo(() => {
    const firstLine = artifact.content.split("\n", 1)[0] ?? "";
    const delimiter = artifact.name.toLowerCase().endsWith(".tsv") || (firstLine.includes("\t") && !firstLine.includes(",")) ? "\t" : ",";
    return parseCsv(artifact.content, delimiter, 500);
  }, [artifact.content, artifact.name]);
  if (!rows.length) return <p className="ag-muted ag-pad">Empty CSV file.</p>;
  const [header, ...body] = rows;
  return (
    <div className="ag-csv">
      <table>
        <thead>
          <tr>
            <th className="ag-csv-idx">#</th>
            {header.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              <td className="ag-csv-idx">{r + 1}</td>
              {header.map((_, c) => (
                <td key={c}>{row[c] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="ag-muted ag-pad">Showing the first 500 rows. Download the file to see everything.</p>}
    </div>
  );
}

export function ArtifactPreview({ artifact, tall = false }: { artifact: Artifact; tall?: boolean }) {
  switch (artifact.kind) {
    case "markdown":
      return (
        <div className="ag-preview-scroll">
          <Markdown source={artifact.content} className="ag-pad" />
        </div>
      );
    case "html":
    case "svg":
      return (
        <iframe
          className={`ag-frame ${tall ? "ag-frame-tall" : ""}`}
          title={`Preview of ${artifact.name}`}
          sandbox="allow-scripts"
          srcDoc={artifact.kind === "svg" ? svgDocument(artifact.content) : artifact.content}
          referrerPolicy="no-referrer"
        />
      );
    case "csv":
      return <CsvTable artifact={artifact} />;
    case "json": {
      let pretty = artifact.content;
      try {
        pretty = JSON.stringify(JSON.parse(artifact.content), null, 2);
      } catch {
        /* show raw */
      }
      return <LinedText text={pretty} />;
    }
    default:
      return <LinedText text={artifact.content} />;
  }
}

function ArtifactToolbar({ artifact, onFullscreen, inModal = false }: { artifact: Artifact; onFullscreen?: () => void; inModal?: boolean }) {
  const canOpen = artifact.kind === "html" || artifact.kind === "svg";
  return (
    <div className="ag-art-toolbar">
      <CopyButton text={artifact.content} label="Copy" />
      <button type="button" className="ag-icon-btn" onClick={() => downloadArtifact(artifact)} aria-label={`Download ${artifact.name}`} title="Download">
        <Icon name="download" size={15} />
        <span className="ag-btn-text">Download</span>
      </button>
      {canOpen && (
        <button type="button" className="ag-icon-btn" onClick={() => openHtmlInTab(artifact)} aria-label="Open in new tab" title="Open in new tab">
          <Icon name="external" size={15} />
          <span className="ag-btn-text">Open</span>
        </button>
      )}
      {!inModal && onFullscreen && (
        <button type="button" className="ag-icon-btn" onClick={onFullscreen} aria-label="Full screen" title="Full screen">
          <Icon name="expand" size={15} />
        </button>
      )}
    </div>
  );
}

function FullscreenModal({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="ag-modal" role="dialog" aria-modal="true" aria-label={`${artifact.name} full screen`}>
      <div className="ag-modal-head">
        <span className="ag-art-name">
          <Icon name={KIND_ICON[artifact.kind]} size={16} />
          {artifact.name}
        </span>
        <div className="ag-row">
          <ArtifactToolbar artifact={artifact} inModal />
          <button ref={closeRef} type="button" className="ag-icon-btn" onClick={onClose} aria-label="Close full screen" title="Close (Esc)">
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
      <div className="ag-modal-body">
        <ArtifactPreview artifact={artifact} tall />
      </div>
    </div>
  );
}

function SourcesList({ groups }: { groups: SourceGroup[] }) {
  const nonEmpty = groups.filter((g) => g.sources.length);
  if (!nonEmpty.length)
    return (
      <div className="ag-panel-empty">
        <Icon name="globe" size={22} />
        <p>Sources the agent reads and cites will appear here.</p>
      </div>
    );
  return (
    <div className="ag-sources">
      {nonEmpty
        .slice()
        .reverse()
        .map((group) => (
          <section key={group.turnId} className="ag-source-group">
            <h3 title={group.question}>{group.question}</h3>
            <ol>
              {group.sources.map((source) => {
                const href = safeUrl(source.url);
                let host = source.url;
                try {
                  host = new URL(source.url).hostname.replace(/^www\./, "");
                } catch {
                  /* keep raw */
                }
                return (
                  <li key={`${source.id}-${source.url}`} id={`src-${group.turnId}-${source.id}`}>
                    <span className="ag-source-num">{source.id}</span>
                    <div>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                          {source.title || host}
                        </a>
                      ) : (
                        <span>{source.title || host}</span>
                      )}
                      <small>{host}</small>
                      {source.snippet && <p>{source.snippet}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
    </div>
  );
}

export function RightPanel({
  artifacts,
  selectedId,
  onSelect,
  sourceGroups,
  tab,
  onTab,
  onClose,
}: {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sourceGroups: SourceGroup[];
  tab: "files" | "sources";
  onTab: (tab: "files" | "sources") => void;
  onClose: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[artifacts.length - 1];
  const sourceCount = sourceGroups.reduce((sum, g) => sum + g.sources.length, 0);

  function onTabKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = tab === "files" ? "sources" : "files";
      onTab(next);
      document.getElementById(`ag-tab-${next}`)?.focus();
    }
  }

  return (
    <div className="ag-right-inner">
      <div className="ag-right-head">
        <div className="ag-tabs" role="tablist" aria-label="Workspace panel" onKeyDown={onTabKey}>
          <button id="ag-tab-files" role="tab" type="button" aria-selected={tab === "files"} aria-controls="ag-tabpanel" tabIndex={tab === "files" ? 0 : -1} className="ag-tab" onClick={() => onTab("files")}>
            Files {artifacts.length > 0 && <span className="ag-count">{artifacts.length}</span>}
          </button>
          <button id="ag-tab-sources" role="tab" type="button" aria-selected={tab === "sources"} aria-controls="ag-tabpanel" tabIndex={tab === "sources" ? 0 : -1} className="ag-tab" onClick={() => onTab("sources")}>
            Sources {sourceCount > 0 && <span className="ag-count">{sourceCount}</span>}
          </button>
        </div>
        <button type="button" className="ag-icon-btn" onClick={onClose} aria-label="Close panel" title="Close panel">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div id="ag-tabpanel" role="tabpanel" aria-labelledby={`ag-tab-${tab}`} className="ag-tabpanel">
        {tab === "sources" ? (
          <SourcesList groups={sourceGroups} />
        ) : !artifacts.length ? (
          <div className="ag-panel-empty">
            <Icon name="file" size={22} />
            <p>Files, reports, charts and data the agent creates will appear here. Attached files show up here too.</p>
          </div>
        ) : (
          <>
            <ul className="ag-file-list" aria-label="Files">
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <button
                    type="button"
                    className={`ag-file ${selected?.id === artifact.id ? "is-active" : ""}`}
                    onClick={() => onSelect(artifact.id)}
                    aria-current={selected?.id === artifact.id ? "true" : undefined}
                  >
                    <span className={`ag-file-icon kind-${artifact.kind}`}>
                      <Icon name={KIND_ICON[artifact.kind]} size={15} />
                    </span>
                    <span className="ag-file-meta">
                      <span className="ag-file-name">{artifact.name}</span>
                      <small>
                        {KIND_LABEL[artifact.kind]}
                        {artifact.language ? ` · ${artifact.language}` : ""} · {formatBytes(artifact.content)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && (
              <div className="ag-art-view">
                <div className="ag-art-head">
                  <span className="ag-art-name" title={selected.name}>
                    {selected.name}
                  </span>
                  <ArtifactToolbar artifact={selected} onFullscreen={() => setFullscreen(true)} />
                </div>
                <div className="ag-art-body" key={selected.id}>
                  <ArtifactPreview artifact={selected} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {fullscreen && selected && <FullscreenModal artifact={selected} onClose={() => setFullscreen(false)} />}
    </div>
  );
}
