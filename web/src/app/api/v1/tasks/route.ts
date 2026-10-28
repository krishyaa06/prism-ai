import { NextResponse } from "next/server";
import { getApiTokenUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export const maxDuration = 60;

const taskSchema = z.object({
  prompt: z.string().min(1).max(16_000),
  screenshot_jpeg_base64: z.string().min(1).max(4_000_000),
  is_planning: z.boolean().default(false),
});

function getToken(request: Request) {
  return /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i
    .exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4_400_000) {
    return NextResponse.json({ error: "Request exceeds the 4.4 MB limit." }, { status: 413 });
  }
  const token = getToken(request);
  if (!token) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  let owner: Awaited<ReturnType<typeof getApiTokenUser>>;
  try {
    owner = await getApiTokenUser(token);
  } catch {
    return NextResponse.json({ error: "Token verification failed." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "Prism API token is invalid, revoked, or expired." }, { status: 401 });
  const parsed = taskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.data?.screenshot_jpeg_base64 ?? "")) {
    return NextResponse.json({ error: "Invalid prompt or base64 screenshot payload." }, { status: 400 });
  }
  const requestId = request.headers.get("idempotency-key") ?? randomUUID();
  if (!z.string().uuid().safeParse(requestId).success) {
    return NextResponse.json({ error: "Idempotency-Key must be a UUID." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: allowed, error: limitError } = await supabase
    .rpc("prism_consume_api_rate_limit", { p_token_id: owner.id, p_limit: 60 });
  if (limitError) return NextResponse.json({ error: "Could not enforce the Prism API rate limit." }, { status: 503 });
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded; retry after the current minute." }, { status: 429 });

  const { data: jobId, error } = await supabase.rpc("prism_enqueue_agent_job", {
    p_user_id: owner.userId,
    p_token_id: owner.id,
    p_prompt: parsed.data.prompt,
    p_screenshot_jpeg_base64: parsed.data.screenshot_jpeg_base64,
    p_is_planning: parsed.data.is_planning,
    p_client_request_id: requestId,
  });
  if (error?.message.includes("Active task limit")) {
    return NextResponse.json({ error: "Too many active Prism tasks. Wait for one to finish or cancel it." }, { status: 429 });
  }
  if (error || !jobId) {
    return NextResponse.json({ error: "Could not enqueue Prism task." }, { status: 503 });
  }
  return NextResponse.json({ task_id: jobId, status: "queued", request_id: requestId }, { status: 202 });
}

export async function DELETE(request: Request) {
  const token = getToken(request);
  if (!token) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  let owner: Awaited<ReturnType<typeof getApiTokenUser>>;
  try {
    owner = await getApiTokenUser(token);
  } catch {
    return NextResponse.json({ error: "Token verification failed." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "Prism API token is invalid, revoked, or expired." }, { status: 401 });
  const requestId = new URL(request.url).searchParams.get("request_id");
  if (!z.string().uuid().safeParse(requestId).success) {
    return NextResponse.json({ error: "A valid request_id UUID is required." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: job, error: lookupError } = await supabase
    .from("agent_jobs")
    .select("id,status,cancel_requested")
    .eq("token_id", owner.id)
    .eq("client_request_id", requestId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Could not locate the submitted task." }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const { data: result, error: cancelError } = await supabase.rpc("prism_cancel_agent_job", {
    p_job_id: job.id,
    p_user_id: owner.userId,
    p_token_id: owner.id,
  });
  if (cancelError) return NextResponse.json({ error: "Could not cancel Prism task." }, { status: 500 });
  if (result === "canceled") return NextResponse.json({ canceled: true });
  if (result === "cancellation_requested") {
    return NextResponse.json({ cancellation_requested: true }, { status: 202 });
  }
  return NextResponse.json({ error: "Task is already terminal and cannot be canceled." }, { status: 409 });
}
