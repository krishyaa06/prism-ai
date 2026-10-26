/**
 * Offline "demo mode" replies, used when no AI provider key is configured.
 * They are rule-based, so the app stays fully usable without any API key.
 */

const STOP = new Set(
  "a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your we our they them can not".split(
    " ",
  ),
);

function plain(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s?)/, "").trim())
    .filter(Boolean)
    .map((l) => (/[.!?:]$/.test(l) ? l : l + "."))
    .join(" ")
    .replace(/[*_`]/g, "");
}

function sentences(text: string) {
  return plain(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s, i, all) => s.length > 20 && all.indexOf(s) === i);
}

function keywords(text: string, limit = 6) {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOP.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

function summarize(text: string) {
  const all = sentences(text);
  const keys = keywords(plain(text), 10);
  const scored = all
    .map((s, i) => ({
      s,
      i,
      score: keys.reduce((n, k) => n + (s.toLowerCase().includes(k) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i);
  return { points: scored.map((x) => x.s), keys: keys.slice(0, 6) };
}

const FOOTER =
  "\n\n> Demo mode: Prism is running offline. Add a free Groq or Gemini key in Settings for full AI answers.";

export function buildDemoReply(prompt: string, context = "") {
  const p = prompt.toLowerCase();
  const source = context || (prompt.length > 280 ? prompt : "");

  if (source && /(summar|tl;?dr|key points|overview)/.test(p + (context ? " summarize" : ""))) {
    const { points, keys } = summarize(source);
    if (points.length) {
      return (
        `## Summary\n\n${points.map((s) => `- ${s}`).join("\n")}\n\n` +
        `**Key themes:** ${keys.map((k) => `\`${k}\``).join(", ")}` +
        `\n\n**Length:** ${plain(source).split(/\s+/).filter(Boolean).length} words` +
        FOOTER
      );
    }
  }

  if (/(idea|brainstorm|hackathon|project)/.test(p)) {
    return (
      "## Idea starters\n\n" +
      "1. **Study Sync**: a shared focus timer for friends with weekly streaks.\n" +
      "2. **Commit Coach**: a bot that reviews your GitHub activity and suggests the next small task.\n" +
      "3. **Event Pulse**: a Discord bot that turns hackathon chatter into a live FAQ.\n\n" +
      "**Next step:** pick one, write the problem in one sentence, then list the three screens you need for an MVP." +
      FOOTER
    );
  }

  if (/(plan|roadmap|steps|schedule)/.test(p)) {
    return (
      "## A simple plan\n\n" +
      "1. **Define** the outcome in one sentence.\n" +
      "2. **Break it down** into 3-5 milestones.\n" +
      "3. **Timebox** each milestone and start with the riskiest one.\n" +
      "4. **Review** progress every few days and cut scope early.\n\n" +
      "Save this as a document and fill in each step." +
      FOOTER
    );
  }

  if (/^(hi|hello|hey|namaste|yo)\b/.test(p.trim())) {
    return (
      "Hey, I'm **Prism AI**. I can help you summarize documents, brainstorm ideas and plan projects.\n\n" +
      "Try asking:\n- *Summarize this document*\n- *Give me hackathon ideas*\n- *Make a plan for my portfolio site*" +
      FOOTER
    );
  }

  const keys = keywords(prompt, 4);
  return (
    `I'd love to help with **${keys.length ? keys.join(", ") : "that"}**.\n\n` +
    "Right now I'm in offline demo mode, so I can only summarize documents, suggest ideas and draft simple plans. " +
    "For full answers to any question, connect an AI provider in **Settings** (Groq and Gemini both have free keys)." +
    FOOTER
  );
}
