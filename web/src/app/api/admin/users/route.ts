import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]),
});

async function getAdmin() {
  const user = await getVerifiedUser();
  if (!user) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Could not validate administrator role.");
  return data?.role === "admin" ? { user, supabase } : null;
}

export async function GET() {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const { data, error } = await admin.supabase
    .from("profiles")
    .select("id,email,role,created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not load users." }, { status: 500 });
  return NextResponse.json({ users: data });
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const parsed = roleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid user or role." }, { status: 400 });
  if (parsed.data.userId === admin.user.id && parsed.data.role !== "admin") {
    return NextResponse.json({ error: "You cannot remove your own administrator role here." }, { status: 409 });
  }
  if (parsed.data.role === "user") {
    const { count, error: countError } = await admin.supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) return NextResponse.json({ error: "Could not check administrator count." }, { status: 500 });
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "At least one administrator must remain." }, { status: 409 });
  }
  const { data, error } = await admin.supabase
    .from("profiles")
    .update({ role: parsed.data.role, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.userId)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update user role." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  return NextResponse.json({ updated: true });
}
