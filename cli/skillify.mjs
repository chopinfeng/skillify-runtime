#!/usr/bin/env node
/**
 * skillify — thin CLI over skillify-runtime's REST/MCP API, mirroring the
 * shape of `composio search` / `composio execute`. No dependencies beyond
 * Node's own fetch (Node 18+).
 *
 * Auth: SKILLIFY_API_KEY env var (a tenant API key — see `POST /v1/api-keys`
 * or the console at /console). Base URL: SKILLIFY_BASE_URL, defaults to the
 * hosted instance.
 */
const BASE_URL = process.env.SKILLIFY_BASE_URL ?? "https://skillify.carbonleft.com";
const API_KEY = process.env.SKILLIFY_API_KEY;

function usage() {
  console.error(`skillify <command> [args]

Commands:
  tools [--platform <name>]        List available tools
  search <query>                   Find tools whose name/description match a keyword
  execute <tool_name> -d '<json>'  Call a tool via MCP (auto-picks the connected account)
  accounts                         List this tenant's connected accounts
  audit-log [--limit N]            Show recent tool-call history

Env:
  SKILLIFY_API_KEY   tenant API key (required) — get one at ${BASE_URL}/console
  SKILLIFY_BASE_URL  defaults to ${BASE_URL}
`);
}

async function restJson(path, opts = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

let mcpRequestId = 0;

/** Stateless MCP over HTTP: initialize once, then the tools/call — no
 * session to hold between the two since createMcpHandler serves each
 * request from a fresh server instance. */
async function mcpCall(method, params) {
  const response = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++mcpRequestId, method, params }),
  });
  const text = await response.text();
  // Streamable HTTP answers with either a plain JSON body or one SSE
  // "data: {...}" frame — handle both without pulling in an SSE client.
  const jsonLine = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
  if (!jsonLine) throw new Error(`unexpected MCP response (status ${response.status}): ${text.slice(0, 300)}`);
  const parsed = JSON.parse(jsonLine);
  if (parsed.error) throw new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`);
  return parsed.result;
}

async function cmdTools(args) {
  const platformFlag = args.indexOf("--platform");
  const qs = platformFlag !== -1 ? `?platform=${encodeURIComponent(args[platformFlag + 1])}` : "";
  const { body } = await restJson(`/v1/tools${qs}`);
  for (const t of body.tools) console.log(`${t.name}  [${t.platform}]\n  ${t.description}\n`);
}

async function cmdSearch(args) {
  const query = args.join(" ").toLowerCase();
  if (!query) return usage();
  const { body } = await restJson("/v1/tools");
  const matches = body.tools.filter((t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query));
  if (matches.length === 0) return console.log("no matching tools");
  for (const t of matches) console.log(`${t.name}  [${t.platform}]\n  ${t.description}\n`);
}

async function cmdExecute(args) {
  const toolName = args[0];
  const dFlag = args.indexOf("-d");
  if (!toolName || dFlag === -1) return usage();
  const input = JSON.parse(args[dFlag + 1]);

  await mcpCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "skillify-cli", version: "0.1" } });
  const result = await mcpCall("tools/call", { name: toolName, arguments: input });
  console.log(result.content?.[0]?.text ?? JSON.stringify(result));
  if (result.isError) process.exitCode = 1;
}

async function cmdAccounts() {
  const { body } = await restJson("/v1/connected-accounts");
  for (const a of body.accounts) console.log(`${a.id}  ${a.platform}  "${a.label}"  ${new Date(a.created_at).toISOString()}`);
  if (body.accounts.length === 0) console.log("no connected accounts — connect one via POST /v1/connected-accounts or the console");
}

async function cmdAuditLog(args) {
  const limitFlag = args.indexOf("--limit");
  const qs = limitFlag !== -1 ? `?limit=${encodeURIComponent(args[limitFlag + 1])}` : "";
  const { body } = await restJson(`/v1/audit-log${qs}`);
  for (const e of body.entries) console.log(`${new Date(e.created_at).toISOString()}  ${e.tool_name}  ${e.ok ? "ok" : "FAIL"}  ${e.duration_ms}ms`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!API_KEY) {
    console.error("SKILLIFY_API_KEY is not set.");
    return process.exit(1);
  }
  try {
    switch (command) {
      case "tools": return await cmdTools(args);
      case "search": return await cmdSearch(args);
      case "execute": return await cmdExecute(args);
      case "accounts": return await cmdAccounts();
      case "audit-log": return await cmdAuditLog(args);
      default: return usage();
    }
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}

main();
