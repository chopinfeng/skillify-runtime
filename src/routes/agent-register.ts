import type { Env } from "../types";
import { createTenantApiKey, createTenantWithDek } from "../db";
import { checkAndRecordRegistrationAttempt } from "../lib/rate-limit";

const MAX_LABEL_LENGTH = 200;

interface AgentRegisterRequest {
  name?: string;
  description?: string;
}

/** Open, unauthenticated registration for an Agent to call directly — no
 * email, no password, no human in the loop (mirrors Moltbook's
 * POST /api/v1/agents/register). Unlike a from-scratch clone of that
 * pattern, the resulting tenant is UNCLAIMED (tenants.claimed_by_user_id
 * stays null) until a real human attaches credentials via
 * POST /v1/auth/claim — see migrations/0005_agent_registration.sql for why:
 * an open registration endpoint with no downstream distinction between
 * real and self-registered accounts is exactly how Moltbook's usage
 * numbers reportedly ended up ~99% fake. Rate-limited per IP for the same
 * reason — this project has never described its numbers as anything but
 * exactly what they are, and an easily-scriptable free-tenant mill would
 * make that harder to keep true. */
export async function handleAgentRegister(request: Request, env: Env): Promise<Response> {
  const allowed = await checkAndRecordRegistrationAttempt(request, env);
  if (!allowed) return Response.json({ error: "too many registrations from this address, try again later" }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as AgentRegisterRequest;
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
