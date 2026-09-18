/**
 * GET /llms.txt — the machine-readable counterpart to the human landing
 * page (landing.ts). Same content the "为 Agent 添加的注册入口" card on `/`
 * summarizes, but as plain text an agent can fetch and parse directly
 * instead of scraping HTML. Follows the informal llms.txt convention
 * (H1 + one-line blurb, then sections), not a spec with a validator.
 */
const TEXT = `# skillify-runtime

> Hosted credential + tool-calling gateway for AI agents. Manages third-party
> API credentials, normalizes execution across platforms, and exposes both a
> REST API and an MCP server. An agent can register itself with no human in
> the loop; see "Agent self-registration" below.

## Agent self-registration

No email or password required. Rate-limited to 5 requests/hour per source IP.

    curl -X POST https://skillify.carbonleft.com/v1/auth/agent-register \\
      -H "Content-Type: application/json" \\
      -d '{"name": "your-agent-name", "description": "what you do"}'

Returns 201 with \`{tenant_id, api_key, claimed: false}\`. The \`api_key\` is
shown once — store it. The tenant is UNCLAIMED: it has no recovery path and
should not be relied on until a human attaches real credentials to it via
the claim endpoint below. Numbers this project reports about its own usage
(tenant counts, call counts) only include claimed tenants.

## Claim (attach a human identity)

Authenticated with the tenant's own API key — proof that the caller is the
same party that registered it, not a session:

    curl -X POST https://skillify.carbonleft.com/v1/auth/claim \\
      -H "Authorization: Bearer <api_key>" \\
      -H "Content-Type: application/json" \\
      -d '{"email": "you@example.com", "password": "at-least-8-chars"}'

Converts the tenant to claimed, creates a user record, and returns a session
cookie for the web console at /console. 409 if the tenant is already claimed,
or if a claim by someone else raced and won.

## Using the platform (once you have an api_key)

- \`GET /v1/tools\` — action catalog with input schemas (no auth required).
- \`GET /v1/connected-accounts\` / \`POST /v1/connected-accounts\` — manage
  credentials for downstream platforms (Bearer <api_key> or session cookie).
- \`POST /v1/actions/execute\` — body \`{tool_name, connected_account_id, input}\`
  (Bearer <api_key> or session cookie).
- \`GET /v1/audit-log\` — every call's input/output, no credentials included.
- \`POST /mcp\` — same catalog over MCP (Streamable HTTP), \`Authorization: Bearer
  <api_key>\` header. Add to any MCP-capable client's config.

## Human signup (alternative to agent self-registration)

- \`POST /v1/auth/signup\` \`{email, password}\`
- \`POST /v1/auth/login\` \`{email, password}\`
- Auth0 (Google etc.): \`GET /v1/auth/auth0/start\`

## More

- Human-readable landing page with worked examples and known platform
  gotchas: https://skillify.carbonleft.com/
- Web console: https://skillify.carbonleft.com/console
`;

export function handleLlmsTxt(): Response {
  return new Response(TEXT, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
