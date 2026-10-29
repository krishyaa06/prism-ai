import { NextResponse } from "next/server";
import type { AgentEvent } from "@/lib/agent/events";
import { authenticateAgentRequest } from "@/lib/agent/auth";
import { runAgent } from "@/lib/agent/loop";
import { MAX_BODY_BYTES, parseAgentRequest } from "@/lib/agent/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authenticateAgentRequest(request, true);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = parseAgentRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  const abort = new AbortController();
  const onClientAbort = () => abort.abort(new Error("client disconnected"));
  request.signal.addEventListener("abort", onClientAbort, { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      runAgent(parsed.data, { userId: auth.userId, emit, signal: abort.signal })
        .catch(() => emit({ type: "error", message: "The agent hit an unexpected error. Please try again." }))
        .finally(() => {
          request.signal.removeEventListener("abort", onClientAbort);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        });
    },
    cancel() {
      abort.abort(new Error("client disconnected"));
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
