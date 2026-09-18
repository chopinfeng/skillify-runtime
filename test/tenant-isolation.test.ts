import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/types";
import {
  createConnectedAccount,
  createTenantApiKey,
  createTenantWithDek,
  getConnectedAccount,
  getTenantByApiKey,
  listConnectedAccounts,
  revokeConnectedAccount,
} from "../src/db";
import { createFakeD1 } from "./fake-d1";

/**
 * Regression guard for the exact boundary the security review before public
 * launch focused on: a self-registered tenant must be structurally unable
 * to read, list, or revoke another tenant's connected-platform credentials,
 * no matter what id it guesses or is handed. Every assertion here maps
 * directly to a `WHERE tenant_id = ?` clause in db.ts — if a future edit
 * drops one, this fails instead of silently reopening the hole.
 */
describe("tenant isolation", () => {
  let env: Env;

  beforeEach(() => {
    env = { DB: createFakeD1() as unknown as Env["DB"], KEK_BASE64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } as Env;
  });

  async function setUpTwoTenants() {
    const tenantA = await createTenantWithDek(env, "tenant A");
    const tenantB = await createTenantWithDek(env, "tenant B");
    const { plaintextKey: keyA } = await createTenantApiKey(env, tenantA.id);
    const { plaintextKey: keyB } = await createTenantApiKey(env, tenantB.id);
    const accountA = await createConnectedAccount(env, tenantA.id, "bigmodel-cn", "A's account", "encrypted-blob-a");
    return { tenantA, tenantB, keyA, keyB, accountA };
  }

  it("never returns another tenant's connected account by id, even with the correct account id", async () => {
    const { tenantB, accountA } = await setUpTwoTenants();
    const result = await getConnectedAccount(env, accountA.id, tenantB.id);
    expect(result).toBeNull();
  });

  it("returns the account only to its own tenant", async () => {
    const { tenantA, accountA } = await setUpTwoTenants();
    const result = await getConnectedAccount(env, accountA.id, tenantA.id);
    expect(result?.id).toBe(accountA.id);
  });

  it("never lists another tenant's connected accounts", async () => {
    const { tenantB } = await setUpTwoTenants();
    const listing = await listConnectedAccounts(env, tenantB.id);
    expect(listing).toEqual([]);
  });

  it("cannot revoke another tenant's connected account", async () => {
    const { tenantA, tenantB, accountA } = await setUpTwoTenants();
    await revokeConnectedAccount(env, accountA.id, tenantB.id);
    const stillActive = await getConnectedAccount(env, accountA.id, tenantA.id);
    expect(stillActive?.id).toBe(accountA.id);
  });

  it("resolves an API key to its own tenant only, never another tenant sharing the lookup table", async () => {
    const { tenantA, tenantB, keyA, keyB } = await setUpTwoTenants();
    expect((await getTenantByApiKey(env, keyA))?.id).toBe(tenantA.id);
    expect((await getTenantByApiKey(env, keyB))?.id).toBe(tenantB.id);
  });

  it("rejects a fabricated or unknown API key", async () => {
    await setUpTwoTenants();
    expect(await getTenantByApiKey(env, "sk_live_not_a_real_key")).toBeNull();
  });
});
