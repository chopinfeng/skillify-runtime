import type { Env } from "../types";
import { createTenant, createTenantApiKey } from "../db";
import { generateDek, wrapDek } from "../lib/crypto";

/** Bootstrap-only route, gated by ADMIN_TOKEN (see lib/auth.ts). There's no
 * self-serve signup for the MVP — the plan explicitly defers a console UI. */
export async function handleCreateTenant(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { name?: string };
  if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });

  const dek = generateDek();
  const dekWrapped = await wrapDek(dek, env.KEK_BASE64);
  const tenant = await createTenant(env, body.name, dekWrapped);
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
