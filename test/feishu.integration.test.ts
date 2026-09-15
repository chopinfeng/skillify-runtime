import { describe, expect, it } from "vitest";
import { feishuBitableBatchCreateRecords, feishuSendMessage } from "../src/platforms/feishu/actions";
import { fetchTenantAccessToken } from "../src/platforms/feishu/auth";
import type { Env } from "../src/types";

/**
 * Real-call integration tests, mirroring the webhook/Bitable scenarios in
 * Skillify/feishu/evals/evals.json. Skipped unless real app credentials are
 * provided via env. Stands in for ConnectedAccountDO with a plain object
 * that calls the same real auth.ts logic the DO would — this exercises the
 * actual HTTP calls without needing the Workers runtime, at the cost of not
 * covering the DO's refresh-serialization behavior (covered by reading the
 * DO source directly / a future workers-pool test).
 */
const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;

function fakeEnv(): Env {
  let cachedToken: string | null = null;
  return {
    CONNECTED_ACCOUNT: {
      get: () => ({
        async getFeishuToken(id: string, secret: string) {
          if (!cachedToken) cachedToken = (await fetchTenantAccessToken(id, secret)).token;
          return cachedToken;
        },
        async throttle() {},
      }),
    },
  } as unknown as Env;
}

describe.skipIf(!appId || !appSecret)("feishu actions (real API)", () => {
  it("exchanges app credentials for a tenant_access_token", async () => {
    const token = await fetchTenantAccessToken(appId!, appSecret!);
    expect(token.token).toBeTruthy();
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it.skipIf(!process.env.FEISHU_TEST_RECEIVE_ID)("sends a text message and gets a normalized success", async () => {
    const result = await feishuSendMessage.execute({
      env: fakeEnv(),
      accountId: "test-account",
      secret: { appId, appSecret },
      input: {
        receive_id: process.env.FEISHU_TEST_RECEIVE_ID,
        receive_id_type: process.env.FEISHU_TEST_RECEIVE_ID_TYPE ?? "open_id",
        msg_type: "text",
        content: { text: "skillify-runtime integration test" },
      },
    });
    expect(result.ok).toBe(true);
  });

  it.skipIf(!process.env.FEISHU_TEST_APP_TOKEN)("rejects >1000 records before making a network call", async () => {
    const result = await feishuBitableBatchCreateRecords.execute({
      env: fakeEnv(),
      accountId: "test-account",
      secret: { appId, appSecret },
      input: {
        app_token: process.env.FEISHU_TEST_APP_TOKEN,
        table_id: process.env.FEISHU_TEST_TABLE_ID ?? "tbl_test",
        records: Array.from({ length: 1001 }, () => ({ fields: {} })),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.platformCode).toBe("gateway_validation");
  });
});
