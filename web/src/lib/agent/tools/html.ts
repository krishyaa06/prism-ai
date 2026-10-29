const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", copy: "©", reg: "®", trade: "™", middot: "·",
  bull: "•", laquo: "«", raquo: "»", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", times: "×",
  divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", eacute: "é", egrave: "è", agrave: "à",
  aacute: "á", ouml: "ö", uuml: "ü", auml: "ä", szlig: "ß", ccedil: "ç", ntilde: "ñ", rarr: "→", larr: "←",
};

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,8});/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

const inlineText = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function extractTitle(html: string) {
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]
    ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return inlineText(title || og || h1 || "").slice(0, 300);
}

function absolutize(href: string, base?: string) {
  try {
    const url = new URL(decodeEntities(href), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Converts an HTML document into readable, markdown-ish text. */
export function htmlToReadable(html: string, baseUrl?: string): { title: string; text: string } {
  const title = extractTitle(html);
  let body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed|select|button|nav|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(head)\b[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<(link|meta|input|img|source|track|wbr|area|base|col|param)\b[^>]*>/gi, " ");

  // Prefer the main content region when it is substantial.
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(body)?.[1] ?? /<article\b[^>]*>([\s\S]*)<\/article\s*>/i.exec(body)?.[1];
  if (main && inlineText(main).length > 200) body = main;

  body = body
    // links → [text](url)
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, href: string, inner: string) => {
      const text = inlineText(inner);
      if (!text) return " ";
      const url = absolutize(href, baseUrl);
      if (!url || href.startsWith("#")) return ` ${text} `;
      return ` [${text}](${url}) `;
    })
    // headings
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) =>
      `\n\n${"#".repeat(Number(level))} ${inlineText(inner)}\n\n`)
    // code blocks
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_m, inner: string) =>
      `\n\n\`\`\`\n${inner.replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim()}\n\`\`\`\n\n`)
    // tables
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi, (_m, inner: string) => {
      const cells = [...inner.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map((c) => inlineText(c[1]).replace(/\|/g, "\\|"));
      if (!cells.length) return "";
      const header = /<th\b/i.test(inner) ? `\n|${" --- |".repeat(cells.length)}` : "";
      return `\n| ${cells.join(" | ")} |${header}`;
    })
    .replace(/<\/(table|thead|tbody)\s*>/gi, "\n\n")
    // lists
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol)\s*>/gi, "\n\n")
    // inline emphasis
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _t, inner: string) => {
      const text = inlineText(inner);
      return text ? ` **${text}** ` : " ";
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, (_m, inner: string) => ` \`${inlineText(inner)}\` `)
    // block boundaries
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|main|blockquote|figure|figcaption|dl|dt|dd|hr|table|caption)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v\u00a0]+/g, " ").replace(/ +([.,;:!?)])/g, "$1").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}
