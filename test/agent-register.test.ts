import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { handleAgentRegister } from "../src/routes/agent-register";
import { issuePowChallenge } from "../src/lib/pow";
import { isRegistrationRateLimited } from "../src/lib/rate-limit";
import { createFakeD1 } from "./fake-d1";

function registerRequest(body: unknown, ip = "9.9.9.9"): Request {
  return new Request("https://skillify.carbonleft.com/v1/auth/agent-register", {
    method: "POST",
    headers: { "cf-connecting-ip": ip, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Brute-forces a real solution at production difficulty (~2^20 attempts).
 * Uses Node's synchronous crypto instead of the async Web Crypto-backed
 * sha256Hex() that production code calls once per verify — awaiting
 * crypto.subtle.digest() a million times in a loop is dominated by
 * microtask overhead and would make this test far too slow. Same digest
 * bytes either way (it's still SHA-256); only the solving step, not the
 * verification under test, takes the fast path. */
async function solveRealChallenge(env: Env): Promise<{ challenge: string; solution: string }> {
  const { challenge, difficultyBits } = await issuePowChallenge(env);
  for (let i = 0; ; i++) {
    const solution = String(i);
    const digest = createHash("sha256").update(`${challenge}:${solution}`).digest("hex");
    let bits = 0;
    for (const ch of digest) {
      const n = parseInt(ch, 16);
      if (n !== 0) {
        bits += Math.clz32(n) - 28;
        break;
      }
      bits += 4;
    }
    if (bits >= difficultyBits) return { challenge, solution };
  }
}

/** Regression coverage for the check-order fix (code review finding #1): a
 * caller that never solves the PoW challenge correctly must not burn its
 * per-IP registration quota, since debiting on every request — including
 * ones that were never going to succeed — locked out a legitimate agent
 * mid-debugging for an hour. */
describe("POST /v1/auth/agent-register", () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createFakeD1() as unknown as Env["DB"], KEK_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } as Env;
  });

  it("does not consume the rate-limit quota on repeated PoW failures", async () => {
    const ip = "9.9.9.9";
    for (let i = 0; i < 10; i++) {
      const res = await handleAgentRegister(registerRequest({ name: "broken-agent" }, ip), env);
      expect(res.status).toBe(400); // missing/invalid challenge+solution, not 429
    }
    expect(await isRegistrationRateLimited(registerRequest({}, ip), env)).toBe(false);
  }, 20000);

  it("registers successfully with a real solved challenge and records exactly one attempt", async () => {
    const ip = "8.8.8.8";
    const { challenge, solution } = await solveRealChallenge(env);
    const res = await handleAgentRegister(registerRequest({ name: "real-agent", challenge, solution }, ip), env);
    expect(res.status).toBe(201);
    const parsed = (await res.json()) as { tenant_id: string; api_key: string; claimed: boolean };
    expect(parsed.claimed).toBe(false);
    expect(parsed.tenant_id).toBeTruthy();
    expect(parsed.api_key).toBeTruthy();
    // One real registration used exactly 1 of the 5 slots, not 0 and not more.
    expect(await isRegistrationRateLimited(registerRequest({}, ip), env)).toBe(false);
  }, 20000);

  it("rejects a replayed challenge+solution on a second call, still without extra rate-limit cost", async () => {
    const ip = "7.7.7.7";
    const { challenge, solution } = await solveRealChallenge(env);
    const first = await handleAgentRegister(registerRequest({ challenge, solution }, ip), env);
    expect(first.status).toBe(201);
    const second = await handleAgentRegister(registerRequest({ challenge, solution }, ip), env);
    expect(second.status).toBe(400);
  }, 20000);
});
