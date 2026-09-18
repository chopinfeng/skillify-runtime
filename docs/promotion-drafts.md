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
- **Auth for listing purposes**: `POST /v1/auth/agent-register` — no email/password, rate-limited 5/hr/IP; returns a working API key immediately, so a reviewer or crawler can try it without an account.
- **Longer blurb** (for listings that want a paragraph):
  > skillify-runtime is a small, Composio-style hosted gateway: it stores third-party API credentials encrypted per tenant, normalizes each platform's error shape into one consistent result, and exposes the whole thing over both REST and MCP. Coverage is deliberately narrow right now (BigModel-cn, Feishu) — every action is verified against real API calls rather than auto-generated from docs, and the gotchas each platform doesn't document clearly (e.g. BigModel-cn's `tool_choice` silently downgrading, Feishu's millisecond-timestamp date fields) are handled at the gateway layer instead of being left for the caller to discover the hard way. Agents can self-register directly (`POST /v1/auth/agent-register`) without a human filling out a signup form.

## X / Twitter post draft (English — primary audience is the agent-dev community)

> Built a hosted credential + execution gateway for AI agents — think Composio, minus the sprawl.
>
> The part worth mentioning: an agent can register itself. No signup form, no human in the loop.
>
> curl -X POST https://skillify.carbonleft.com/v1/auth/agent-register
>
> Docs written for an agent to actually parse: https://skillify.carbonleft.com/llms.txt

Alt (shorter, thread-opener style):

> An AI agent can sign itself up for API credentials on this gateway with one curl call — no human, no dashboard, no waiting.
>
> https://skillify.carbonleft.com/llms.txt

## Hacker News "Show HN" draft

**Title**: Show HN: A hosted API-credential gateway that AI agents can register themselves with

**Body**:

> I built skillify-runtime, a small hosted gateway that stores third-party API credentials (encrypted, per tenant) and exposes a normalized tool-calling interface over both REST and MCP — the same idea as Composio, but intentionally narrow: two platforms (BigModel-cn, Feishu) covered in depth rather than a huge auto-generated catalog.
>
> The part I think is actually interesting: registration doesn't require a human. `POST /v1/auth/agent-register` with no auth returns a working API key immediately (rate-limited per IP). That tenant is *unclaimed* until someone attaches a real email+password via `POST /v1/auth/claim` — I added the claimed/unclaimed split specifically because Moltbook's open agent-registration reportedly ended up ~99% fake accounts; any usage numbers this project reports only count claimed tenants.
>
> There's also a `/llms.txt` with the whole flow written for an agent to parse directly, rather than expecting it to scrape the HTML landing page.
>
> Repo: https://github.com/chopinfeng/skillify-runtime
> Live: https://skillify.carbonleft.com

## Not included here (flagged, not decided)

- **License**: the repo has no LICENSE file yet. Some directories (and anyone wanting to self-host or fork) will expect one — this is a real decision about how much of the implementation you want others able to reuse, not something to default without asking.
- **Submitting a PR to the official `modelcontextprotocol/servers` list**: that repo's own contribution bar (README quality, maintenance signal) is worth a quick look before submitting, since a rejected/stale PR is more visible than not submitting at all.
