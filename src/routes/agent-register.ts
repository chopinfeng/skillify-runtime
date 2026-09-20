import type { Env } from "../types";
import { createTenantApiKey, createTenantWithDek } from "../db";
import { isRegistrationRateLimited, recordRegistrationAttempt } from "../lib/rate-limit";
import { verifyAndConsumePow } from "../lib/pow";

const MAX_LABEL_LENGTH = 200;

interface AgentRegisterRequest {
  name?: string;
  description?: string;
  challenge?: string;
  solution?: string;
}

/** Open, unauthenticated registration for an Agent to call directly — no
 * email, no password, no human in the loop (mirrors Moltbook's
 * POST /api/v1/agents/register). Unlike a from-scratch clone of that
 * pattern, the resulting tenant is UNCLAIMED (tenants.claimed_by_user_id
 * stays null) until a real human attaches credentials via
 * POST /v1/auth/claim — see migrations/0005_agent_registration.sql for why:
 * an open registration endpoint with no downstream distinction between
 * real and self-registered accounts is exactly how Moltbook's usage
 * numbers reportedly ended up ~99% fake. Gated two ways, deliberately
 * different threat models: per-IP rate limiting (cheap to bypass with
 * rotating IPs, but free) and a proof-of-work challenge from
 * GET /v1/auth/pow-challenge (IP-agnostic, but costs real compute per
 * attempt) — see migrations/0006_pow_challenges.sql.
 *
 * The rate-limit check and the debit are deliberately separate calls: the
 * quota is only spent once a valid PoW solution is in hand, not on every
 * request that reaches this handler. Debiting up front would mean a caller
 * iterating on a broken PoW implementation burns its whole hourly budget on
 * requests that were never going to produce a tenant, and gets rate-limited
 * for an hour while still debugging — exactly the audience this endpoint
 * exists for. */
export async function handleAgentRegister(request: Request, env: Env): Promise<Response> {
  if (await isRegistrationRateLimited(request, env)) {
    return Response.json({ error: "too many registrations from this address, try again later" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as AgentRegisterRequest;

  const pow = await verifyAndConsumePow(env, body.challenge ?? "", body.solution ?? "");
  if (!pow.ok) {
    return Response.json(
      { error: pow.error, pow_hint: "GET /v1/auth/pow-challenge first, solve it, then include {challenge, solution} in this request." },
      { status: 400 },
    );
  }
  await recordRegistrationAttempt(request, env);

  const label = [body.name, body.description]
    .filter(Boolean)
    .join(" — ")
    .slice(0, MAX_LABEL_LENGTH) || "unnamed agent";

  const tenant = await createTenantWithDek(env, label);
  const { plaintextKey } = await createTenantApiKey(env, tenant.id);

  return Response.json(
    {
      tenant_id: tenant.id,
      api_key: plaintextKey, // shown once, same as every other tenant-creation path
      claimed: false,
      claim_hint: "This tenant is unclaimed and has no recovery path. POST /v1/auth/claim with this api_key to attach a real email+password before you rely on it.",
    },
    { status: 201 },
  );
}
