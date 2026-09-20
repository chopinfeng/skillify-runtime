# Promotion drafts (not yet published — for review before posting)

All copy below is a draft. Nothing here has been submitted or posted anywhere;
each channel needs a separate explicit go-ahead before it goes out.

## MCP directory listing (mcp.so / Glama / Smithery / official `modelcontextprotocol/servers`)

- **Name**: skillify-runtime
- **One-line description**: Hosted credential + tool-calling gateway for AI agents — connect once, call BigModel-cn and Feishu through a single MCP endpoint or REST API. Agents can self-register with no human signup step.
- **Homepage**: https://skillify.carbonleft.com
- **MCP endpoint**: `https://skillify.carbonleft.com/mcp` (Streamable HTTP, `Authorization: Bearer <api key>`)
- **Repo**: https://github.com/chopinfeng/skillify-runtime
- **Category**: tool-calling / credential management / integration gateway
- **Auth for listing purposes**: `GET /v1/auth/pow-challenge` then `POST /v1/auth/agent-register` with the solved challenge — no email/password, gated by a proof-of-work challenge (~2s to solve) plus 5/hr/IP rate limiting; returns a working API key immediately, so a reviewer or crawler can try it without an account. Full two-step flow with a worked solving example: https://skillify.carbonleft.com/llms.txt
- **Longer blurb** (for listings that want a paragraph):
  > skillify-runtime is a small, Composio-style hosted gateway: it stores third-party API credentials encrypted per tenant, normalizes each platform's error shape into one consistent result, and exposes the whole thing over both REST and MCP. Coverage is deliberately narrow right now (BigModel-cn, Feishu) — every action is verified against real API calls rather than auto-generated from docs, and the gotchas each platform doesn't document clearly (e.g. BigModel-cn's `tool_choice` silently downgrading, Feishu's millisecond-timestamp date fields) are handled at the gateway layer instead of being left for the caller to discover the hard way. Agents can self-register directly (proof-of-work challenge + `POST /v1/auth/agent-register`) without a human filling out a signup form.

## X / Twitter post draft (English — primary audience is the agent-dev community)

> Built a hosted credential + execution gateway for AI agents — think Composio, minus the sprawl.
>
> The part worth mentioning: an agent can register itself. No signup form, no human in the loop — just a proof-of-work challenge instead of a CAPTCHA.
>
> Docs written for an agent to actually parse, worked PoW example included: https://skillify.carbonleft.com/llms.txt

Alt (shorter, thread-opener style):

> An AI agent can sign itself up for API credentials on this gateway by solving a small proof-of-work challenge — no human, no dashboard, no CAPTCHA.
>
> https://skillify.carbonleft.com/llms.txt

## Hacker News "Show HN" draft

**Title**: Show HN: A hosted API-credential gateway that AI agents can register themselves with

**Body**:

> I built skillify-runtime, a small hosted gateway that stores third-party API credentials (encrypted, per tenant) and exposes a normalized tool-calling interface over both REST and MCP — the same idea as Composio, but intentionally narrow: two platforms (BigModel-cn, Feishu) covered in depth rather than a huge auto-generated catalog.
>
> The part I think is actually interesting: registration doesn't require a human. Solve a small proof-of-work challenge (`GET /v1/auth/pow-challenge`, ~2s to solve), then `POST /v1/auth/agent-register` with the solution to get a working API key immediately — also rate-limited per IP on top of the PoW gate, since IP limits alone are trivial to route around. That tenant is *unclaimed* until someone attaches a real email+password via `POST /v1/auth/claim` — I added the claimed/unclaimed split specifically because Moltbook's open agent-registration reportedly ended up ~99% fake accounts; any usage numbers this project reports only count claimed tenants.
>
> There's also a `/llms.txt` with the whole flow written for an agent to parse directly, rather than expecting it to scrape the HTML landing page.
>
> Repo: https://github.com/chopinfeng/skillify-runtime
> Live: https://skillify.carbonleft.com

## Not included here (flagged, not decided)

- **Submitting a PR to the official `modelcontextprotocol/servers` list**: that repo's own contribution bar (README quality, maintenance signal) is worth a quick look before submitting, since a rejected/stale PR is more visible than not submitting at all.
- **OAuth 2.1 + PKCE for `/mcp`**: the MCP spec's Nov 2025 revision requires this for public remote servers; skipped for now (decided 2026-09-18) in favor of getting the MVP in front of agents first. Worth revisiting if a directory or client actually rejects the static-Bearer-key setup.
