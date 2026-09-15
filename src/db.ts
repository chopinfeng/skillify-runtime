import type { Env, Platform } from "./types";
import { randomApiKey, randomId, sha256Hex } from "./lib/crypto";

export interface TenantRow {
  id: string;
  name: string;
  dek_wrapped: string;
  created_at: number;
}

export interface ConnectedAccountRow {
  id: string;
  tenant_id: string;
  platform: Platform;
  label: string;
  encrypted_secret: string;
  created_at: number;
  revoked_at: number | null;
}

export async function createTenant(env: Env, name: string, dekWrapped: string): Promise<TenantRow> {
  const row: TenantRow = { id: randomId("tenant"), name, dek_wrapped: dekWrapped, created_at: Date.now() };
  await env.DB.prepare("INSERT INTO tenants (id, name, dek_wrapped, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.name, row.dek_wrapped, row.created_at)
    .run();
  return row;
}

/** Returns the plaintext key once — only its sha256 hash is persisted. */
export async function createTenantApiKey(env: Env, tenantId: string): Promise<{ id: string; plaintextKey: string }> {
  const plaintextKey = randomApiKey();
  const id = randomId("key");
  await env.DB.prepare("INSERT INTO tenant_api_keys (id, tenant_id, key_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, tenantId, await sha256Hex(plaintextKey), Date.now())
    .run();
  return { id, plaintextKey };
}

export async function getTenantByApiKey(env: Env, plaintextKey: string): Promise<TenantRow | null> {
  const keyHash = await sha256Hex(plaintextKey);
  const row = await env.DB.prepare(
    `SELECT t.* FROM tenants t
     JOIN tenant_api_keys k ON k.tenant_id = t.id
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`,
  )
    .bind(keyHash)
    .first<TenantRow>();
  return row ?? null;
}

export async function createConnectedAccount(
  env: Env,
  tenantId: string,
  platform: Platform,
  label: string,
  encryptedSecret: string,
): Promise<ConnectedAccountRow> {
  const row: ConnectedAccountRow = {
    id: randomId("acct"),
    tenant_id: tenantId,
    platform,
    label,
    encrypted_secret: encryptedSecret,
    created_at: Date.now(),
    revoked_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO connected_accounts (id, tenant_id, platform, label, encrypted_secret, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.tenant_id, row.platform, row.label, row.encrypted_secret, row.created_at)
    .run();
  return row;
}

export async function getConnectedAccount(env: Env, accountId: string, tenantId: string): Promise<ConnectedAccountRow | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM connected_accounts WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL",
  )
    .bind(accountId, tenantId)
    .first<ConnectedAccountRow>();
  return row ?? null;
}

/** Used by the MCP tool handlers, which have no connected_account_id
 * parameter to work with (a plugged-in agent just calls the tool) — falls
 * back to the tenant's most recently created active account for that
 * platform, mirroring how Composio resolves "the app is connected" without
 * the caller naming a specific connection. */
export async function getMostRecentConnectedAccount(env: Env, tenantId: string, platform: Platform): Promise<ConnectedAccountRow | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM connected_accounts WHERE tenant_id = ? AND platform = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
  )
    .bind(tenantId, platform)
    .first<ConnectedAccountRow>();
  return row ?? null;
}

export async function listConnectedAccounts(env: Env, tenantId: string): Promise<ConnectedAccountRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM connected_accounts WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
  )
    .bind(tenantId)
    .all<ConnectedAccountRow>();
  return results;
}

export async function revokeConnectedAccount(env: Env, accountId: string, tenantId: string): Promise<void> {
  await env.DB.prepare("UPDATE connected_accounts SET revoked_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(Date.now(), accountId, tenantId)
    .run();
}

export interface AuditLogEntry {
  tenantId: string;
  accountId: string;
  toolName: string;
  ok: boolean;
  httpStatus: number | null;
  platformCode: string | null;
  durationMs: number;
}

export async function insertAuditLog(env: Env, entry: AuditLogEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, account_id, tool_name, ok, http_status, platform_code, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId("log"),
      entry.tenantId,
      entry.accountId,
      entry.toolName,
      entry.ok ? 1 : 0,
      entry.httpStatus,
      entry.platformCode,
      entry.durationMs,
      Date.now(),
    )
    .run();
}

export async function listAuditLog(env: Env, tenantId: string, limit = 50) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
  )
    .bind(tenantId, limit)
    .all();
  return results;
}
