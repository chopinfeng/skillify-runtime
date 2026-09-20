import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { isRegistrationRateLimited, recordRegistrationAttempt } from "../src/lib/rate-limit";
import { createFakeD1 } from "./fake-d1";

function requestFromIp(ip: string): Request {
  return new Request("https://skillify.carbonleft.com/v1/auth/agent-register", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
}

/** Regression guard for the check/record split (code review finding: the
 * old combined checkAndRecordRegistrationAttempt() debited the quota before
 * agent-register.ts had verified a PoW solution, so a caller retrying a
 * buggy PoW implementation could burn its whole hourly budget without ever
 * producing a registration). Confirms checking alone is side-effect-free,
 * and that the quota is exactly what recordRegistrationAttempt() calls. */
describe("registration rate limit", () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createFakeD1() as unknown as Env["DB"] } as Env;
  });

  it("is not rate-limited before any attempts are recorded", async () => {
    expect(await isRegistrationRateLimited(requestFromIp("1.2.3.4"), env)).toBe(false);
  });

  it("checking does not itself count as an attempt", async () => {
    const request = requestFromIp("1.2.3.4");
    for (let i = 0; i < 20; i++) await isRegistrationRateLimited(request, env);
    expect(await isRegistrationRateLimited(request, env)).toBe(false);
  });

  it("becomes rate-limited after 5 recorded attempts from the same IP", async () => {
    const request = requestFromIp("1.2.3.4");
    for (let i = 0; i < 5; i++) {
      expect(await isRegistrationRateLimited(request, env)).toBe(false);
      await recordRegistrationAttempt(request, env);
    }
    expect(await isRegistrationRateLimited(request, env)).toBe(true);
  });

  it("tracks each source IP independently", async () => {
    const requestA = requestFromIp("1.1.1.1");
    const requestB = requestFromIp("2.2.2.2");
    for (let i = 0; i < 5; i++) await recordRegistrationAttempt(requestA, env);
    expect(await isRegistrationRateLimited(requestA, env)).toBe(true);
    expect(await isRegistrationRateLimited(requestB, env)).toBe(false);
  });
});
