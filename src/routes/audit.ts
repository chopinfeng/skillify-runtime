import type { Env } from "../types";
import type { TenantRow } from "../db";
import { listAuditLog } from "../db";

export async function handleAuditLog(request: Request, env: Env, tenant: TenantRow): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const entries = await listAuditLog(env, tenant.id, Number.isFinite(limit) ? limit : 50);
  return Response.json({ entries });
}
