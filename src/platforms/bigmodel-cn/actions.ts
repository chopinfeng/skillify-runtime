import type { ActionContext, ActionDefinition, NormalizedResult } from "../../types";
import { normalizeBigmodelResponse } from "../../lib/errors";
import { baseUrlFor, isBigmodelSecret } from "./auth";

function badRequest(message: string): NormalizedResult {
  return { ok: false, retryable: false, httpStatus: 400, platformCode: "gateway_validation", platformMessage: message, data: null };
}

export const bigmodelChatCompletion: ActionDefinition = {
  tool: {
    name: "bigmodel_chat_completion",
    platform: "bigmodel-cn",
    description:
      "Call GLM chat completion (open.bigmodel.cn or the Coding Plan endpoint, chosen automatically by the connected account).",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string", description: "e.g. glm-4.6" },
        messages: { type: "array", items: { type: "object" } },
        tools: { type: "array", items: { type: "object" } },
        tool_choice: {
          type: "string",
          enum: ["auto"],
          description: "Only \"auto\" is supported by the platform; other values are rejected before the call is made.",
        },
        temperature: { type: "number" },
        max_tokens: { type: "number", description: "Counts against the model's own thinking tokens too — a small budget can be entirely consumed by reasoning, leaving an empty answer." },
        response_format: { type: "object", description: '{"type":"json_object"} works; {"type":"json_schema"} is silently ignored by the platform — validate the shape yourself.' },
        thinking: { type: "object", description: 'e.g. {"type":"disabled"} to turn off extended thinking.' },
        web_search: { type: "object", description: "Set {search_result:true} to get results back, otherwise the web_search array never appears." },
      },
      required: ["model", "messages"],
    },
  },
  async execute(ctx: ActionContext): Promise<NormalizedResult> {
    if (!isBigmodelSecret(ctx.secret)) return badRequest("connected account is not a bigmodel-cn credential");
    if (ctx.input.tool_choice !== undefined && ctx.input.tool_choice !== "auto") {
      return badRequest('tool_choice only accepts "auto" on this platform');
    }
    const url = `${baseUrlFor(ctx.secret)}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.secret.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ctx.input),
    });
    return normalizeBigmodelResponse(response);
  },
};

export const bigmodelActions: ActionDefinition[] = [bigmodelChatCompletion];
