import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";
import { fetchTenantAccessToken, needsRefresh, type TenantAccessToken } from "../platforms/feishu/auth";

/**
 * One instance per connected account (id'd by the account's DB row id via
 * `idFromName`). Being a single-threaded DO per account gives us, for free:
 *  - serialized token refresh (feishu's refresh_token is single-use and
 *    races if two requests refresh concurrently — here there's only ever
 *    one in-flight refresh per account, deduped via `refreshInFlight`)
 *  - a natural place to throttle calls for a single account without a
 *    distributed rate limiter
 */
export class ConnectedAccountDO extends DurableObject<Env> {
  private refreshInFlight: Promise<TenantAccessToken> | null = null;

  /** Returns a valid tenant_access_token, fetching/refreshing as needed. */
  async getFeishuToken(appId: string, appSecret: string): Promise<string> {
    const cached = await this.ctx.storage.get<TenantAccessToken>("feishuToken");
    if (!needsRefresh(cached ?? null)) return cached!.token;

    if (!this.refreshInFlight) {
      this.refreshInFlight = fetchTenantAccessToken(appId, appSecret).finally(() => {
        this.refreshInFlight = null;
      });
    }
    const fresh = await this.refreshInFlight;
    await this.ctx.storage.put("feishuToken", fresh);
    return fresh.token;
  }

  /** Spaces out calls to this account by at least `minIntervalMs`, blocking
   * the caller rather than dropping the request. `platform` is unused today
   * but keeps the signature ready for per-platform limits instead of one
   * hardcoded interval. */
  async throttle(_platform: string, minIntervalMs: number): Promise<void> {
    const lastCallAt = (await this.ctx.storage.get<number>("lastCallAt")) ?? 0;
    const waitMs = lastCallAt + minIntervalMs - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    await this.ctx.storage.put("lastCallAt", Date.now());
  }
}
