import type { NormalizedResult } from "../types";

interface RawBody {
  contentType: string;
  text: string;
  json: unknown | null;
}

export async function readRawBody(response: Response): Promise<RawBody> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  let json: unknown | null = null;
  if (contentType.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { contentType, text, json };
}

/**
 * bigmodel-cn: HTTP status is meaningful. Failure body shape is
 * `{"error":{"code":"1001","message":"..."}}`. 429 codes 1302/1305 are
 * plain throttling (retryable); 1308/1310 carry `next_flush_time` (Skillify
 * runtime/references/chat.md, errors-and-limits.md).
 */
export async function normalizeBigmodelResponse(response: Response): Promise<NormalizedResult> {
  const { json } = await readRawBody(response);
  const body = (json ?? {}) as { error?: { code?: string; message?: string }; [k: string]: unknown };
  const ok = response.ok && !body.error;
  const code = body.error?.code ?? null;
  const retryable = response.status === 429 || response.status >= 500;
  let retryAfterSeconds: number | undefined;
  if (code === "1308" || code === "1310") {
    const nextFlush = (body.error as { next_flush_time?: number } | undefined)?.next_flush_time;
    if (typeof nextFlush === "number") retryAfterSeconds = Math.max(0, nextFlush - Math.floor(Date.now() / 1000));
  }
  return {
    ok,
    retryable,
    httpStatus: response.status,
    platformCode: code,
    platformMessage: body.error?.message ?? null,
    retryAfterSeconds,
    data: ok ? json : null,
  };
}

/**
 * feishu: HTTP status is NOT trustworthy — the only success signal is
 * `body.code === 0`. Token-exchange/webhook failures often come back as
 * HTTP 200 with a nonzero code; a wrong path/method returns HTTP 404 as
 * `text/plain`, not JSON (Skillify runtime/references/errors-and-limits.md).
 */
export async function normalizeFeishuResponse(response: Response): Promise<NormalizedResult> {
  const { json, text } = await readRawBody(response);
  if (json === null) {
    // Non-JSON body (e.g. "404 page not found") — never a success.
    return {
      ok: false,
      retryable: response.status === 429 || response.status >= 500,
      httpStatus: response.status,
      platformCode: null,
      platformMessage: text.slice(0, 200),
      retryAfterSeconds: response.status === 429 ? readFeishuRetryAfter(response) : undefined,
      data: null,
    };
  }
  const body = json as { code?: number; msg?: string; [k: string]: unknown };
  const ok = body.code === 0;
  return {
    ok,
    retryable: !ok && (response.status === 429 || body.code === 99991400 || response.status >= 500),
    httpStatus: response.status,
    platformCode: body.code != null ? String(body.code) : null,
    platformMessage: body.msg ?? null,
    retryAfterSeconds: readFeishuRetryAfter(response),
    data: ok ? json : null,
  };
}

function readFeishuRetryAfter(response: Response): number | undefined {
  const reset = response.headers.get("x-ogw-ratelimit-reset");
  return reset ? Number(reset) : undefined;
}
