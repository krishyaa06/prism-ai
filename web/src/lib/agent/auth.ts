import { getApiTokenUser, getVerifiedUser, hasSameOrigin } from "@/lib/auth";

export type AgentAuthResult =
  | { ok: true; userId: string; via: "token" | "session" }
  | { ok: false; status: 401 | 403 | 503; message: string };

const BEARER_RE = /^Bearer (prism_live_[A-Za-z0-9_-]{32,})$/i;

/**
 * Bearer prism_live_… token (Android/API) or Supabase session cookie.
 * Cookie sessions must come from the same origin when `requireSameOrigin` (state-changing requests).
 */
export async function authenticateAgentRequest(request: Request, requireSameOrigin: boolean): Promise<AgentAuthResult> {
  const header = request.headers.get("authorization");
  if (header) {
    const token = BEARER_RE.exec(header)?.[1];
    if (!token) return { ok: false, status: 401, message: "Invalid authorization header." };
    try {
      const owner = await getApiTokenUser(token);
      if (!owner) return { ok: false, status: 401, message: "A valid Prism API token is required." };
      return { ok: true, userId: owner.userId, via: "token" };
    } catch {
      return { ok: false, status: 503, message: "Could not verify Prism token." };
    }
  }
  if (requireSameOrigin && !hasSameOrigin(request)) {
    return { ok: false, status: 403, message: "Cross-origin requests are not allowed." };
  }
  try {
    const user = await getVerifiedUser();
    if (!user) return { ok: false, status: 401, message: "Sign in to use Prism Agent." };
    return { ok: true, userId: user.id, via: "session" };
  } catch {
    return { ok: false, status: 503, message: "Could not verify your session." };
  }
}
