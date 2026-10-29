"use client";

/*
 * Small, safe Markdown renderer. It builds React elements directly, so all text
 * is escaped by React; no raw HTML from the input is ever rendered and
 * dangerouslySetInnerHTML is not used. Links are limited to http(s).
 */
import { memo, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { Source } from "./state";

type Align = "left" | "center" | "right" | undefined;

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string; open: boolean }
  | { type: "hr" }
  | { type: "quote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "table"; header: string[]; align: Align[]; rows: string[][] };

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)?.*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  const match = /^\s*/.exec(line);
  return match ? match[0].replace(/\t/g, "    ").length : 0;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === "\\" && row[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    (line.includes("|") && next !== undefined && TABLE_SEP.test(next) && next.includes("-"))
  );
}

export function parseBlocks(source: string, depth = 0): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2];
      const lang = (fence[3] ?? "").toLowerCase();
      const body: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        const candidate = lines[i].trim();
        if (candidate.startsWith(marker[0].repeat(marker.length)) && /^[`~]+$/.test(candidate)) {
          closed = true;
          i += 1;
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "code", lang, code: body.join("\n"), open: !closed });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return undefined;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const quote = QUOTE.exec(lines[i]);
        body.push(quote ? quote[1] : lines[i]);
        i += 1;
      }
      blocks.push({ type: "quote", children: depth > 8 ? [{ type: "paragraph", text: body.join("\n") }] : parseBlocks(body.join("\n"), depth + 1) });
      continue;
    }

    const list = LIST.exec(line);
    if (list) {
      const baseIndent = indentOf(line);
      const ordered = /\d/.test(list[2]);
      const start = ordered ? Number.parseInt(list[2], 10) || 1 : 1;
      const items: string[][] = [];
      let current: string[] | null = null;
      let contentIndent = baseIndent + list[2].length + 1;
      while (i < lines.length) {
        const row = lines[i];
        const item = LIST.exec(row);
        const rowIndent = indentOf(row);
        if (item && rowIndent <= baseIndent + 1 && /\d/.test(item[2]) === ordered) {
          current = [item[3]];
          items.push(current);
          contentIndent = rowIndent + item[2].length + 1;
          i += 1;
          continue;
        }
        if (item && rowIndent <= baseIndent + 1) break; // different list type
        if (isBlank(row)) {
          let j = i + 1;
          while (j < lines.length && isBlank(lines[j])) j += 1;
          const nextLine = lines[j];
          if (nextLine !== undefined && current && indentOf(nextLine) > baseIndent) {
            current.push("");
            i += 1;
            continue;
          }
          if (nextLine !== undefined && LIST.test(nextLine) && indentOf(nextLine) <= baseIndent + 1) {
            i = j;
            continue;
          }
          break;
        }
        if (current && rowIndent > baseIndent) {
          current.push(row.slice(Math.min(rowIndent, contentIndent)));
          i += 1;
          continue;
        }
        if (current && !startsBlock(row, lines[i + 1])) {
          current.push(row.trim());
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({
        type: "list",
        ordered,
        start,
        items: items.map((body) => (depth > 8 ? [{ type: "paragraph", text: body.join("\n") }] : parseBlocks(body.join("\n"), depth + 1))),
      });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

// ---------- inline ----------

export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

const INLINE =
  /\\([\\`*_{}[\]()#+\-.!|~>])|(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)|!?\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|~~(?=\S)([\s\S]+?)~~|\*(?=[^\s*])([\s\S]*?[^\s*])\*|_(?=[^\s_])([\s\S]*?[^\s_])_|<?(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]*_])>?|\n/g;

type InlineContext = { sources: Source[]; depth: number };

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

function Citation({ n, source }: { n: number; source?: Source }) {
  if (!source) return <sup className="md-cite md-cite-missing">[{n}]</sup>;
  const href = safeUrl(source.url);
  let host = "";
  try {
    host = new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  return (
    <sup className="md-cite">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer nofollow" title={`${source.title}${host ? ` — ${host}` : ""}`} aria-label={`Source ${n}: ${source.title}`}>
          {n}
        </a>
      ) : (
        <span title={source.title}>{n}</span>
      )}
    </sup>
  );
}

export function renderInline(text: string, ctx: InlineContext, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  if (ctx.depth > 6) return [text];
  const re = new RegExp(INLINE.source, "g");
  let last = 0;
  let key = 0;
  let pending = "";
  const flush = () => {
    if (pending) {
      out.push(pending);
      pending = "";
    }
  };
  const nested = (value: string) => renderInline(value, { ...ctx, depth: ctx.depth + 1 }, `${keyBase}-${key}`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const whole = match[0];
    pending += text.slice(last, start);
    last = start + whole.length;
    const k = `${keyBase}-${key++}`;

    if (match[1] !== undefined) {
      pending += match[1];
      continue;
    }
    if (match[2] !== undefined) {
      flush();
      out.push(<code key={k} className="md-inline-code">{match[3].replace(/^ (.*) $/, "$1")}</code>);
      continue;
    }
    if (match[4] !== undefined) {
      const href = safeUrl(match[5] ?? "");
      flush();
      if (href) {
        out.push(
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {nested(match[4])}
          </a>,
        );
      } else {
        out.push(<span key={k}>{nested(match[4])}</span>);
      }
      continue;
    }
    if (match[6] !== undefined) {
      flush();
      const numbers = match[6].split(/[,;]/).map((n) => Number.parseInt(n.trim(), 10));
      numbers.forEach((n, index) => {
        out.push(<Citation key={`${k}-${index}`} n={n} source={ctx.sources.find((s) => s.id === n)} />);
      });
      continue;
    }
    if (match[7] !== undefined || match[8] !== undefined) {
      if (match[8] !== undefined && (isWordChar(text[start - 1]) || isWordChar(text[last]))) {
        pending += whole[0];
        last = start + 1;
        re.lastIndex = last;
        continue;
      }
      flush();
      out.push(<strong key={k}>{nested(match[7] ?? match[8])}</strong>);
      continue;
    }
    if (match[9] !== undefined) {
      flush();
      out.push(<del key={k}>{nested(match[9])}</del>);
      continue;
    }
    if (match[10] !== undefined || match[11] !== undefined) {
      if (match[11] !== undefined && (isWordChar(text[start - 1]) || isWordChar(text[last]))) {
        pending += whole[0];
        last = start + 1;
        re.lastIndex = last;
        continue;
      }
      flush();
      out.push(<em key={k}>{nested(match[10] ?? match[11])}</em>);
      continue;
    }
    if (match[12] !== undefined) {
      const href = safeUrl(match[12]);
      flush();
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {match[12]}
          </a>
        ) : (
          match[12]
        ),
      );
      continue;
    }
    if (whole === "\n") {
      flush();
      out.push(<br key={k} />);
      continue;
    }
    pending += whole;
  }
  pending += text.slice(last);
  flush();
  return out;
}

// ---------- blocks ----------

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore */
      }
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" className={`ag-icon-btn ${className}`} onClick={() => void copy()} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      <Icon name={copied ? "check" : "copy"} size={15} />
      <span className="ag-btn-text">{copied ? "Copied" : label}</span>
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "code"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderBlocks(blocks: Block[], ctx: InlineContext, keyBase: string, tight = false): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyBase}-${index}`;
    switch (block.type) {
      case "heading": {
        const level = Math.min(6, block.level + 1);
        const content = renderInline(block.text, ctx, key);
        if (level === 2) return <h2 key={key}>{content}</h2>;
        if (level === 3) return <h3 key={key}>{content}</h3>;
        if (level === 4) return <h4 key={key}>{content}</h4>;
        if (level === 5) return <h5 key={key}>{content}</h5>;
        return <h6 key={key}>{content}</h6>;
      }
      case "paragraph":
        return tight ? <span key={key}>{renderInline(block.text, ctx, key)}</span> : <p key={key}>{renderInline(block.text, ctx, key)}</p>;
      case "code":
        return <CodeBlock key={key} lang={block.lang} code={block.code} />;
      case "hr":
        return <hr key={key} />;
      case "quote":
        return <blockquote key={key}>{renderBlocks(block.children, ctx, key)}</blockquote>;
      case "list": {
        const items = block.items.map((item, itemIndex) => {
          const itemTight = item.length > 0 && item[0].type === "paragraph";
          return (
            <li key={`${key}-${itemIndex}`}>
              {itemTight ? (
                <>
                  {renderBlocks([item[0]], ctx, `${key}-${itemIndex}-a`, true)}
                  {renderBlocks(item.slice(1), ctx, `${key}-${itemIndex}-b`)}
                </>
              ) : (
                renderBlocks(item, ctx, `${key}-${itemIndex}`)
              )}
            </li>
          );
        });
        return block.ordered ? (
          <ol key={key} start={block.start !== 1 ? block.start : undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={key} className="md-table-wrap">
            <table>
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c} style={block.align[c] ? { textAlign: block.align[c] } : undefined}>
                      {renderInline(cell, ctx, `${key}-h${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {block.header.map((_, c) => (
                      <td key={c} style={block.align[c] ? { textAlign: block.align[c] } : undefined}>
                        {renderInline(row[c] ?? "", ctx, `${key}-${r}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  });
}

export const Markdown = memo(function Markdown({ source, sources = [], className = "" }: { source: string; sources?: Source[]; className?: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source]);
  const nodes = useMemo(() => renderBlocks(blocks, { sources, depth: 0 }, "b"), [blocks, sources]);
  return <div className={`md ${className}`}>{nodes}</div>;
});
