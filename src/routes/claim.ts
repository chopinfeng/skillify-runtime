import type { Env } from "../types";
import { claimTenant, createUser, getUserByEmail } from "../db";
import { authenticateTenantByApiKey } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { createSessionCookie } from "../lib/session";
import { EMAIL_RE, MIN_PASSWORD_LENGTH } from "./auth";

interface ClaimRequest {
  email?: string;
  password?: string;
}

/** Attaches a real human identity to a tenant that registered itself via
 * POST /v1/auth/agent-register. Bearer-API-key-only (authenticateTenantByApiKey,
 * not the session-accepting authenticateTenant) — proof of possessing that
 * specific tenant's key is exactly the right bar here: it's the same
 * credential the agent was handed at registration, so claiming requires
 * nothing an unrelated third party could plausibly have, and nothing an
 * already-logged-in caller could reach for a tenant that isn't theirs. */
export async function handleClaim(request: Request, env: Env): Promise<Response> {
  const tenant = await authenticateTenantByApiKey(request, env);
  if (!tenant) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (tenant.claimed_by_user_id) return Response.json({ error: "this tenant is already claimed" }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as ClaimRequest;
  const email = body.email?.trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return Response.json({ error: "a valid email is required" }, { status: 400 });
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 });
  }
  if (await getUserByEmail(env, email)) return Response.json({ error: "email already registered" }, { status: 409 });

  const user = await createUser(env, tenant.id, email, await hashPassword(body.password));
  const claimed = await claimTenant(env, tenant.id, user.id);
  if (!claimed) {
    // Lost a race with a concurrent claim of the same tenant — the user row
    // above is now orphaned (points at a tenant someone else just claimed).
    // Rare enough (two callers racing the same leaked API key) that failing
    // loudly is the right answer rather than silently reassigning it.
    return Response.json({ error: "this tenant was claimed by someone else a moment ago" }, { status: 409 });
  }

  const cookie = await createSessionCookie(env, user.id);
  return new Response(JSON.stringify({ user_id: user.id, email: user.email, tenant_id: tenant.id }), {
    status: 201,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
}
