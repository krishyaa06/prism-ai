import { NextResponse } from "next/server";
import { getApiTokenUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createMemorySchema = z.object({
  consent: z.literal(true),
  content: z.string().trim().min(1).max(2000),
  category: z.enum(["preference", "workflow", "fact"]).default("preference"),
});

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i.exec(header)?.[1];
  if (!token) return null;
  return getApiTokenUser(token);
}

export async function GET(request: Request) {
  let owner: Awaited<ReturnType<typeof getApiTokenUser>> = null;
  try {
    owner = await authenticate(request);
  } catch {
    return NextResponse.json({ error: "Could not verify Prism token." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agent_memories")
    .select("id,category,content,source,created_at,updated_at")
    .eq("user_id", owner.userId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: "Could not load Prism memory." }, { status: 500 });
  return NextResponse.json({ memories: data });
}

export async function POST(request: Request) {
  let owner: Awaited<ReturnType<typeof getApiTokenUser>> = null;
  try {
    owner = await authenticate(request);
  } catch {
    return NextResponse.json({ error: "Could not verify Prism token." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });

  const parsed = createMemorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Explicit consent and 1–2,000 characters are required." }, { status: 400 });
  }
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agent_memories")
    .insert({
      user_id: owner.userId,
      category: parsed.data.category,
      content: parsed.data.content,
      source: "user",
    })
    .select("id,category,content,source,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: "Could not save Prism memory." }, { status: 500 });
  return NextResponse.json({ memory: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  let owner: Awaited<ReturnType<typeof getApiTokenUser>> = null;
  try {
    owner = await authenticate(request);
  } catch {
    return NextResponse.json({ error: "Could not verify Prism token." }, { status: 503 });
  }
  if (!owner) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });

  const memoryId = new URL(request.url).searchParams.get("id");
  if (!memoryId || (memoryId !== "all" && !z.string().uuid().safeParse(memoryId).success)) {
    return NextResponse.json({ error: "Provide a valid memory id or id=all." }, { status: 400 });
  }
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("agent_memories").delete().eq("user_id", owner.userId);
  if (memoryId !== "all") query = query.eq("id", memoryId);
  const { data, error } = await query.select("id");
  if (error) return NextResponse.json({ error: "Could not delete Prism memory." }, { status: 500 });
  if (memoryId !== "all" && !data?.length) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  return NextResponse.json({ deleted: true, count: data?.length ?? 0 });
}
