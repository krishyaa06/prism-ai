import { NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id,status,error,cancel_requested,created_at,started_at,completed_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Could not load Prism task history." }, { status: 500 });
  return NextResponse.json({ jobs: data });
}
