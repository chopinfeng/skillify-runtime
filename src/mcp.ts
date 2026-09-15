import { McpServer, createMcpHandler, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, NormalizedResult } from "./types";
import type { TenantRow } from "./db";
import { getMostRecentConnectedAccount } from "./db";
import { bigmodelChatCompletion } from "./platforms/bigmodel-cn/actions";
import { feishuBitableBatchCreateRecords, feishuSendMessage } from "./platforms/feishu/actions";
import { runAction } from "./lib/run-action";
import { authenticateTenant } from "./lib/auth";
import type { ActionDefinition } from "./types";

/**
 * MCP tools call through the same runAction pipeline as
 * routes/execute.ts (encryption, retry, audit log) — the difference is
 * account resolution. A REST caller names a connected_account_id
 * explicitly; an MCP client just calls "the tool", the way Composio's
 * dashboard resolves "the app is connected" without a connection id in
 * every call. So each handler auto-picks the tenant's most recent active
 * connected account for that platform (db.ts) and returns a clear text
 * error — not a protocol error — telling the caller to connect one first
 * if none exists.
 */
async function callViaMostRecentAccount(
  env: Env,
  tenant: TenantRow,
  action: ActionDefinition,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  const account = await getMostRecentConnectedAccount(env, tenant.id, action.tool.platform);
  if (!account) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `No ${action.tool.platform} account connected for this tenant yet. Connect one first: POST /v1/connected-accounts.`,
        },
      ],
    };
  }

  const result = await runAction(env, tenant, account, action, input);
  return toCallToolResult(result);
}

function toCallToolResult(result: NormalizedResult): CallToolResult {
  return { isError: !result.ok, content: [{ type: "text", text: JSON.stringify(result) }] };
}

function buildServer(env: Env, tenant: TenantRow): McpServer {
  const server = new McpServer({ name: "skillify-runtime", version: "0.1.0" });

  server.registerTool(
    "bigmodel_chat_completion",
    {
      description: bigmodelChatCompletion.tool.description,
      inputSchema: z.object({
        model: z.string().describe("e.g. glm-4.6"),
        messages: z.array(z.record(z.string(), z.unknown())),
        tools: z.array(z.record(z.string(), z.unknown())).optional(),
        tool_choice: z.literal("auto").optional(),
        temperature: z.number().optional(),
      }),
    },
    async (args) => callViaMostRecentAccount(env, tenant, bigmodelChatCompletion, args),
  );

  server.registerTool(
    "feishu_send_message",
    {
      description: feishuSendMessage.tool.description,
      inputSchema: z.object({
        receive_id: z.string(),
        receive_id_type: z.enum(["open_id", "user_id", "union_id", "email", "chat_id"]),
        msg_type: z.string().describe('e.g. "text", "post", "interactive"'),
        content: z.record(z.string(), z.unknown()),
      }),
    },
    async (args) => callViaMostRecentAccount(env, tenant, feishuSendMessage, args),
  );

  server.registerTool(
    "feishu_bitable_batch_create_records",
    {
      description: feishuBitableBatchCreateRecords.tool.description,
      inputSchema: z.object({
        app_token: z.string(),
        table_id: z.string(),
        records: z.array(z.object({ fields: z.record(z.string(), z.unknown()) })),
        date_fields: z.array(z.string()).optional(),
      }),
    },
    async (args) => callViaMostRecentAccount(env, tenant, feishuBitableBatchCreateRecords, args),
  );

  return server;
}

/** Mounted at /mcp in index.ts. Every request must carry the tenant's
 * Bearer API key — same auth as the REST API, checked once here before
 * building a per-request McpServer scoped to that tenant. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const tenant = await authenticateTenant(request, env);
  if (!tenant) return Response.json({ error: "unauthorized" }, { status: 401 });

  const handler = createMcpHandler(() => buildServer(env, tenant));
  return handler.fetch(request);
}
