import { NextResponse } from "next/server";
import { getApiTokenUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

function getToken(request: Request) {
  return /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i
    .exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = getToken(request);
  if (!token) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  let owner: Awaited<ReturnType<typeof getApiTokenUser>>;
  try {
    owner = await getApiTokenUser(token);
  } catch {
    return NextResponse.json({ error: "Token verification failed." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "Prism API token is invalid, revoked, or expired." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid task id." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id,status,result,error,cancel_requested,created_at,started_at,completed_at")
    .eq("user_id", owner.userId)
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load Prism task status." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = getToken(request);
  if (!token) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  let owner: Awaited<ReturnType<typeof getApiTokenUser>>;
  try {
    owner = await getApiTokenUser(token);
  } catch {
    return NextResponse.json({ error: "Token verification failed." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "Prism API token is invalid, revoked, or expired." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid task id." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: result, error } = await supabase.rpc("prism_cancel_agent_job", {
    p_job_id: id,
    p_user_id: owner.userId,
    p_token_id: owner.id,
  });
  if (error) return NextResponse.json({ error: "Could not cancel Prism task." }, { status: 500 });
  if (result === "canceled") return NextResponse.json({ canceled: true });
  if (result === "cancellation_requested") {
    return NextResponse.json({ cancellation_requested: true }, { status: 202 });
  }
  if (result === null) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  return NextResponse.json({ error: "Task is already terminal and cannot be canceled." }, { status: 409 });
}
