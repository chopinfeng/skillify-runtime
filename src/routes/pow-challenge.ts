import type { Env } from "../types";
import { issuePowChallenge } from "../lib/pow";

/** First step of agent self-registration: GET a challenge, solve it, then
 * POST /v1/auth/agent-register with {challenge, solution, ...}. No auth and
 * no rate limit here — issuing a challenge is cheap and does nothing on its
 * own; it's only redeemable once solved, and agent-register itself stays
 * IP-rate-limited on top of requiring a valid solution. */
export async function handlePowChallenge(env: Env): Promise<Response> {
  const { challenge, difficultyBits, expiresAt } = await issuePowChallenge(env);
  return Response.json({
    challenge,
    difficulty_bits: difficultyBits,
    expires_at: expiresAt,
    hint:
      "Find a solution such that the hex-encoded SHA-256 digest of `${challenge}:${solution}` has at least difficulty_bits leading zero bits, then POST it to /v1/auth/agent-register as {challenge, solution, ...}.",
  });
}
