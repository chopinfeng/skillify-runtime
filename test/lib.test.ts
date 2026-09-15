import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, generateDek, unwrapDek, wrapDek } from "../src/lib/crypto";
import { normalizeBigmodelResponse, normalizeFeishuResponse } from "../src/lib/errors";

describe("envelope encryption", () => {
  it("round-trips a DEK through the KEK, and a secret through the DEK", async () => {
    const kekBase64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const dek = generateDek();
    const wrapped = await wrapDek(dek, kekBase64);
    const unwrapped = await unwrapDek(wrapped, kekBase64);
    expect([...unwrapped]).toEqual([...dek]);

    const secret = { apiKey: "sk-test-123", planType: "standard" };
    const encrypted = await encryptSecret(dek, secret);
    expect(encrypted).not.toContain("sk-test-123");
    const decrypted = await decryptSecret(dek, encrypted);
    expect(decrypted).toEqual(secret);
  });
});

describe("normalizeBigmodelResponse", () => {
  it("treats HTTP status as authoritative and surfaces error.code", async () => {
    const response = new Response(JSON.stringify({ error: { code: "1302", message: "rate limited" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeBigmodelResponse(response);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.platformCode).toBe("1302");
  });

  it("treats 2xx with no error field as success", async () => {
    const response = new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeBigmodelResponse(response);
    expect(result.ok).toBe(true);
  });
});

describe("normalizeFeishuResponse", () => {
  it("ignores HTTP 200 and trusts body.code instead", async () => {
    const response = new Response(JSON.stringify({ code: 99991661, msg: "no token" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeFeishuResponse(response);
    expect(result.ok).toBe(false);
    expect(result.platformCode).toBe("99991661");
  });

  it("treats code:0 as success regardless of status", async () => {
    const response = new Response(JSON.stringify({ code: 0, msg: "success", data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const result = await normalizeFeishuResponse(response);
    expect(result.ok).toBe(true);
  });

  it("handles a non-JSON 404 without throwing", async () => {
    const response = new Response("404 page not found", { status: 404, headers: { "content-type": "text/plain" } });
    const result = await normalizeFeishuResponse(response);
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });
});
