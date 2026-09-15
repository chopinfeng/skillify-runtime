import type { Env, Platform } from "../types";
import type { TenantRow } from "../db";
import { createConnectedAccount, listConnectedAccounts, revokeConnectedAccount } from "../db";
import { decryptSecret, encryptSecret, unwrapDek } from "../lib/crypto";
import { isBigmodelSecret } from "../platforms/bigmodel-cn/auth";
import { isFeishuSecret } from "../platforms/feishu/auth";

const SECRET_VALIDATORS: Record<Platform, (s: Record<string, unknown>) => boolean> = {
  "bigmodel-cn": isBigmodelSecret,
  feishu: isFeishuSecret,
};

export async function handleCreateAccount(request: Request, env: Env, tenant: TenantRow): Promise<Response> {
  const body = (await request.json()) as { platform?: Platform; label?: string; secret?: Record<string, unknown> };
  if (!body.platform || !SECRET_VALIDATORS[body.platform]) {
    return Response.json({ error: "unknown or missing platform" }, { status: 400 });
  }
  if (!body.label || !body.secret || !SECRET_VALIDATORS[body.platform](body.secret)) {
    return Response.json({ error: `label and a valid ${body.platform} secret are required` }, { status: 400 });
  }

  const dek = await unwrapDek(tenant.dek_wrapped, env.KEK_BASE64);
  const encryptedSecret = await encryptSecret(dek, body.secret);
  const account = await createConnectedAccount(env, tenant.id, body.platform, body.label, encryptedSecret);

  return Response.json({ id: account.id, platform: account.platform, label: account.label, created_at: account.created_at }, { status: 201 });
}

export async function handleListAccounts(env: Env, tenant: TenantRow): Promise<Response> {
  const accounts = await listConnectedAccounts(env, tenant.id);
  return Response.json({
    accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, label: a.label, created_at: a.created_at })),
  });
}

export async function handleRevokeAccount(env: Env, tenant: TenantRow, accountId: string): Promise<Response> {
  await revokeConnectedAccount(env, accountId, tenant.id);
  return new Response(null, { status: 204 });
}

/** Used by routes/execute.ts — decrypts a connected account's secret with
 * the owning tenant's DEK. Exported here to keep decryption next to where
 * secrets are otherwise handled. */
export async function decryptAccountSecret(env: Env, tenant: TenantRow, encryptedSecret: string): Promise<Record<string, unknown>> {
  const dek = await unwrapDek(tenant.dek_wrapped, env.KEK_BASE64);
  return decryptSecret(dek, encryptedSecret);
}
