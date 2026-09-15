import type { Env } from "../types";
import type { TenantRow } from "../db";
import { getConnectedAccount } from "../db";
import { ACTIONS_BY_NAME } from "../registry";
import { runAction } from "../lib/run-action";

export async function handleExecute(request: Request, env: Env, tenant: TenantRow): Promise<Response> {
  const body = (await request.json()) as { tool_name?: string; connected_account_id?: string; input?: Record<string, unknown> };
  const action = body.tool_name ? ACTIONS_BY_NAME[body.tool_name] : undefined;
  if (!action) return Response.json({ error: `unknown tool_name: ${body.tool_name}` }, { status: 400 });
  if (!body.connected_account_id) return Response.json({ error: "connected_account_id is required" }, { status: 400 });

  const account = await getConnectedAccount(env, body.connected_account_id, tenant.id);
  if (!account) return Response.json({ error: "connected_account not found for this tenant" }, { status: 404 });
  if (account.platform !== action.tool.platform) {
    return Response.json({ error: `${body.tool_name} requires a ${action.tool.platform} account, got ${account.platform}` }, { status: 400 });
  }

  const result = await runAction(env, tenant, account, action, body.input ?? {});
  const status = result.ok ? 200 : result.platformCode === "gateway_validation" ? 400 : 502;
  return Response.json(result, { status });
}
