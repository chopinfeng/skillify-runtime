import type { Env } from "../types";
import { countRecentRegistrationAttempts, recordRegistrationAttempt } from "../db";
import { sha256Hex } from "./crypto";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 5;

function clientIp(request: Request): string {
  // Workers sets this from the real connection; a caller can't spoof it by
  // sending its own header (Cloudflare overwrites it at the edge).
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Simple per-IP sliding-window limit for the open agent-registration
 * endpoint — the only thing standing between "anyone can mint tenants for
 * free" and it being trivially scriptable into spam. D1-backed rather than
 * a dedicated Durable Object: registration is low-frequency by nature, and
 * this reuses the same insert-then-count pattern already used elsewhere
 * (audit_log) instead of adding new infrastructure for it. */
export async function checkAndRecordRegistrationAttempt(request: Request, env: Env): Promise<boolean> {
  const ipHash = await sha256Hex(clientIp(request));
  const recent = await countRecentRegistrationAttempts(env, ipHash, Date.now() - WINDOW_MS);
  if (recent >= MAX_PER_WINDOW) return false;
  await recordRegistrationAttempt(env, ipHash);
  return true;
}
