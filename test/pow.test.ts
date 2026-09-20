import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { getPowChallenge } from "../src/db";
import { issuePowChallenge, verifyAndConsumePow } from "../src/lib/pow";
import { sha256Hex } from "../src/lib/crypto";
import { createFakeD1 } from "./fake-d1";

describe("proof-of-work registration gate", () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createFakeD1() as unknown as Env["DB"] } as Env;
  });

  /** Inserts a challenge directly at a deliberately low difficulty so tests
   * don't have to actually burn CPU solving the real ~2^20-attempt target
   * used in production (that's exercised for real via issuePowChallenge's
   * shape below, just not solved here). */
  async function seedChallenge(difficultyBits: number, expiresAt = Date.now() + 60_000): Promise<string> {
    const challenge = "test-challenge";
    (env.DB as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables.pow_challenges.push({
      id: "pow_test",
      challenge,
      difficulty_bits: difficultyBits,
      created_at: Date.now(),
      expires_at: expiresAt,
      consumed_at: null,
    });
    return challenge;
  }

  async function bruteForce(challenge: string, difficultyBits: number): Promise<string> {
    for (let i = 0; ; i++) {
      const solution = String(i);
      const digest = await sha256Hex(`${challenge}:${solution}`);
      const bits = digest.match(/^0*/)![0].length * 4; // good enough for the small test difficulties used here
      if (bits >= difficultyBits) return solution;
    }
  }

  it("issues a challenge with the expected shape and persists it", async () => {
    const issued = await issuePowChallenge(env);
    expect(issued.challenge).toBeTruthy();
    expect(issued.difficultyBits).toBeGreaterThan(0);
    expect(issued.expiresAt).toBeGreaterThan(Date.now());
    const stored = await getPowChallenge(env, issued.challenge);
    expect(stored?.consumed_at).toBeFalsy();
  });

  it("accepts a solution that meets the required difficulty", async () => {
    const challenge = await seedChallenge(8);
    const solution = await bruteForce(challenge, 8);
    const result = await verifyAndConsumePow(env, challenge, solution);
    expect(result.ok).toBe(true);
  });

  it("rejects a solution that doesn't meet the required difficulty", async () => {
    const challenge = await seedChallenge(64); // effectively unreachable by a guess
    const result = await verifyAndConsumePow(env, challenge, "0");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("difficulty") });
  });

  it("rejects an unknown challenge", async () => {
    const result = await verifyAndConsumePow(env, "never-issued", "0");
    expect(result).toEqual({ ok: false, error: "unknown challenge" });
  });

  it("rejects an expired challenge", async () => {
    const challenge = await seedChallenge(0, Date.now() - 1000);
    const result = await verifyAndConsumePow(env, challenge, "0");
    expect(result.ok).toBe(false);
  });

  it("cannot be replayed once consumed", async () => {
    const challenge = await seedChallenge(4);
    const solution = await bruteForce(challenge, 4);
    const first = await verifyAndConsumePow(env, challenge, solution);
    expect(first.ok).toBe(true);
    const second = await verifyAndConsumePow(env, challenge, solution);
    expect(second).toEqual({ ok: false, error: "challenge already used" });
  });

  it("does not consume the challenge on a failed attempt, so a retry with the right solution still works", async () => {
    const challenge = await seedChallenge(4);
    const wrong = await verifyAndConsumePow(env, challenge, "not-a-solution");
    expect(wrong.ok).toBe(false);
    const solution = await bruteForce(challenge, 4);
    const retry = await verifyAndConsumePow(env, challenge, solution);
    expect(retry.ok).toBe(true);
  });
});
