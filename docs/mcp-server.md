# vibld's MCP server

docs/decisions.md D182. An assistant a person connects to vibld (Claude,
Cursor, any MCP client) can find a template, start a build, follow it and
open its preview, on that person's own account: their plan, their credit,
their projects.

## How it works

- **Endpoint:** `https://app.vibld.com/mcp`, served by the builder's own
  Worker (`apps/web/worker/mcp-server.ts`). MCP Streamable HTTP, stateless:
  each JSON-RPC message is one POST answered with one JSON body. No session
  is kept and the server sends nothing unasked, so `GET` and `DELETE` answer 405.
- **Sign-in:** OAuth 2.1, with Clerk (`https://clerk.vibld.com`) as the
  authorization server. A client with no token is answered 401 with a
  `WWW-Authenticate` header naming
  `https://app.vibld.com/.well-known/oauth-protected-resource/mcp` (RFC
  9728), which names Clerk. The person signs in to vibld as they always do
  and approves the assistant. Nothing here creates accounts: D180 stands.
- **Token check:** every token is checked with Clerk's Backend API
  (`mcp-auth.ts`), which says whether the person revoked it. Only opaque
  tokens are accepted, since a JWT access token cannot be revoked. A token Clerk vouched for is trusted for
  60 seconds, or until it expires if sooner. Its audience must name
  `https://app.vibld.com/mcp` (the RFC 8707 resource the client signs in
  for), and it must carry the `build` scope: a token from signing in
  to some other app with vibld (`openid`, `profile`) is answered 403
  `insufficient_scope`.
- **One door per token:** a Clerk session token does not open `/mcp`, and
  an OAuth token does not open the builder's `/api/*`. The builder's routes
  now refuse any Clerk-signed token without a session id (`principal.ts`),
  which is what OAuth access tokens and ID tokens lack.
- **The tools use the builder's own routes.** Each tool calls `/api/plan`,
  `/api/projects`, `/api/runs/:id`, `/api/preview` and
  `/api/templates/brief` as the person (`actAs`), so a build from an
  assistant is gated, priced, limited and charged exactly as one from the
  builder. An assistant gets no model policy or admin rights that are keyed
  on a verified email: it acts with the plan alone. While vibld is
  invite-only, the gate admits an assistant to an account that already
  redeemed its invite in the builder; it never redeems one itself.
- **One preview per account.** `get_preview_url` moves the account's
  preview to the requested project (or stops and restarts it), so it never
  reports another project's preview as this one's.
- **Server Card:** `https://vibld.com/.well-known/mcp/server-card.json`
  (SEP-1649), a static file in `apps/marketing/public`.

## Tools

| Tool               | What it does                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `search_templates` | The template catalog's closest designs to a description, with each one's page on vibld.com  |
| `list_projects`    | The person's projects, with their share links and published sites                           |
| `start_build`      | A build from a description, in a new project or an existing one, optionally from a template |
| `get_build_status` | Where a build is: running (and its phase), accepted, failed or stopped                      |
| `get_preview_url`  | Starts or reuses the account's live preview of a project's current code, and its URL        |

`start_build` makes a new project unless it is given one, so an assistant
never builds over whatever the person last had open in the builder.

## Limits on top of the plan

The plan's allowance and the ledger are the real ceiling, as for every
build. An assistant can loop where a person clicks, so `/mcp` adds:

| Limit                                | Where                    | Value                    |
| ------------------------------------ | ------------------------ | ------------------------ |
| Builds started from assistants a day | `VIBLD_MCP_DAILY_BUILDS` | 20 per account           |
| Builds started from assistants       | `MCP_BUILD_BURST`        | 2 a minute per account   |
| Messages                             | `MCP_BURST`              | 60 a minute per account  |
| Messages before sign-in is checked   | `MCP_IP_BURST`           | 600 a minute per address |

Each assistant build is recorded in `mcp_builds` (migration 0052) with the
OAuth client that started it.

## Setup (once)

In the Clerk Dashboard, OAuth applications, Settings tab:
https://dashboard.clerk.com/~/oauth-applications

- **Scopes tab:** create the scope `build` (description: "Start and follow
  builds on your vibld account") and turn on advertising it in Clerk's
  OAuth metadata.
- **Settings tab, Client onboarding:** Client ID Metadata Documents and
  Dynamic Client Registration both on (D185), and **Default scopes for
  dynamic clients** `openid profile email build`. Default scopes apply only
  when a client names none, so `scripts/configure-accounts.mjs` also caps
  what such a client may request (`dynamic_client_allowed_scopes`) at those
  four plus `offline_access`.
- **Settings tab:** turn on the `aud` claim from the RFC 8707 resource
  parameter (`aud_claim_enabled`); without it no token names this server
  and every assistant is refused.
- **Settings tab, Access token format:** opaque. `/mcp` refuses JWT
  access tokens, because Clerk cannot revoke one: it would keep working
  for a day after the person disconnects the assistant.

Then deploy the web Worker (`deploy-web-preview.yml`), which applies
migration 0052.

`/mcp` and its metadata exist only where the Worker signs in with Clerk and
has `CLERK_SECRET_KEY` (it checks every token with it), D1 and the project
bucket; anywhere else both answer 404.

## Phases

1. **This change.** The endpoint, sign-in, the five tools, the limits, the
   Server Card.
2. **Next.** Stop a build; follow-up changes in conversation; publishing,
   only with the person's explicit confirmation in the tool call; CORS for
   browser-based clients such as the MCP Inspector; a list of connected
   assistants in the builder's settings, with a link to revoke one; the
   DNS-AID `_mcp` record (owned by the AI readiness work).
3. **Later.** Listing in the MCP Registry and assistants' connector
   directories, and a page about it on vibld.com.
