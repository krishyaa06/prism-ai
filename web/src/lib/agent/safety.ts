import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import ipaddr from "ipaddr.js";

/* ------------------------------------------------------------------------ */
/* SSRF guard                                                               */
/* ------------------------------------------------------------------------ */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address.replace(/^\[|\]$/g, "").replace(/%.*$/, ""));
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
  }
  // ipaddr.js labels everything that is not private/loopback/link-local/
  // reserved/multicast/CGNAT/6to4/teredo/NAT64/etc. as "unicast".
  return parsed.range() === "unicast";
}

export type LookupAddress = { address: string; family: number };
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

export const systemLookup: LookupFn = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses as LookupAddress[]);
    });
  });

/** Validates scheme, credentials and literal IP hosts. Returns the parsed URL. */
export function assertSafeUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw.toString());
  } catch {
    throw new BlockedUrlError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http(s) URLs can be fetched.");
  }
  if (url.username || url.password) throw new BlockedUrlError("URLs with embedded credentials are blocked.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedUrlError("URL has no host.");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new BlockedUrlError("Private, loopback, link-local and metadata addresses are blocked.");
  }
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost") || lowered.endsWith(".internal") ||
      lowered.endsWith(".local") || lowered === "metadata.google.internal") {
    throw new BlockedUrlError("Internal hostnames are blocked.");
  }
  return url;
}

/** Resolves the host and throws unless every resolved address is public. */
export async function assertPublicHost(hostname: string, lookup: LookupFn = systemLookup) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new BlockedUrlError("Private, loopback, link-local and metadata addresses are blocked.");
    return [{ address: host, family: host.includes(":") ? 6 : 4 }];
  }
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new BlockedUrlError(`Could not resolve ${host}.`);
  }
  if (!addresses.length) throw new BlockedUrlError(`Could not resolve ${host}.`);
  for (const entry of addresses) {
    if (!isPublicAddress(entry.address)) {
      throw new BlockedUrlError(`${host} resolves to a non-public address; blocked.`);
    }
  }
  return addresses;
}

/**
 * `lookup` implementation for net/tls/undici connect options. Validates the
 * address actually used for the TCP connection, closing DNS-rebinding gaps.
 */
export function guardedConnectLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  const all = typeof options === "object" && options?.all === true;
  assertPublicHost(hostname)
    .then((addresses) => {
      if (all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    })
    .catch((error: Error) => callback(error, all ? [] : "", 4));
}

/* ------------------------------------------------------------------------ */
/* Untrusted content                                                        */
/* ------------------------------------------------------------------------ */

export const MAX_TOOL_RESULT_CHARS = 12_000;

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 40))}\n…[truncated ${text.length - max + 40} chars]`;
}

/** Wraps external data so the model treats it as data, never instructions. */
export function wrapUntrusted(source: string, text: string, max = MAX_TOOL_RESULT_CHARS) {
  const safeSource = source.replace(/[^a-zA-Z0-9_.:/ -]/g, "").slice(0, 80);
  const body = truncate(text, max).replace(/<\/?untrusted[^>]*>/gi, "[tag removed]");
  return `<untrusted source="${safeSource}">\n${body}\n</untrusted>`;
}

/* ------------------------------------------------------------------------ */
/* Approval policy & tool names                                             */
/* ------------------------------------------------------------------------ */

export type ToolAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };

/** Connector tools run directly only when the server marks them read-only. */
export function connectorNeedsApproval(annotations: ToolAnnotations | undefined) {
  return annotations?.readOnlyHint !== true;
}

export function approvalReason(connectorName: string, toolTitle: string, annotations: ToolAnnotations | undefined) {
  if (annotations?.destructiveHint) {
    return `${connectorName} · ${toolTitle} may change or delete data. Approve to continue.`;
  }
  return `${connectorName} · ${toolTitle} can send or change data in your connected account. Approve to continue.`;
}

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidToolName(name: string) {
  return TOOL_NAME_RE.test(name);
}

/** Builds `mcp__<connector>__<tool>` constrained to [a-zA-Z0-9_-]{1,64}, unique within `taken`. */
export function sanitizeConnectorToolName(connectorId: string, toolName: string, taken: Set<string> = new Set()) {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/_{3,}/g, "__");
  let name = `mcp__${clean(connectorId)}__${clean(toolName)}`;
  if (name.length > 64 || taken.has(name)) {
    const hash = createHash("sha256").update(`${connectorId}\u0000${toolName}`).digest("hex").slice(0, 8);
    name = `${name.slice(0, 55)}_${hash}`;
    const base = name;
    let n = 2;
    while (taken.has(name)) name = `${base.slice(0, 60)}_${n++}`;
  }
  taken.add(name);
  return name;
}
