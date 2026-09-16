import type { Env } from "../types";
import type { TenantRow, UserRow } from "../db";
import { deleteSession, getSessionByTokenHash, getTenantById, getUserById, insertSession } from "../db";
import { sha256Hex, toBase64 } from "./crypto";

const COOKIE_NAME = "sf_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** Server-revocable session: only the token's hash is stored (same pattern
 * as tenant_api_keys), so `logout` can actually invalidate it — a plain
 * signed JWT couldn't be revoked without a denylist. */
export async function createSessionCookie(env: Env, userId: string): Promise<string> {
  const token = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  await insertSession(env, userId, await sha256Hex(token), expiresAt);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** Resolves the session cookie on `request` to the logged-in user and their
 * tenant, or null if absent/expired/unknown. Does not delete expired rows
 * itself — an expired session just fails to resolve; cleanup is a
 * housekeeping concern, not this call's job. */
export async function resolveSession(request: Request, env: Env): Promise<{ user: UserRow; tenant: TenantRow } | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const session = await getSessionByTokenHash(env, await sha256Hex(token));
  if (!session || session.expires_at < Date.now()) return null;

  const user = await getUserById(env, session.user_id);
  if (!user) return null;
  const tenant = await getTenantById(env, user.tenant_id);
  if (!tenant) return null;

  return { user, tenant };
}

/** Used by logout — deletes the session row backing the request's cookie,
 * if any. Safe to call with no cookie present (no-op). */
export async function revokeCurrentSession(request: Request, env: Env): Promise<void> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return;
  const session = await getSessionByTokenHash(env, await sha256Hex(token));
  if (session) await deleteSession(env, session.id);
}
