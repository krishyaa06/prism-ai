import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { listAvailableConnectors, saveConnectorCredential } from "@/lib/connectors";
import { z } from "zod";

const connectSchema = z.object({
  connectorId: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
  credential: z.string().max(4096).default(""),
});

export async function GET() {
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  try {
    return NextResponse.json({ connectors: await listAvailableConnectors(user.id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load connectors." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const parsed = connectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Connector configuration is invalid." }, { status: 400 });
  try {
    await saveConnectorCredential(user.id, parsed.data.connectorId, parsed.data.credential);
    return NextResponse.json({ connected: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not connect service." },
      { status: 400 },
    );
  }
}
