import type { ToolSpec } from "../llm";
import { sanitizeConnectorToolName, type ToolAnnotations } from "../safety";

export type ConnectorTool = {
  connectorId: string;
  connectorName: string;
  toolName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
};

export type ConnectorProvider = {
  list(userId: string): Promise<ConnectorTool[]>;
  call(userId: string, connectorId: string, toolName: string, args: Record<string, unknown>): Promise<string>;
};

const LIST_TIMEOUT_MS = 8_000;

/** Lazily imports the MCP framework so tests and unconfigured deployments never load it. */
export const mcpConnectorProvider: ConnectorProvider = {
  async list(userId) {
    if (!process.env.PRISM_MCP_CONNECTORS || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    const { listConnectorToolDetails } = await import("@/lib/connectors");
    return Promise.race([
      listConnectorToolDetails(userId).catch(() => []),
      new Promise<ConnectorTool[]>((resolve) => setTimeout(() => resolve([]), LIST_TIMEOUT_MS)),
    ]);
  },
  async call(userId, connectorId, toolName, args) {
    const { callConnectorTool } = await import("@/lib/connectors");
    return callConnectorTool(userId, connectorId, toolName, args);
  },
};

export type ConnectorToolTable = { specs: ToolSpec[]; byName: Map<string, ConnectorTool> };

function normalizeSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || schema.type !== "object") return { type: "object", properties: {} };
  const { $schema: _ignored, ...rest } = schema;
  return { properties: {}, ...rest };
}

/** Maps MCP tools to model-safe `mcp__<connector>__<tool>` names. */
export function buildConnectorToolTable(tools: ConnectorTool[], reserved: Iterable<string> = []): ConnectorToolTable {
  const taken = new Set<string>(reserved);
  const byName = new Map<string, ConnectorTool>();
  const specs: ToolSpec[] = [];
  for (const tool of tools.slice(0, 120)) {
    const name = sanitizeConnectorToolName(tool.connectorId, tool.toolName, taken);
    byName.set(name, tool);
    const access = tool.annotations.readOnlyHint === true ? "read-only" : "requires user approval";
    specs.push({
      type: "function",
      function: {
        name,
        description: `[${tool.connectorName} connector, ${access}] ${tool.title}: ${tool.description}`.slice(0, 1000),
        parameters: normalizeSchema(tool.inputSchema),
      },
    });
  }
  return { specs, byName };
}
