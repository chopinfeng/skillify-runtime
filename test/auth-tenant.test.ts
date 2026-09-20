import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import { authenticateTenant, authenticateTenantByApiKey } from "../src/lib/auth";
import { createTenantApiKey, createTenantWithDek, createUser } from "../src/db";
import { createSessionCookie } from "../src/lib/session";
import { hashPassword } from "../src/lib/password";
import { createFakeD1 } from "./fake-d1";

function requestWithHeader(name: string, value: string): Request {
  return new Request("https://skillify.carbonleft.com/v1/auth/claim", { headers: { [name]: value } });
}

/** Regression coverage for claim.ts switching from the session-accepting
 * authenticateTenant to the Bearer-only authenticateTenantByApiKey (code
 * review finding #5): claim's whole point is proving possession of a
 * specific tenant's own API key, so a session cookie alone — proof only of
 * being logged in as *some* user — must not satisfy it. */
describe("authenticateTenantByApiKey", () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createFakeD1() as unknown as Env["DB"], KEK_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } as Env;
  });

  async function setUpClaimedTenantWithSession() {
    const tenant = await createTenantWithDek(env, "claimed tenant");
    const user = await createUser(env, tenant.id, "human@example.com", await hashPassword("at-least-8-chars"));
    const cookieHeader = await createSessionCookie(env, user.id);
    const sessionCookieValue = cookieHeader.split(";")[0]; // "sf_session=<token>"
    const { plaintextKey } = await createTenantApiKey(env, tenant.id);
    return { tenant, sessionCookieValue, plaintextKey };
  }

  it("resolves a tenant from a Bearer API key", async () => {
    const { tenant, plaintextKey } = await setUpClaimedTenantWithSession();
    const resolved = await authenticateTenantByApiKey(requestWithHeader("authorization", `Bearer ${plaintextKey}`), env);
    expect(resolved?.id).toBe(tenant.id);
  });

  it("does NOT resolve a tenant from a session cookie alone, unlike authenticateTenant", async () => {
    const { tenant, sessionCookieValue } = await setUpClaimedTenantWithSession();
    const request = requestWithHeader("cookie", sessionCookieValue);

    // The general-purpose resolver (used by the REST resource routes) is
    // fine with a session — this is the behavior authenticateTenantByApiKey
    // deliberately narrows away from for claim.
    expect((await authenticateTenant(request, env))?.id).toBe(tenant.id);
    expect(await authenticateTenantByApiKey(request, env)).toBeNull();
  });

  it("rejects a request with neither credential", async () => {
    expect(await authenticateTenantByApiKey(new Request("https://skillify.carbonleft.com/v1/auth/claim"), env)).toBeNull();
  });
});
