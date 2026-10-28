import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasSameOrigin(_request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const { id } = await context.params;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not revoke the API token." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Active token not found." }, { status: 404 });
  return NextResponse.json({ revoked: true });
}
