import type { Env } from "../types";
import { countRecentRegistrationAttempts, recordRegistrationAttempt as dbRecordRegistrationAttempt } from "../db";
import { sha256Hex } from "./crypto";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 5;

function clientIp(request: Request): string {
  // Workers sets this from the real connection; a caller can't spoof it by
  // sending its own header (Cloudflare overwrites it at the edge).
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

async function ipHash(request: Request): Promise<string> {
  return sha256Hex(clientIp(request));
}

/** Simple per-IP sliding-window limit for the open agent-registration
 * endpoint — the only thing standing between "anyone can mint tenants for
 * free" and it being trivially scriptable into spam. D1-backed rather than
 * a dedicated Durable Object: registration is low-frequency by nature, and
 * this reuses the same insert-then-count pattern already used elsewhere
 * (audit_log) instead of adding new infrastructure for it.
 *
 * Deliberately split from recording: checking is read-only so a caller can
 * be told "no" without cost, and the caller decides *when* an attempt is
 * worth debiting from the budget — agent-register only records after a
 * valid PoW solution, so a buggy PoW implementation retried a few times
 * doesn't burn the caller's whole hourly quota before it ever produces a
 * real registration. */
export async function isRegistrationRateLimited(request: Request, env: Env): Promise<boolean> {
  const recent = await countRecentRegistrationAttempts(env, await ipHash(request), Date.now() - WINDOW_MS);
  return recent >= MAX_PER_WINDOW;
}

export async function recordRegistrationAttempt(request: Request, env: Env): Promise<void> {
  await dbRecordRegistrationAttempt(env, await ipHash(request));
}
