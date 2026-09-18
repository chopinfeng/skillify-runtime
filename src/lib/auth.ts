import type { Env } from "../types";
import type { TenantRow } from "../db";
import { getTenantByApiKey } from "../db";
import { resolveSession } from "./session";
import { sha256Hex } from "./crypto";

/** Resolves the calling tenant for the REST/MCP-style resource routes
 * (connected accounts, execute, audit log). Accepts either credential:
 * a tenant API key (`Authorization: Bearer <key>` — programmatic callers,
 * MCP clients) or a logged-in session cookie (the browser console calling
 * the same endpoints). Both identify "which tenant", just via different
 * doors; a session cookie resolves to that user's own tenant. */
export async function authenticateTenant(request: Request, env: Env): Promise<TenantRow | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (match) {
    const tenant = await getTenantByApiKey(env, match[1]);
    if (tenant) return tenant;
  }
  const session = await resolveSession(request, env);
  return session?.tenant ?? null;
}

/** Compares two strings in constant time by hashing both to fixed-length
 * digests first (so the comparison never leaks either string's length) and
 * XOR-ing every byte without short-circuiting. `===` on the raw header would
 * both leak ADMIN_TOKEN's length via timing and, if the secret is ever left
 * unconfigured, match the literal header value `"Bearer undefined"`. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) diff |= digestA.charCodeAt(i) ^ digestB.charCodeAt(i);
  return diff === 0;
}

export async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const header = request.headers.get("authorization") ?? "";
  return timingSafeEqual(header, `Bearer ${env.ADMIN_TOKEN}`);
}
