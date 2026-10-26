import { buildDemoReply } from "@/lib/demo";

type Role = "user" | "assistant";
type ChatMessage = { role: Role; content: string };
type ProviderId = "openai" | "groq" | "gemini" | "openrouter";

const PROVIDERS: Record<
  ProviderId,
  { label: string; url: string; envKey: string; defaultModel: string }
> = {
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1-mini",
  },
  groq: {
    label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  gemini: {
    label: "Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    envKey: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
  },
};

const SYSTEM_PROMPT = `You are Prism AI, a concise and helpful research workspace assistant built by Prism Protocol.
- Answer clearly and get to the point. Prefer short paragraphs, bullet lists and headings.
- Use Markdown formatting. Use fenced code blocks for code.
- When the user shares a document as context, ground your answer in it and say when something is not in the document.`;

const MAX_MESSAGES = 20;
const MAX_CHARS = 24_000;

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDERS;
}

function sanitize(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

/** Picks the provider: user key from Settings first, then server env keys. */
function resolveProvider(body: Record<string, unknown>) {
  const userKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const requested = isProvider(body.provider) ? body.provider : undefined;
  const userModel = typeof body.model === "string" ? body.model.trim() : "";

  if (userKey && requested) {
    const p = PROVIDERS[requested];
    return { id: requested, ...p, key: userKey, model: userModel || p.defaultModel };
  }

  const order: ProviderId[] = requested
    ? [requested, "openai", "groq", "gemini", "openrouter"]
    : ["openai", "groq", "gemini", "openrouter"];

  for (const id of order) {
    const key = process.env[PROVIDERS[id].envKey];
    if (key) {
      const p = PROVIDERS[id];
      const envModel = process.env[`${PROVIDERS[id].envKey.replace("_API_KEY", "")}_MODEL`];
      return { id, ...p, key, model: envModel || p.defaultModel };
    }
  }
  return null;
}

function textStream(text: string) {
  const encoder = new TextEncoder();
  const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((r) => setTimeout(r, 12));
      }
      controller.close();
    },
  });
}

function streamHeaders(mode: string, provider: string, model: string) {
  return {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Prism-Mode": mode,
    "X-Prism-Provider": provider,
    "X-Prism-Model": model,
  };
}

export async function GET() {
  const active = resolveProvider({});
  return Response.json({
    mode: active ? "live" : "demo",
    provider: active?.label ?? null,
    model: active?.model ?? null,
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Backwards compatible: { message } or { messages: [...] }
  const messages = sanitize(
    body.messages ??
      (typeof body.message === "string" ? [{ role: "user", content: body.message }] : []),
  );

  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CHARS) : "";
  const provider = resolveProvider(body);

  if (!provider) {
    const reply = buildDemoReply(messages[messages.length - 1].content, context);
    return new Response(textStream(reply), {
      headers: streamHeaders("demo", "Demo", "offline"),
    });
  }

  const system = context
    ? `${SYSTEM_PROMPT}\n\nThe user attached this document as context:\n"""\n${context}\n"""`
    : SYSTEM_PROMPT;

  let upstream: Response;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
        ...(provider.id === "openrouter"
          ? { "HTTP-Referer": "https://prism-ai-umber.vercel.app", "X-Title": "Prism AI" }
          : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        stream: true,
        temperature: 0.6,
        messages: [{ role: "system", content: system }, ...messages],
      }),
      signal: request.signal,
    });
  } catch {
    return Response.json(
      { error: `Could not reach ${provider.label}. Check your connection and try again.` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status;
    const message =
      status === 401 || status === 403
        ? `${provider.label} rejected the API key. Update it in Settings or your environment variables.`
        : status === 429
          ? `${provider.label} rate limit reached. Wait a moment and try again.`
          : status === 404
            ? `Model "${provider.model}" was not found on ${provider.label}.`
            : `${provider.label} returned an error (${status}).`;
    return Response.json({ error: message }, { status: status === 401 ? 401 : 502 });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta: string | undefined = json.choices?.[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          } catch {
            // ignore keep-alive or partial lines
          }
        }
      },
    }),
  );

  return new Response(stream, {
    headers: streamHeaders("live", provider.label, provider.model),
  });
}
