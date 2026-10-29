import { z } from "zod";
import { Agent, fetch as undiciFetch } from "undici";
import { assertPublicHost, assertSafeUrl, BlockedUrlError, guardedConnectLookup, systemLookup, truncate, type LookupFn } from "../safety";
import { htmlToReadable } from "./html";
import { defineTool, errorMessage, shortSummary } from "./types";

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;
const UA = "Mozilla/5.0 (compatible; PrismAgent/2.0; +https://github.com/krishyaa06/prism-ai)";

export type FetchedPage = { url: string; title: string; text: string; contentType: string; truncated: boolean };
export type FetchPageFn = (url: string, maxChars: number, signal: AbortSignal) => Promise<FetchedPage>;

type MinimalResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};
export type HttpFetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<MinimalResponse>;

let guardedAgent: Agent | undefined;

/** Real transport: redirects are manual and every TCP connection re-validates the resolved IP. */
const defaultHttpFetch: HttpFetch = async (url, init) => {
  guardedAgent ??= new Agent({
    connect: { lookup: guardedConnectLookup as never, timeout: 10_000 },
    headersTimeout: TIMEOUT_MS,
    bodyTimeout: TIMEOUT_MS,
  });
  const response = await undiciFetch(url, { ...init, redirect: "manual", dispatcher: guardedAgent });
  return response as unknown as MinimalResponse;
};

async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number) {
  if (!body) return { bytes: new Uint8Array(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

function charsetOf(contentType: string) {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, "").toLowerCase();
  try {
    return charset ? new TextDecoder(charset) : new TextDecoder("utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

export type FetchOptions = { maxChars?: number; signal?: AbortSignal; httpFetch?: HttpFetch; lookup?: LookupFn };

/** Fetches a public URL with SSRF protection on every hop and returns readable text. */
export async function fetchReadable(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const maxChars = Math.min(Math.max(options.maxChars ?? 20_000, 500), 60_000);
  const httpFetch = options.httpFetch ?? defaultHttpFetch;
  const lookup = options.lookup ?? systemLookup;
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(TIMEOUT_MS)]);

  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    await assertPublicHost(url.hostname, lookup);
    const response = await httpFetch(url.toString(), {
      signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5", "accept-language": "en;q=0.9,*;q=0.5" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new Error(`Redirect (HTTP ${response.status}) without a Location header.`);
      if (hop >= MAX_REDIRECTS) throw new BlockedUrlError(`Too many redirects (max ${MAX_REDIRECTS}).`);
      url = assertSafeUrl(new URL(location, url));
      continue;
    }
    if (response.status >= 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`The page returned HTTP ${response.status}.`);
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const finalUrl = url.toString();
    if (contentType.includes("application/pdf") || /\.pdf($|\?)/i.test(url.pathname)) {
      await response.body?.cancel().catch(() => undefined);
      return { url: finalUrl, title: url.pathname.split("/").pop() || finalUrl, contentType: "application/pdf", truncated: false,
        text: "PDF not supported yet: Prism cannot extract text from PDF documents. Look for an HTML version or summary of this document instead." };
    }
    const isHtml = contentType.includes("html") || contentType.includes("xml") || !contentType;
    const isText = contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("javascript") || contentType.includes("csv");
    if (!isHtml && !isText) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Unsupported content type (${contentType.split(";")[0]}).`);
    }
    const { bytes, truncated: bodyTruncated } = await readCapped(response.body, MAX_BODY_BYTES);
    const raw = charsetOf(contentType).decode(bytes);
    let title = "";
    let text: string;
    if (contentType.includes("json")) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        text = raw;
      }
    } else if (isHtml && (contentType.includes("html") || /<html|<body|<!doctype html/i.test(raw.slice(0, 2000)))) {
      ({ title, text } = htmlToReadable(raw, finalUrl));
    } else {
      text = raw;
    }
    const truncated = bodyTruncated || text.length > maxChars;
    return { url: finalUrl, title: title || url.hostname, text: truncate(text, maxChars), contentType: contentType.split(";")[0], truncated };
  }
}

export const fetchPage: FetchPageFn = (url, maxChars, signal) => fetchReadable(url, { maxChars, signal });

export const fetchUrlTool = defineTool({
  name: "fetch_url",
  description:
    "Read a public web page (HTML, plain text or JSON) and return its readable text with headings, lists, tables and links. The page becomes a citable source [n]. Use after web_search to verify facts.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL." },
      max_chars: { type: "integer", minimum: 500, maximum: 60000, description: "Default 20000." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  schema: z.object({ url: z.string().trim().min(4).max(2048), max_chars: z.coerce.number().int().min(500).max(60_000).optional() }),
  label: (args) => {
    try {
      return `Reading ${new URL(args.url).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Reading page";
    }
  },
  parallelSafe: true,
  run: async (args, ctx) => {
    try {
      const page = await ctx.deps.fetchPage(args.url, args.max_chars ?? 20_000, ctx.signal);
      const id = ctx.state.sources.add({ url: page.url, title: page.title, snippet: page.text.slice(0, 200) });
      return {
        ok: true,
        summary: shortSummary(`[${id}] ${page.title} — ${page.text.length.toLocaleString("en")} chars${page.truncated ? " (truncated)" : ""}`),
        content: `Source [${id}] ${page.title}\nURL: ${page.url}\n\n${page.text}`,
        untrusted: true,
        data: { url: page.url, title: page.title, sourceId: id },
      };
    } catch (error) {
      const message = error instanceof BlockedUrlError ? `Blocked: ${error.message}` : `Could not fetch: ${errorMessage(error)}`;
      return { ok: false, summary: shortSummary(message), content: message };
    }
  },
});
