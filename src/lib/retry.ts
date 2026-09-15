import type { NormalizedResult } from "../types";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries only when the normalized result says so — never on 4xx that isn't
 * explicitly a rate limit (per plan: bigmodel-cn backs off on 429/5xx only,
 * feishu backs off on 429 / code 99991400 only). Honors an explicit
 * platform-given retry-after when present, otherwise exponential backoff. */
export async function withRetry(
  call: () => Promise<NormalizedResult>,
  maxAttempts = MAX_ATTEMPTS,
): Promise<NormalizedResult> {
  let last: NormalizedResult | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await call();
    if (last.ok || !last.retryable || attempt === maxAttempts - 1) return last;
    const waitMs = last.retryAfterSeconds != null ? last.retryAfterSeconds * 1000 : BASE_BACKOFF_MS * 2 ** attempt;
    await sleep(waitMs);
  }
  return last!;
}
