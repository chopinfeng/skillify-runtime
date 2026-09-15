import { describe, expect, it } from "vitest";
import { bigmodelChatCompletion } from "../src/platforms/bigmodel-cn/actions";
import type { Env } from "../src/types";

/**
 * Real-call integration test, mirroring the "chat completion" scenario in
 * Skillify/bigmodel-cn/evals/evals.json. Skipped unless a real key is
 * provided via env — never hardcode or commit a key.
 *
 *   BIGMODEL_API_KEY=sk-xxx BIGMODEL_PLAN=standard npx vitest run bigmodel-cn
 */
const apiKey = process.env.BIGMODEL_API_KEY;
const planType = (process.env.BIGMODEL_PLAN ?? "standard") as "standard" | "coding";

describe.skipIf(!apiKey)("bigmodel_chat_completion (real API)", () => {
  it("returns a normalized success result for a minimal chat completion", async () => {
    const result = await bigmodelChatCompletion.execute({
      env: {} as Env,
      accountId: "test-account",
      secret: { apiKey, planType },
      input: {
        model: "glm-4.6",
        messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toBeTruthy();
  });

  it("rejects a non-\"auto\" tool_choice before making a network call", async () => {
    const result = await bigmodelChatCompletion.execute({
      env: {} as Env,
      accountId: "test-account",
      secret: { apiKey, planType },
      input: {
        model: "glm-4.6",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: "none",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.platformCode).toBe("gateway_validation");
  });
});
