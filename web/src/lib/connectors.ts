import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getApiTokenUser } from "@/lib/auth";

type ConnectorDefinition = {
  id: string;
  name: string;
  url: string;
  description: string;
};

function getCatalog(): ConnectorDefinition[] {
  const raw = process.env.PRISM_MCP_CONNECTORS;
  if (!raw) return [];
  let definitions: unknown;
  try {
    definitions = JSON.parse(raw);
  } catch {
    throw new Error("PRISM_MCP_CONNECTORS must be valid JSON.");
  }
  if (!Array.isArray(definitions) || definitions.length > 1000) {
    throw new Error("PRISM_MCP_CONNECTORS must be an array of at most 1,000 trusted server definitions.");
  }
  return definitions.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid MCP connector definition.");
    const item = value as Record<string, unknown>;
    const id = item.id;
    const name = item.name;
    const description = item.description ?? "";
    const url = item.url;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) ||
        typeof name !== "string" || name.length < 1 || name.length > 100 ||
        typeof description !== "string" || description.length > 500 ||
        typeof url !== "string") {
      throw new Error("MCP connector definition has invalid id, name, description, or URL.");
    }
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(`MCP connector '${id}' must be an HTTPS URL without embedded credentials or query parameters.`);
    }
    return { id, name, url: parsed.toString(), description };
  });
}

function getEncryptionKey() {
  const encoded = process.env.PRISM_CONNECTOR_ENCRYPTION_KEY;
  if (!encoded) throw new Error("PRISM_CONNECTOR_ENCRYPTION_KEY must be configured before connecting MCP credentials.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("PRISM_CONNECTOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptCredential(value: string | null) {
  if (!value) return null;
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored connector credential is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function connectorFetch(serverUrl: URL): typeof fetch {
  return async (input, init) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    if (target.origin !== serverUrl.origin || target.username || target.password) {
      throw new Error("MCP server attempted a cross-origin request; blocked by Prism.");
    }
    const timeout = AbortSignal.timeout(15_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(input, { ...init, signal, redirect: "error", cache: "no-store" });
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== serverUrl.origin) throw new Error("MCP server redirect was blocked.");
    }
    return response;
  };
}

async function openConnector(userId: string, connectorId: string) {
  const definition = getCatalog().find((item) => item.id === connectorId);
  if (!definition) throw new Error("Connector is not in the deployment's trusted MCP catalog.");
  const supabase = createSupabaseAdminClient();
  const { data: saved, error } = await supabase
    .from("connector_credentials")
    .select("encrypted_credential")
    .eq("user_id", userId)
    .eq("connector_id", connectorId)
    .maybeSingle();
  if (error) throw new Error("Could not load connector authorization.");
  if (!saved) throw new Error("Connect this service from the Prism dashboard first.");
  const credential = decryptCredential(saved.encrypted_credential);
  const headers = credential ? { authorization: `Bearer ${credential}` } : undefined;
  const serverUrl = new URL(definition.url);
  const transport = new StreamableHTTPClientTransport(serverUrl, {
    requestInit: { headers, redirect: "error" },
    fetch: connectorFetch(serverUrl),
    redirectPolicy: "same-origin",
  });
  const client = new Client({ name: "Prism", version: "1.0.0" });
  try {
    await client.connect(transport);
    return { definition, client };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

export async function listAvailableConnectors(userId: string) {
  const catalog = getCatalog();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("connector_credentials")
    .select("connector_id")
    .eq("user_id", userId);
  if (error) throw new Error("Could not load connected Prism services.");
  const connected = new Set((data ?? []).map((item) => item.connector_id));
  return catalog.map(({ id, name, description }) => ({
    id, name, description, connected: connected.has(id),
  }));
}

export async function listConnectorTools(userId: string) {
  const catalog = await listAvailableConnectors(userId);
  const connected = catalog.filter((entry) => entry.connected).slice(0, 16);
  const results = await Promise.allSettled(connected.map(async (entry) => {
    const { client } = await openConnector(userId, entry.id);
    try {
      const result = await client.listTools();
      return result.tools.slice(0, 25).map((tool) => ({
        name: `PrismMcp.${entry.id}.${Buffer.from(tool.name, "utf8").toString("base64url")}`,
        title: tool.title ?? tool.name,
        description: `${entry.name}: ${tool.description ?? ""}`.slice(0, 500),
        inputSchema: tool.inputSchema,
      }));
    } finally {
      await client.close();
    }
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export type ConnectorToolDetail = {
  connectorId: string;
  connectorName: string;
  toolName: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
};

/** Number of trusted MCP servers in the deployment catalog (0 when unset or invalid). */
export function countCatalogConnectors() {
  try {
    return getCatalog().length;
  } catch {
    return 0;
  }
}

/** Lists the user's connected MCP tools with raw names and annotations (readOnlyHint etc.). */
export async function listConnectorToolDetails(userId: string): Promise<ConnectorToolDetail[]> {
  const catalog = await listAvailableConnectors(userId);
  const connected = catalog.filter((entry) => entry.connected).slice(0, 16);
  const results = await Promise.allSettled(connected.map(async (entry) => {
    const { client } = await openConnector(userId, entry.id);
    try {
      const result = await client.listTools();
      return result.tools.slice(0, 40).map((tool) => ({
        connectorId: entry.id,
        connectorName: entry.name,
        toolName: tool.name,
        title: tool.annotations?.title ?? tool.title ?? tool.name,
        description: (tool.description ?? "").slice(0, 800),
        inputSchema: tool.inputSchema as Record<string, unknown>,
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint,
          destructiveHint: tool.annotations?.destructiveHint,
          openWorldHint: tool.annotations?.openWorldHint,
        },
      }));
    } finally {
      await client.close();
    }
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

export async function callConnectorTool(
  userId: string,
  connectorId: string,
  toolName: string,
  args: Record<string, unknown>,
) {
  const { client } = await openConnector(userId, connectorId);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find((item) => item.name === toolName);
    if (!tool) throw new Error("Tool is no longer available from the connected MCP server.");
    const result = await client.callTool({ name: toolName, arguments: args });
    const content = "content" in result && Array.isArray(result.content)
      ? result.content.map((item) => item.type === "text" ? item.text : `[${item.type} result]`).join("\n")
      : JSON.stringify(result);
    return content.slice(0, 8000);
  } finally {
    await client.close();
  }
}

export async function getConnectorToken(request: Request) {
  const bearer = /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i
    .exec(request.headers.get("authorization") ?? "")?.[1];
  if (!bearer) return null;
  return getApiTokenUser(bearer);
}

export async function saveConnectorCredential(userId: string, connectorId: string, credential: string) {
  const definition = getCatalog().find((item) => item.id === connectorId);
  if (!definition) throw new Error("Connector is not in the deployment's trusted MCP catalog.");
  if (credential.length > 4096) throw new Error("Connector credential exceeds the size limit.");
  const supabase = createSupabaseAdminClient();
  if (!credential) {
    const { data: existing, error: lookupError } = await supabase
      .from("connector_credentials")
      .select("id")
      .eq("user_id", userId)
      .eq("connector_id", connectorId)
      .maybeSingle();
    if (lookupError) throw new Error("Could not check existing connector authorization.");
    if (existing) return;
  }
  const encrypted = credential ? encryptCredential(credential) : null;
  const { error } = await supabase
    .from("connector_credentials")
    .upsert(
      { user_id: userId, connector_id: connectorId, encrypted_credential: encrypted, updated_at: new Date().toISOString() },
      { onConflict: "user_id,connector_id" },
    );
  if (error) throw new Error("Could not save connector authorization.");
}

export async function removeConnector(userId: string, connectorId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("connector_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("connector_id", connectorId);
  if (error) throw new Error("Could not disconnect the service.");
}
