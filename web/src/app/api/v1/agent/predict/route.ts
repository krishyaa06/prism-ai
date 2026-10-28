import { NextResponse } from "next/server";
import { getApiTokenUser } from "@/lib/auth";
import { orchestrateModelRequest } from "@/lib/model";
import { z } from "zod";

export const maxDuration = 300;

const requestSchema = z.object({
  prompt: z.string().min(1).max(16_000),
  screenshot_jpeg_base64: z.string().min(1).max(4_000_000),
  is_planning: z.boolean().default(false),
});

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i.exec(header);
  return match?.[1] ?? null;
}

function getModelEndpoint() {
  const raw = process.env.PRISM_MODEL_ENDPOINT;
  if (!raw) throw new Error("Prism model endpoint is not configured.");
  const endpoint = new URL(raw);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localHost && endpoint.protocol === "http:")) {
    throw new Error("The Prism model endpoint must use HTTPS in production.");
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Configure a clean model endpoint URL without embedded credentials or query parameters.");
  }
  return endpoint;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 4_400_000) {
    return NextResponse.json({ error: "Request exceeds the 4.4 MB limit." }, { status: 413 });
  }
  const token = getBearerToken(request);
  if (!token) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });

  let owner: { id: string } | null;
  try {
    owner = await getApiTokenUser(token);
  } catch {
    return NextResponse.json({ error: "Token verification failed." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "Prism API token is invalid, revoked, or expired." }, { status: 401 });
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { data: withinRateLimit, error: rateLimitError } = await supabase
    .rpc("prism_consume_api_rate_limit", { p_token_id: owner.id, p_limit: 60 });
  if (rateLimitError) return NextResponse.json({ error: "Could not enforce the Prism API rate limit." }, { status: 503 });
  if (!withinRateLimit) return NextResponse.json({ error: "Rate limit exceeded; retry after the current minute." }, { status: 429 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid prompt or screenshot payload." }, { status: 400 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.data.screenshot_jpeg_base64)) {
    return NextResponse.json({ error: "Screenshot must be base64-encoded JPEG data." }, { status: 400 });
  }

  let endpoint: URL;
  try {
    endpoint = getModelEndpoint();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Model endpoint configuration is invalid." },
      { status: 503 },
    );
  }

  try {
    const prediction = await orchestrateModelRequest(
      parsed.data.is_planning,
      parsed.data.prompt,
      parsed.data.screenshot_jpeg_base64,
    );
    return NextResponse.json({ prediction });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : `Could not reach the configured Prism ${endpoint.hostname} model server.`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
