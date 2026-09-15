import type { ActionContext, ActionDefinition, NormalizedResult } from "../../types";
import { normalizeFeishuResponse } from "../../lib/errors";
import { isFeishuSecret } from "./auth";
import { ConnectedAccountDO } from "../../durable-objects/ConnectedAccountDO";

const MESSAGING_MIN_INTERVAL_MS = 200; // feishu messaging caps at 5 QPS per chat/user — stay well under it

function badRequest(message: string): NormalizedResult {
  return { ok: false, retryable: false, httpStatus: 400, platformCode: "gateway_validation", platformMessage: message, data: null };
}

function accountDO(ctx: ActionContext): DurableObjectStub<ConnectedAccountDO> {
  const ns = ctx.env.CONNECTED_ACCOUNT;
  return ns.get(ns.idFromName(ctx.accountId));
}

export const feishuSendMessage: ActionDefinition = {
  tool: {
    name: "feishu_send_message",
    platform: "feishu",
    description: "Send a message via a feishu app's bot (tenant_access_token, not user OAuth).",
    input_schema: {
      type: "object",
      properties: {
        receive_id: { type: "string" },
        receive_id_type: { type: "string", enum: ["open_id", "user_id", "union_id", "email", "chat_id"] },
        msg_type: { type: "string", description: 'e.g. "text", "post", "interactive"' },
        content: { type: "object", description: "Sent as JSON — the gateway stringifies it for you." },
      },
      required: ["receive_id", "receive_id_type", "msg_type", "content"],
    },
  },
  async execute(ctx: ActionContext): Promise<NormalizedResult> {
    if (!isFeishuSecret(ctx.secret)) return badRequest("connected account is not a feishu credential");
    const { receive_id, receive_id_type, msg_type, content } = ctx.input as Record<string, unknown>;
    if (!receive_id_type) return badRequest("receive_id_type is required (no default on this endpoint)");

    const stub = accountDO(ctx);
    const token = await stub.getFeishuToken(ctx.secret.appId, ctx.secret.appSecret);
    await stub.throttle("feishu-messaging", MESSAGING_MIN_INTERVAL_MS);

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(String(receive_id_type))}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receive_id, msg_type, content: JSON.stringify(content) }),
    });
    return normalizeFeishuResponse(response);
  },
};

export const feishuBitableBatchCreateRecords: ActionDefinition = {
  tool: {
    name: "feishu_bitable_batch_create_records",
    platform: "feishu",
    description: "Batch-create Bitable records (<=1000 per call, all-or-nothing).",
    input_schema: {
      type: "object",
      properties: {
        app_token: { type: "string" },
        table_id: { type: "string" },
        records: { type: "array", items: { type: "object", properties: { fields: { type: "object" } }, required: ["fields"] } },
        // Bitable date fields must be epoch milliseconds; callers name their
        // ISO-date field keys here and the gateway converts them, so callers
        // don't have to remember the platform's millisecond convention.
        date_fields: { type: "array", items: { type: "string" } },
      },
      required: ["app_token", "table_id", "records"],
    },
  },
  async execute(ctx: ActionContext): Promise<NormalizedResult> {
    if (!isFeishuSecret(ctx.secret)) return badRequest("connected account is not a feishu credential");
    const { app_token, table_id, records, date_fields } = ctx.input as {
      app_token: string;
      table_id: string;
      records: Array<{ fields: Record<string, unknown> }>;
      date_fields?: string[];
    };
    if (!Array.isArray(records) || records.length === 0) return badRequest("records must be a non-empty array");
    if (records.length > 1000) return badRequest("records exceeds the 1000-per-call limit (batch_create is all-or-nothing)");

    const normalizedRecords = records.map((record) => {
      if (!date_fields?.length) return record;
      const fields = { ...record.fields };
      for (const key of date_fields) {
        const value = fields[key];
        if (typeof value === "string" || value instanceof Date) fields[key] = new Date(value).getTime();
      }
      return { fields };
    });

    const stub = accountDO(ctx);
    const token = await stub.getFeishuToken(ctx.secret.appId, ctx.secret.appSecret);
    await stub.throttle("feishu-bitable", MESSAGING_MIN_INTERVAL_MS);

    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(app_token)}/tables/${encodeURIComponent(table_id)}/records/batch_create`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: normalizedRecords }),
    });
    return normalizeFeishuResponse(response);
  },
};

export const feishuActions: ActionDefinition[] = [feishuSendMessage, feishuBitableBatchCreateRecords];
