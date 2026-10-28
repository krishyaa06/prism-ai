import { NextResponse } from "next/server";
import { getConnectorToken, listConnectorTools } from "@/lib/connectors";

export const maxDuration = 60;

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof getConnectorToken>>;
  try {
    user = await getConnectorToken(request);
  } catch {
    return NextResponse.json({ error: "Prism token verification failed." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "A valid Prism API token is required." }, { status: 401 });
  try {
    return NextResponse.json({ tools: await listConnectorTools(user.userId) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not list connected tools." },
      { status: 502 },
    );
  }
}
