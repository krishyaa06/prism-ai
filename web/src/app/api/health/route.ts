import { NextResponse } from "next/server";

export async function GET() {
  const roles = ["PLANNER", "EXECUTOR", "RESEARCH", "REVIEW"];
  const hasEveryRoleSetting = (suffix: "ENDPOINT" | "NAME" | "API_KEY") =>
    roles.every((role) =>
      Boolean(
        process.env[`PRISM_MODEL_${role}_${suffix}`] ||
        process.env[`PRISM_MODEL_${suffix}`],
      ),
    );

  return NextResponse.json({
    status: "ok",
    modelEndpointConfigured: hasEveryRoleSetting("ENDPOINT"),
    modelNameConfigured: hasEveryRoleSetting("NAME"),
    modelApiKeyConfigured: hasEveryRoleSetting("API_KEY"),
  });
}
