import { NextResponse } from "next/server";
import { getVerifiedUser, hasSameOrigin } from "@/lib/auth";
import { removeConnector } from "@/lib/connectors";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const user = await getVerifiedUser();
  if (!user) return NextResponse.json({ error: "Sign in with a verified account." }, { status: 401 });
  const { id } = await context.params;
  try {
    await removeConnector(user.id, id);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not disconnect service." },
      { status: 500 },
    );
  }
}
