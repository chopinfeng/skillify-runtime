import type { Env } from "../types";
import { createTenantApiKey, createTenantWithDek } from "../db";

/** Admin bootstrap route, gated by ADMIN_TOKEN (see lib/auth.ts). Kept
 * alongside self-serve signup (routes/auth.ts) as an ops/scripting path —
 * the two are independent, neither replaces the other. */
export async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { name?: string };
  if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });

  const tenant = await createTenantWithDek(env, body.name);
  const { plaintextKey } = await createTenantApiKey(env, tenant.id);

  return Response.json(
    {
      tenant_id: tenant.id,
      name: tenant.name,
      api_key: plaintextKey, // shown once — only its hash is stored
    },
    { status: 201 },
  );
}
