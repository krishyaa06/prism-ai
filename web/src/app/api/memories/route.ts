import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agent_memories")
    .select("id,category,content,source,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "Could not load Prism memory." }, { status: 500 });
  return NextResponse.json({ memories: data });
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const memoryId = new URL(request.url).searchParams.get("id");
  if (!memoryId) return NextResponse.json({ error: "Memory id is required." }, { status: 400 });
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("agent_memories").delete().eq("user_id", user.id);
  if (memoryId !== "all") query = query.eq("id", memoryId);
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Could not delete Prism memory." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
