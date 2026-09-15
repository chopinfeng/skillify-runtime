/** bigmodel-cn secret shape: a static API key, no OAuth, no refresh.
 * `planType` picks the base URL — a Coding Plan key hitting the standard
 * endpoint always fails with HTTP 429 body code "1113"
 * (Skillify/bigmodel-cn/references/errors-and-limits.md:40), so the
 * gateway resolves the URL from the connected account instead of trusting
 * the caller to get it right. */
export interface BigmodelSecret {
  apiKey: string;
  planType: "standard" | "coding";
  [key: string]: unknown;
}

const BASE_URLS: Record<BigmodelSecret["planType"], string> = {
  standard: "https://open.bigmodel.cn/api/paas/v4",
  coding: "https://open.bigmodel.cn/api/coding/paas/v4",
};

export function isBigmodelSecret(secret: Record<string, unknown>): secret is BigmodelSecret {
  return typeof secret.apiKey === "string" && (secret.planType === "standard" || secret.planType === "coding");
}

export function baseUrlFor(secret: BigmodelSecret): string {
  return BASE_URLS[secret.planType];
}
