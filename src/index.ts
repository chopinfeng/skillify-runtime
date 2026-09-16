import type { Env } from "./types";
import { authenticateTenant, requireAdmin } from "./lib/auth";
import { handleCreateTenant } from "./routes/tenants";
import { handleCreateAccount, handleListAccounts, handleRevokeAccount } from "./routes/accounts";
import { handleListTools } from "./routes/catalog";
import { handleExecute } from "./routes/execute";
import { handleAuditLog } from "./routes/audit";
import { handleMcp } from "./mcp";
import { handleLogin, handleLogout, handleMe, handleSignup } from "./routes/auth";
import { handleCreateApiKey, handleListApiKeys, handleRevokeApiKey } from "./routes/api-keys";
import { handleConsole } from "./console";

export { ConnectedAccountDO } from "./durable-objects/ConnectedAccountDO";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      // Public — no auth, no tenant. A bare visit to the domain (or any
      // unrecognized path) should never look like an auth failure.
      if (method === "GET" && pathname === "/") {
        return Response.json({
          service: "skillify-runtime",
          status: "ok",
          console: "https://skillify.carbonleft.com/console",
          docs: "https://github.com/chopinfeng/skillify-runtime",
        });
      }
      if (method === "GET" && pathname === "/console") return handleConsole();

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

      // Human-user auth (signup/login issue a session cookie, for the
      // future Web console) — a separate track from the tenant API key
      // used by REST/MCP below. See plan: one user = one tenant.
      if (method === "POST" && pathname === "/v1/auth/signup") return await handleSignup(request, env);
      if (method === "POST" && pathname === "/v1/auth/login") return await handleLogin(request, env);
      if (method === "POST" && pathname === "/v1/auth/logout") return await handleLogout(request, env);
      if (method === "GET" && pathname === "/v1/auth/me") return await handleMe(request, env);

      // API key self-service — also session-gated (the console), not
      // tenant-API-key-gated: you shouldn't need a key already in hand to
      // manage your keys.
      const apiKeyMatch = pathname.match(/^\/v1\/api-keys\/([^/]+)$/);
      if (method === "POST" && pathname === "/v1/api-keys") return await handleCreateApiKey(request, env);
      if (method === "GET" && pathname === "/v1/api-keys") return await handleListApiKeys(request, env);
      if (method === "DELETE" && apiKeyMatch) return await handleRevokeApiKey(request, env, apiKeyMatch[1]);

      // Everything past this point requires a tenant API key — but only
      // for paths that actually exist. Match the route shape FIRST so an
      // unrecognized path 404s instead of masquerading as an auth failure
      // (a caller with no credentials hitting a typo'd or nonexistent path
      // should not see the same 401 as hitting a real protected route).
      const revokeMatch = pathname.match(/^\/v1\/connected-accounts\/([^/]+)$/);
      const isKnownProtectedRoute =
        (method === "POST" && pathname === "/v1/connected-accounts") ||
        (method === "GET" && pathname === "/v1/connected-accounts") ||
        (method === "DELETE" && revokeMatch) ||
        (method === "POST" && pathname === "/v1/actions/execute") ||
        (method === "GET" && pathname === "/v1/audit-log");

      if (!isKnownProtectedRoute) return Response.json({ error: "not found" }, { status: 404 });

      const tenant = await authenticateTenant(request, env);
      if (!tenant) return unauthorized();

      if (method === "POST" && pathname === "/v1/connected-accounts") return await handleCreateAccount(request, env, tenant);
      if (method === "GET" && pathname === "/v1/connected-accounts") return await handleListAccounts(env, tenant);
      if (method === "DELETE" && revokeMatch) return await handleRevokeAccount(env, tenant, revokeMatch[1]);
      if (method === "POST" && pathname === "/v1/actions/execute") return await handleExecute(request, env, tenant);
      return await handleAuditLog(request, env, tenant); // only remaining match: GET /v1/audit-log
    } catch (err) {
      console.error(err);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
