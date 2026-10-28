import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    modelEndpointConfigured: Boolean(process.env.PRISM_MODEL_ENDPOINT),
  });
}
