import type { Env } from "../types";
import type { TenantRow } from "../db";
import { getTenantByApiKey } from "../db";
import { resolveSession } from "./session";

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

export function requireAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.ADMIN_TOKEN}`;
}
