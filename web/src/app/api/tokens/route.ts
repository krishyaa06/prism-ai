import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin, sha256 } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createTokenSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

export async function GET() {
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id,label,token_prefix,created_at,last_used_at,expires_at,revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load API token metadata." }, { status: 500 });
  return NextResponse.json({ tokens: data });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });

  const parsed = createTokenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a token label of 1–80 characters." }, { status: 400 });

  const supabase = createSupabaseAdminClient();
  const { count, error: countError } = await supabase
    .from("api_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if (countError) return NextResponse.json({ error: "Could not check active token limit." }, { status: 500 });
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "Revoke a token before creating another (maximum 5 active)." }, { status: 409 });

  const token = `prism_live_${randomBytes(32).toString("base64url")}`;
  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      user_id: user.id,
      label: parsed.data.label,
      token_prefix: token.slice(0, 18),
      token_hash: await sha256(token),
    })
    .select("id,label,token_prefix,created_at")
    .single();
  if (error) return NextResponse.json({ error: "Could not create API token." }, { status: 500 });

  return NextResponse.json({ token, metadata: data }, { status: 201 });
}
