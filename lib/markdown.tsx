import { Fragment, type ReactNode } from "react";

/** Tiny, safe Markdown renderer (no HTML injection). */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("[")) {
      const [, label, href] = tok.match(/\[([^\]]+)\]\(([^)]+)\)/) ?? [];
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} data-lang={lang || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `h${k}`);
      blocks.push(
        level === 1 ? <h1 key={k++}>{content}</h1> : level === 2 ? <h2 key={k++}>{content}</h2> : <h3 key={k++}>{content}</h3>,
      );
      i++;
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={k++} />);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k++}>{inline(quote.join(" "), `q${k}`)}</blockquote>);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const task = text.match(/^\[( |x|X)\]\s+(.*)/);
        items.push(
          <li key={i} className={task ? "task" : undefined}>
            {task ? (
              <>
                <span className={`check ${task[1] !== " " ? "on" : ""}`} aria-hidden />
                <span className={task[1] !== " " ? "doneText" : undefined}>{inline(task[2], `t${i}`)}</span>
              </>
            ) : (
              inline(text, `l${i}`)
            )}
          </li>,
        );
        i++;
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|```|\s*([-*+]|\d+\.)\s+|\s*>)/.test(lines[i])
    )
      para.push(lines[i++]);
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${k}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className="markdown">{blocks}</div>;
}
