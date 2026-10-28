import { NextResponse } from "next/server";
import { getConnectorToken, callConnectorTool } from "@/lib/connectors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const toolCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; tool: string }> },
) {
  let user: Awaited<ReturnType<typeof getConnectorToken>>;
  try {
    user = await getConnectorToken(request);
  } catch {
    return NextResponse.json({ error: "Prism token verification failed." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  const { id, tool } = await context.params;
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) || tool.length > 200) {
    return NextResponse.json({ error: "Invalid connector or tool id." }, { status: 400 });
  }
  const toolName = Buffer.from(tool, "base64url").toString("utf8");
  if (!toolName || Buffer.from(toolName, "utf8").toString("base64url") !== tool) {
    return NextResponse.json({ error: "Invalid encoded MCP tool id." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: allowed, error: limitError } = await supabase
    .rpc("prism_consume_api_rate_limit", { p_token_id: user.id, p_limit: 60 });
  if (limitError) return NextResponse.json({ error: "Could not enforce the Prism API rate limit." }, { status: 503 });
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });

  const parsed = toolCallSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid MCP tool arguments." }, { status: 400 });
  try {
    const result = await callConnectorTool(user.userId, id, toolName, parsed.data.arguments);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "MCP tool execution failed." },
      { status: 502 },
    );
  }
}
