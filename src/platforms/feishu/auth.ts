/** feishu secret shape: an app's app_id/app_secret. The gateway exchanges
 * this for a `tenant_access_token` itself and caches/refreshes it (see
 * ConnectedAccountDO) — callers never see or manage the token. This covers
 * app-level actions (bot messages, Bitable); it deliberately does NOT
 * implement the 3-legged `user_access_token` OAuth flow, which is only
 * needed to act as a specific human user (out of scope for the MVP). */
export interface FeishuSecret {
  appId: string;
  appSecret: string;
  [key: string]: unknown;
}

export function isFeishuSecret(secret: Record<string, unknown>): secret is FeishuSecret {
  return typeof secret.appId === "string" && typeof secret.appSecret === "string";
}

export interface TenantAccessToken {
  token: string;
  expiresAt: number; // epoch ms
}

/** Skillify/feishu/references/auth.md:71-101 — response is a top-level
 * `tenant_access_token` + `expire` (seconds, max 7200), not wrapped in
 * `data` like most feishu endpoints. */
export async function fetchTenantAccessToken(appId: string, appSecret: string): Promise<TenantAccessToken> {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = (await response.json()) as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`feishu tenant_access_token exchange failed: code=${body.code} msg=${body.msg}`);
  }
  return {
    token: body.tenant_access_token,
    expiresAt: Date.now() + (body.expire ?? 7200) * 1000,
  };
}

/** Refresh when less than 30 minutes remain, per the validated threshold in
 * references/auth.md:71-101. */
export function needsRefresh(token: TenantAccessToken | null): boolean {
  if (!token) return true;
  return token.expiresAt - Date.now() < 30 * 60 * 1000;
}
