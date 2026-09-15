import type { ConnectedAccountDO } from "./durable-objects/ConnectedAccountDO";

export interface Env {
  DB: D1Database;
  CONNECTED_ACCOUNT: DurableObjectNamespace<ConnectedAccountDO>;
  KEK_BASE64: string;
  ADMIN_TOKEN: string;
}

export type Platform = "bigmodel-cn" | "feishu";

/** Normalized outcome of calling a platform, regardless of how each platform
 * signals success/failure on the wire (see plan: bigmodel-cn trusts HTTP
 * status, feishu only trusts body.code). */
export interface NormalizedResult {
  ok: boolean;
  retryable: boolean;
  httpStatus: number;
  platformCode: string | null;
  platformMessage: string | null;
  /** Seconds to wait before retrying, when the platform told us explicitly
   * (feishu's `x-ogw-ratelimit-reset`, bigmodel-cn's `next_flush_time`). */
  retryAfterSeconds?: number;
  data: unknown;
}

/** JSON-schema tool definition, OpenAI/Anthropic tool-calling compatible. */
export interface ToolDefinition {
  name: string;
  description: string;
  platform: Platform;
  input_schema: Record<string, unknown>;
}

export interface ActionContext {
  env: Env;
  accountId: string;
  /** Decrypted, platform-specific secret payload for this connected account. */
  secret: Record<string, unknown>;
  input: Record<string, unknown>;
}

export interface ActionDefinition {
  tool: ToolDefinition;
  execute(ctx: ActionContext): Promise<NormalizedResult>;
}
