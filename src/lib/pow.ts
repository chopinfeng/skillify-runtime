import type { Env } from "../types";
import { consumePowChallenge, deleteExpiredPowChallenges, getPowChallenge, insertPowChallenge } from "../db";
import { randomId, sha256Hex } from "./crypto";

/** Difficulty target: ~2^20 average SHA-256 attempts to solve — sub-second
 * on Node/Workers, a few seconds in a slower scripting runtime. Cheap
 * enough that one legitimate agent registration costs nothing noticeable,
 * expensive enough that registering thousands of disposable tenants costs
 * real wall-clock compute no matter how many source IPs it's spread across
 * (unlike the per-IP rate limit in rate-limit.ts, which this complements
 * rather than replaces). Tune upward if abuse is observed in practice. */
const DIFFICULTY_BITS = 20;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** A real solution is a small integer counter stringified — a handful of
 * characters. These caps exist only to stop an unauthenticated caller from
 * forcing an oversized SHA-256 computation (or a wasted indexed lookup) by
 * sending a huge challenge/solution string; generous enough that no honest
 * solver ever comes close. */
const MAX_CHALLENGE_LENGTH = 64;
const MAX_SOLUTION_LENGTH = 128;

export interface PowChallenge {
  challenge: string;
  difficultyBits: number;
  expiresAt: number;
}

/** GET /v1/auth/pow-challenge has no auth and no rate limit of its own (see
 * routes/pow-challenge.ts), so nothing stops it being called often — sweep
 * expired rows (solved or not) on every issuance instead of letting the
 * table grow unbounded from an endpoint anyone can hit for free. */
export async function issuePowChallenge(env: Env): Promise<PowChallenge> {
  await deleteExpiredPowChallenges(env, Date.now());
  const challenge = randomId("pow");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  await insertPowChallenge(env, challenge, DIFFICULTY_BITS, expiresAt);
  return { challenge, difficultyBits: DIFFICULTY_BITS, expiresAt };
}

/** Leading zero BITS of a hex digest, not hex nibbles — gives finer-grained
 * difficulty control than "N leading hex zeros" would (4 bits per step). */
function countLeadingZeroBits(hex: string): number {
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble !== 0) return i * 4 + (Math.clz32(nibble) - 28);
  }
  return hex.length * 4;
}

export type PowVerifyResult = { ok: true } | { ok: false; error: string };

/** Verifies `sha256Hex("<challenge>:<solution>")` meets the challenge's
 * difficulty, then consumes the challenge so it can't be replayed for a
 * second registration. A wrong solution is rejected WITHOUT consuming the
 * challenge, so a caller that got the hash format wrong can retry against
 * the same challenge instead of paying for a fresh one. */
export async function verifyAndConsumePow(env: Env, challenge: string, solution: string): Promise<PowVerifyResult> {
  if (!challenge || !solution) return { ok: false, error: "challenge and solution are required" };
  if (challenge.length > MAX_CHALLENGE_LENGTH || solution.length > MAX_SOLUTION_LENGTH) {
    return { ok: false, error: "challenge or solution is longer than any real one would be" };
  }
  const row = await getPowChallenge(env, challenge);
  if (!row) return { ok: false, error: "unknown challenge" };
  if (row.consumed_at) return { ok: false, error: "challenge already used" };
  if (Date.now() > row.expires_at) return { ok: false, error: "challenge expired, request a new one from GET /v1/auth/pow-challenge" };

  const digest = await sha256Hex(`${challenge}:${solution}`);
  if (countLeadingZeroBits(digest) < row.difficulty_bits) {
    return { ok: false, error: `solution does not meet required difficulty (${row.difficulty_bits} bits)` };
  }

  const consumed = await consumePowChallenge(env, challenge);
  if (!consumed) return { ok: false, error: "challenge already used" };
  return { ok: true };
}
