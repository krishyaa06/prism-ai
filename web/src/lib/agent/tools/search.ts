import { z } from "zod";
import { decodeEntities } from "./html";
import { defineTool, errorMessage, shortSummary } from "./types";

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchResponse = { provider: string; results: SearchResult[] };
export type SearchFn = (query: string, maxResults: number, signal: AbortSignal) => Promise<SearchResponse>;

const TIMEOUT_MS = 15_000;
const UA = "Mozilla/5.0 (compatible; PrismAgent/2.0; +https://github.com/krishyaa06/prism-ai)";

export function configuredSearchProvider(): "tavily" | "brave" | "serper" | "searxng" | "duckduckgo" {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPER_API_KEY) return "serper";
  if (process.env.SEARXNG_URL) return "searxng";
  return "duckduckgo";
}

function withTimeout(signal: AbortSignal) {
  return AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
}

async function json(response: Response, provider: string) {
  if (!response.ok) throw new Error(`${provider} search returned HTTP ${response.status}.`);
  return response.json() as Promise<Record<string, unknown>>;
}

const stripTags = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function clean(results: Array<Partial<SearchResult>>, max: number): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const item of results) {
    if (!item.url || !/^https?:\/\//i.test(item.url) || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push({
      url: item.url,
      title: stripTags(item.title ?? item.url).slice(0, 300) || item.url,
      snippet: stripTags(item.snippet ?? "").slice(0, 600),
    });
    if (out.length >= max) break;
  }
  return out;
}

async function tavily(query: string, max: number, signal: AbortSignal) {
  const data = await json(await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: max, search_depth: "basic" }),
    signal: withTimeout(signal),
  }), "Tavily");
  const results = (data.results as Array<{ title?: string; url?: string; content?: string }>) ?? [];
  return clean(results.map((r) => ({ title: r.title, url: r.url, snippet: r.content })), max);
}

async function brave(query: string, max: number, signal: AbortSignal) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(max));
  const data = await json(await fetch(url, {
    headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY ?? "" },
    signal: withTimeout(signal),
  }), "Brave");
  const results = ((data.web as { results?: Array<{ title?: string; url?: string; description?: string }> })?.results) ?? [];
  return clean(results.map((r) => ({ title: r.title, url: r.url, snippet: r.description })), max);
}

async function serper(query: string, max: number, signal: AbortSignal) {
  const data = await json(await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY ?? "" },
    body: JSON.stringify({ q: query, num: max }),
    signal: withTimeout(signal),
  }), "Serper");
  const results = (data.organic as Array<{ title?: string; link?: string; snippet?: string }>) ?? [];
  return clean(results.map((r) => ({ title: r.title, url: r.link, snippet: r.snippet })), max);
}

async function searxng(query: string, max: number, signal: AbortSignal) {
  const url = new URL("/search", process.env.SEARXNG_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const data = await json(await fetch(url, { headers: { accept: "application/json" }, signal: withTimeout(signal) }), "SearXNG");
  const results = (data.results as Array<{ title?: string; url?: string; content?: string }>) ?? [];
  return clean(results.map((r) => ({ title: r.title, url: r.url, snippet: r.content })), max);
}

/** Extracts the real target from DuckDuckGo's `//duckduckgo.com/l/?uddg=…` redirect links. */
export function resolveDuckDuckGoHref(href: string) {
  const decoded = decodeEntities(href);
  try {
    const url = new URL(decoded, "https://duckduckgo.com");
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) {
      const target = url.searchParams.get("uddg");
      return target ?? null;
    }
    if (url.hostname.endsWith("duckduckgo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Parses https://html.duckduckgo.com/html/ result pages. */
export function parseDuckDuckGoHtml(html: string, max = 10): SearchResult[] {
  const results: Array<Partial<SearchResult>> = [];
  const blocks = html.split(/(?=<div[^>]+class="[^"]*\bresult\b)/i).slice(1);
  for (const block of blocks) {
    if (/result--ad\b/.test(block.slice(0, 200)) || /badge--ad/.test(block)) continue;
    const link = /<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
      ?? /<a[^>]+href="([^"]+)"[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!link) continue;
    const url = resolveDuckDuckGoHref(link[1]);
    if (!url || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(block)?.[1] ?? "";
    results.push({ url, title: link[2], snippet });
  }
  return clean(results, max);
}

async function duckduckgo(query: string, max: number, signal: AbortSignal) {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, accept: "text/html" },
    body: new URLSearchParams({ q: query, kl: "wt-wt" }).toString(),
    signal: withTimeout(signal),
  });
  if (!response.ok || response.status === 202) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}. Configure TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or SERPER_API_KEY for reliable search.`);
  }
  const html = await response.text();
  const results = parseDuckDuckGoHtml(html, max);
  if (!results.length && /anomaly|captcha|challenge-form/i.test(html)) {
    throw new Error("DuckDuckGo temporarily blocked automated search. Configure TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or SERPER_API_KEY for reliable search.");
  }
  return results;
}

const PROVIDERS = { tavily, brave, serper, searxng, duckduckgo } as const;

export const webSearch: SearchFn = async (query, maxResults, signal) => {
  const provider = configuredSearchProvider();
  try {
    return { provider, results: await PROVIDERS[provider](query, maxResults, signal) };
  } catch (error) {
    if (provider === "duckduckgo" || signal.aborted) throw error;
    // Configured provider failed: fall back to DuckDuckGo rather than failing the task.
    return { provider: "duckduckgo", results: await duckduckgo(query, maxResults, signal) };
  }
};

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the web. Returns numbered results (title, url, snippet). Each result becomes a citable source [n]. Use several focused queries for broad topics; follow up with fetch_url to read the best pages.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Short natural-language search query." },
      max_results: { type: "integer", minimum: 1, maximum: 10, description: "Default 6." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  schema: z.object({ query: z.string().trim().min(1).max(400), max_results: z.coerce.number().int().min(1).max(10).optional() }),
  label: (args) => `Searching “${args.query.slice(0, 80)}”`,
  parallelSafe: true,
  run: async (args, ctx) => {
    try {
      const { provider, results } = await ctx.deps.search(args.query, args.max_results ?? 6, ctx.signal);
      if (!results.length) return { ok: true, summary: "No results.", content: "No results found. Try a different query.", untrusted: true };
      const lines = results.map((r) => {
        const id = ctx.state.sources.add({ url: r.url, title: r.title, snippet: r.snippet });
        return `[${id}] ${r.title}\n${r.url}\n${r.snippet}`;
      });
      return {
        ok: true,
        summary: shortSummary(`${results.length} results via ${provider}: ${results.slice(0, 3).map((r) => r.title).join(" · ")}`),
        content: lines.join("\n\n"),
        untrusted: true,
        data: { provider, results: results.map((r) => ({ title: r.title, url: r.url })) },
      };
    } catch (error) {
      return { ok: false, summary: shortSummary(`Search failed: ${errorMessage(error)}`), content: `Search failed: ${errorMessage(error)}` };
    }
  },
});
