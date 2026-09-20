import type { Env, Platform } from "./types";
import { generateDek, randomApiKey, randomId, sha256Hex, wrapDek } from "./lib/crypto";

export interface TenantRow {
  id: string;
  name: string;
  dek_wrapped: string;
  created_at: number;
  /** Null until a human attaches an email+password via POST /v1/auth/claim.
   * The one signal that separates a real account from an Agent that
   * self-registered and never got claimed — see migrations/0005. */
  claimed_by_user_id: string | null;
}

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
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
  const row: TenantRow = { id: randomId("tenant"), name, dek_wrapped: dekWrapped, created_at: Date.now(), claimed_by_user_id: null };
  await env.DB.prepare("INSERT INTO tenants (id, name, dek_wrapped, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.name, row.dek_wrapped, row.created_at)
    .run();
  return row;
}

/** Marks an unclaimed (Agent-registered) tenant as owned by a real human
 * user. Returns false without writing anything if the tenant was already
 * claimed — the caller must treat that as a conflict, not silently
 * overwrite an existing claim. */
export async function claimTenant(env: Env, tenantId: string, userId: string): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE tenants SET claimed_by_user_id = ? WHERE id = ? AND claimed_by_user_id IS NULL")
    .bind(userId, tenantId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Generates and wraps a fresh DEK, then creates the tenant row — the part
 * of tenant creation every caller needs (admin bootstrap, self-serve
 * signup), factored out so both stay in sync. */
export async function createTenantWithDek(env: Env, name: string): Promise<TenantRow> {
  const dek = generateDek();
  const dekWrapped = await wrapDek(dek, env.KEK_BASE64);
  return createTenant(env, name, dekWrapped);
}

export async function getTenantById(env: Env, id: string): Promise<TenantRow | null> {
  const row = await env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first<TenantRow>();
  return row ?? null;
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

export interface TenantApiKeyRow {
  id: string;
  tenant_id: string;
  created_at: number;
  revoked_at: number | null;
}

/** Metadata only — the plaintext key is never persisted, so there's
 * nothing to list beyond id/created_at/revoked_at. Used by the console's
 * "your API keys" view. */
export async function listTenantApiKeys(env: Env, tenantId: string): Promise<TenantApiKeyRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, tenant_id, created_at, revoked_at FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC",
  )
    .bind(tenantId)
    .all<TenantApiKeyRow>();
  return results;
}

export async function revokeTenantApiKey(env: Env, id: string, tenantId: string): Promise<void> {
  await env.DB.prepare("UPDATE tenant_api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ?")
    .bind(Date.now(), id, tenantId)
    .run();
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
  /** Caller's business arguments and the platform's response data —
   * never credentials (those live only in ctx.secret, which this never
   * sees). Truncated by the caller before insertion; see run-action.ts. */
  inputJson: string | null;
  outputJson: string | null;
}

export async function insertAuditLog(env: Env, entry: AuditLogEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, account_id, tool_name, ok, http_status, platform_code, duration_ms, input_json, output_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      entry.inputJson,
      entry.outputJson,
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

export async function createUser(env: Env, tenantId: string, email: string, passwordHash: string): Promise<UserRow> {
  const row: UserRow = { id: randomId("user"), tenant_id: tenantId, email, password_hash: passwordHash, created_at: Date.now() };
  await env.DB.prepare("INSERT INTO users (id, tenant_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.tenant_id, row.email, row.password_hash, row.created_at)
    .run();
  return row;
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  return row ?? null;
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ?? null;
}

export interface OAuthIdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  created_at: number;
}

export async function getUserByOAuthIdentity(env: Env, provider: string, providerUserId: string): Promise<UserRow | null> {
  const row = await env.DB.prepare(
    `SELECT u.* FROM users u JOIN oauth_identities o ON o.user_id = u.id WHERE o.provider = ? AND o.provider_user_id = ?`,
  )
    .bind(provider, providerUserId)
    .first<UserRow>();
  return row ?? null;
}

export async function createOAuthIdentity(env: Env, userId: string, provider: string, providerUserId: string): Promise<OAuthIdentityRow> {
  const row: OAuthIdentityRow = { id: randomId("oauth"), user_id: userId, provider, provider_user_id: providerUserId, created_at: Date.now() };
  await env.DB.prepare("INSERT INTO oauth_identities (id, user_id, provider, provider_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.provider, row.provider_user_id, row.created_at)
    .run();
  return row;
}

export async function insertSession(env: Env, userId: string, tokenHash: string, expiresAt: number): Promise<SessionRow> {
  const row: SessionRow = { id: randomId("sess"), user_id: userId, token_hash: tokenHash, expires_at: expiresAt, created_at: Date.now() };
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.token_hash, row.expires_at, row.created_at)
    .run();
  return row;
}

export async function getSessionByTokenHash(env: Env, tokenHash: string): Promise<SessionRow | null> {
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ?").bind(tokenHash).first<SessionRow>();
  return row ?? null;
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

/** Records one hit against the open agent-registration endpoint, keyed by a
 * hash of the caller's IP — never the raw address. */
export async function recordRegistrationAttempt(env: Env, ipHash: string): Promise<void> {
  await env.DB.prepare("INSERT INTO registration_attempts (id, ip_hash, created_at) VALUES (?, ?, ?)")
    .bind(randomId("reg"), ipHash, Date.now())
    .run();
}

export async function countRecentRegistrationAttempts(env: Env, ipHash: string, sinceMs: number): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM registration_attempts WHERE ip_hash = ? AND created_at >= ?")
    .bind(ipHash, sinceMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface PowChallengeRow {
  id: string;
  challenge: string;
  difficulty_bits: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

export async function insertPowChallenge(env: Env, challenge: string, difficultyBits: number, expiresAt: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO pow_challenges (id, challenge, difficulty_bits, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(randomId("pow"), challenge, difficultyBits, Date.now(), expiresAt)
    .run();
}

export async function getPowChallenge(env: Env, challenge: string): Promise<PowChallengeRow | null> {
  const row = await env.DB.prepare("SELECT * FROM pow_challenges WHERE challenge = ?").bind(challenge).first<PowChallengeRow>();
  return row ?? null;
}

/** Atomic claim-and-consume: returns false if the challenge was already
 * spent, so a solved-but-replayed challenge can never back a second
 * registration — same pattern as claimTenant()'s race-safe UPDATE. */
export async function consumePowChallenge(env: Env, challenge: string): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE pow_challenges SET consumed_at = ? WHERE challenge = ? AND consumed_at IS NULL")
    .bind(Date.now(), challenge)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Sweeps every expired challenge (solved or not) so the free, unauthenticated
 * GET /v1/auth/pow-challenge endpoint can't grow this table without bound —
 * called on every issuance rather than on a schedule, since there's no cron
 * primitive here and this keeps steady-state size proportional to recent
 * issuance volume without needing one. */
export async function deleteExpiredPowChallenges(env: Env, nowMs: number): Promise<void> {
  await env.DB.prepare("DELETE FROM pow_challenges WHERE expires_at < ?").bind(nowMs).run();
}
