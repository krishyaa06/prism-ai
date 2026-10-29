import { NextResponse } from "next/server";
import { authenticateAgentRequest } from "@/lib/agent/auth";
import { resolveAgentModel } from "@/lib/agent/llm";
import { configuredSearchProvider } from "@/lib/agent/tools/search";
import { isPythonConfigured } from "@/lib/agent/tools/code";
import { isMemoryConfigured } from "@/lib/agent/tools/memory";
import { countCatalogConnectors } from "@/lib/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function modelInfo(role: "agent" | "research") {
  try {
    const { endpoint, model } = resolveAgentModel(role);
    return { configured: true, name: model, host: endpoint.hostname };
  } catch {
    return { configured: false, name: null, host: null };
  }
}

/** Which agent capabilities this deployment has configured. Never returns secrets. */
export async function GET(request: Request) {
  const auth = await authenticateAgentRequest(request, false);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  return NextResponse.json({
    model: modelInfo("agent"),
    researchModel: modelInfo("research"),
    search: { provider: configuredSearchProvider() },
    python: { enabled: isPythonConfigured(), provider: isPythonConfigured() ? "e2b" : null },
    javascript: { enabled: true, sandbox: "quickjs" },
    connectors: { configured: countCatalogConnectors() },
    memory: { available: isMemoryConfigured() },
    limits: { maxRounds: 24, maxToolCalls: 60, maxSubagents: 4, wallClockSeconds: 280 },
  }, { headers: { "cache-control": "no-store" } });
}
