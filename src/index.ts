import type { Env } from "./types";
import { authenticateTenant, requireAdmin } from "./lib/auth";
import { handleCreateTenant } from "./routes/tenants";
import { handleCreateAccount, handleListAccounts, handleRevokeAccount } from "./routes/accounts";
import { handleListTools } from "./routes/catalog";
import { handleExecute } from "./routes/execute";
import { handleAuditLog } from "./routes/audit";
import { handleMcp } from "./mcp";

export { ConnectedAccountDO } from "./durable-objects/ConnectedAccountDO";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // Admin bootstrap — no tenant exists yet, so this authenticates
      // differently (ADMIN_TOKEN, not a tenant API key).
      if (method === "POST" && pathname === "/v1/tenants") {
        if (!requireAdmin(request, env)) return unauthorized();
        return await handleCreateTenant(request, env);
      }

      // Tool catalog is not tenant-scoped — it's the same for everyone.
      if (method === "GET" && pathname === "/v1/tools") {
        return handleListTools(request);
      }

      // MCP endpoint — one URL any MCP-compatible agent (Claude, Cursor, …)
      // can install directly. Auth is the same tenant Bearer API key as the
      // REST API, but handleMcp checks it itself since it needs the raw
      // Request, not a pre-resolved tenant, to hand to the MCP handler.
      if (pathname === "/mcp") {
        return await handleMcp(request, env);
      }

      // Everything else requires a tenant API key.
      const tenant = await authenticateTenant(request, env);
      if (!tenant) return unauthorized();

      if (method === "POST" && pathname === "/v1/connected-accounts") return await handleCreateAccount(request, env, tenant);
      if (method === "GET" && pathname === "/v1/connected-accounts") return await handleListAccounts(env, tenant);
      const revokeMatch = pathname.match(/^\/v1\/connected-accounts\/([^/]+)$/);
      if (method === "DELETE" && revokeMatch) return await handleRevokeAccount(env, tenant, revokeMatch[1]);

      if (method === "POST" && pathname === "/v1/actions/execute") return await handleExecute(request, env, tenant);
      if (method === "GET" && pathname === "/v1/audit-log") return await handleAuditLog(request, env, tenant);

      return Response.json({ error: "not found" }, { status: 404 });
    } catch (err) {
      console.error(err);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
