import type { Env } from "../types";
import type { TenantRow } from "../db";
import { getTenantByApiKey } from "../db";

export async function authenticateTenant(request: Request, env: Env): Promise<TenantRow | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  return getTenantByApiKey(env, match[1]);
}

export function requireAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.ADMIN_TOKEN}`;
}
