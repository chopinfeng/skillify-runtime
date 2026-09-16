import type { Env } from "../types";
import { createTenantApiKey, listTenantApiKeys, revokeTenantApiKey } from "../db";
import { resolveSession } from "../lib/session";

/** All three routes are session-gated (the console, logged in with a
 * password), not tenant-API-key-gated — managing your own keys shouldn't
 * require already having one in hand. This is also what closes the real
 * gap the console otherwise has: a signed-up user who lost their one-time
 * signup key had no way to get a working one back. */
export async function handleCreateApiKey(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { plaintextKey, id } = await createTenantApiKey(env, session.tenant.id);
  return Response.json({ id, api_key: plaintextKey }, { status: 201 }); // shown once
}

export async function handleListApiKeys(request: Request, env: Env): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  const keys = await listTenantApiKeys(env, session.tenant.id);
  return Response.json({ keys });
}

export async function handleRevokeApiKey(request: Request, env: Env, keyId: string): Promise<Response> {
  const session = await resolveSession(request, env);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

  await revokeTenantApiKey(env, keyId, session.tenant.id);
  return new Response(null, { status: 204 });
}
