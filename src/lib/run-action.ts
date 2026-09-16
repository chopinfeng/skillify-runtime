import type { ActionDefinition, Env, NormalizedResult } from "../types";
import type { ConnectedAccountRow, TenantRow } from "../db";
import { insertAuditLog } from "../db";
import { withRetry } from "./retry";
import { decryptAccountSecret } from "../routes/accounts";

/** Shared by the REST `/v1/actions/execute` route and the MCP tool
 * handlers — decrypts the account's secret, runs the action with retry,
 * and writes the audit log. Both callers already resolved `account` to a
 * connected account owned by `tenant`. */
export async function runAction(
  env: Env,
  tenant: TenantRow,
  account: ConnectedAccountRow,
  action: ActionDefinition,
  input: Record<string, unknown>,
): Promise<NormalizedResult> {
  const secret = await decryptAccountSecret(env, tenant, account.encrypted_secret);
  const startedAt = Date.now();
  const result = await withRetry(() => action.execute({ env, accountId: account.id, secret, input }));
  const durationMs = Date.now() - startedAt;

  await insertAuditLog(env, {
    tenantId: tenant.id,
    accountId: account.id,
    toolName: action.tool.name,
    ok: result.ok,
    httpStatus: result.httpStatus,
    platformCode: result.platformCode,
    durationMs,
    inputJson: truncate(safeStringify(input)),
    outputJson: truncate(safeStringify(result.data)),
  });

  return result;
}

const MAX_PAYLOAD_CHARS = 2000;

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function truncate(json: string | null): string | null {
  if (json === null) return null;
  return json.length > MAX_PAYLOAD_CHARS ? json.slice(0, MAX_PAYLOAD_CHARS) + "…(truncated)" : json;
}
