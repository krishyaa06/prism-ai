import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getVerifiedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  return user;
}

export async function getApiTokenUser(token: string) {
  const hash = await sha256(token);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id,user_id,expires_at")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) throw new Error(`Could not validate Prism API token: ${error.message}`);
  if (!data || (data.expires_at && Date.parse(data.expires_at) <= Date.now())) return null;

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id);
  if (userError || !userData.user?.email_confirmed_at) return null;

  const { error: updateError } = await supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  if (updateError) throw new Error("Could not update Prism API token usage.");
  return { id: data.id as string, userId: data.user_id as string };
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
