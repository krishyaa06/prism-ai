import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid task id." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { data: result, error } = await supabase.rpc("prism_cancel_agent_job", {
    p_job_id: id,
    p_user_id: user.id,
    p_token_id: null,
  });
  if (error) return NextResponse.json({ error: "Could not cancel Prism task." }, { status: 500 });
  if (result === "canceled") return NextResponse.json({ canceled: true });
  if (result === "cancellation_requested") {
    return NextResponse.json({ cancellation_requested: true }, { status: 202 });
  }
  if (result === null) return NextResponse.json({ error: "Task not found." }, { status: 404 });
  return NextResponse.json({ error: "Task is already terminal and cannot be canceled." }, { status: 409 });
}
