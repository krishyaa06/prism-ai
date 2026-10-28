import { NextResponse } from "next/server";
import { callModel } from "@/lib/model";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const user = await getVerifiedUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not verify Prism operator permissions." }, { status: 500 });
  }
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Only a Prism operator can test the shared model connection." }, { status: 403 });
  }

  try {
    await callModel("executor", [
      {
        role: "system",
        content: "This is a Prism model connectivity check. Reply with exactly: Prism model connection successful.",
      },
      { role: "user", content: "Confirm the model endpoint is responding." },
    ], 24);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The model connection test failed." },
      { status: 502 },
    );
  }
}
