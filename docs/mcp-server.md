# vibld's MCP server

docs/decisions.md D182. An assistant a person connects to vibld (Claude,
Cursor, any MCP client) can find a template, start a build, follow it and
open its preview, on that person's own account: their plan, their credit,
their projects. Since D190 it can also edit a project's code itself: read
and write its files, type-check them, take screenshots of its preview, and
go back to a checkpoint, with no build and no credit spent, within a daily
number of calls set by the plan (D201).

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
- **Two scopes:** `build` connects, and is all the five original tools
  need. The editing tools, `take_screenshot` among them, need `edit` as
  well (Chris, 2026-10-11). A call to one on a token without it is
  answered with the MCP authorization spec's step-up (2025-11-25, "Scope
  Challenge Handling"): HTTP 403 with
  `WWW-Authenticate: Bearer error="insufficient_scope", scope="build edit"`,
  before the call is counted or anything is read, so the client signs the
  person in again asking for both. Its JSON-RPC error says to connect vibld
  again and approve editing, for a client that does not step up. The 401
  that starts a connection asks for `build edit`, since some clients
  (claude.ai) ask for what it names and never follow the step-up, which
  left every editing tool refused. So the Clerk instance needs both scopes
  created (a Dashboard step, noted in `scripts/configure-accounts.mjs`),
  and every client registered before `edit` existed given it too, since
  Clerk answers a client asking for more than it registered with
  `invalid_scope` (`configure-accounts` does this on `apply`). The person
  still approves each scope. The protected resource metadata lists both in
  `scopes_supported`.
- **One door per token:** a Clerk session token does not open `/mcp`, and
  an OAuth token does not open the builder's `/api/*`. The builder's routes
  now refuse any Clerk-signed token without a session id (`principal.ts`),
  which is what OAuth access tokens and ID tokens lack.
- **The tools use the builder's own routes.** Each tool calls `/api/plan`,
  `/api/projects`, `/api/projects/:id/files`, `/api/projects/:id/checkpoints`,
  `/api/runs`, `/api/runs/:id`, `/api/preview` and `/api/templates/brief`
  as the person (`actAs`), so a build or an edit from an
  assistant is gated, priced, limited and charged exactly as one from the
  builder. An assistant gets no model policy or admin rights that are keyed
  on a verified email: it acts with the plan alone. While vibld is
  invite-only, the gate admits an assistant to an account that already
  redeemed its invite in the builder; it never redeems one itself.
- **One preview per account.** `get_preview_url`, `check_types` and
  `take_screenshot` move
  the account's preview to the requested project (or stop and restart it),
  so neither reports another project's preview as this one's.
- **Edits are checkpoints.** `write_files` sends
  `PUT /api/projects/:id/files`, which merges the files onto the accepted
  code and accepts the result as a new revision, recorded in the history
  as an `edit` (run id `edit-...`). It names the revision it was made
  against, and is refused (`checkpoint-moved`, with the current revision)
  if the project has moved on, while a build runs, and in an archived
  project, as a restore is. The project it leaves is held to the limits a
  build's base is (50 files, 160,000 characters), so it can still be built
  on.
- **Dry runs (D212).** `write_files` with `dryRun: true` sends the same
  `PUT` with `dryRun: true`, which runs every check above and writes
  nothing: no revision, no checkpoint. It answers with the draft and the
  base it was made against; the tool returns a unified line diff of each
  changed file and the draft's type check, run by moving the account's
  preview onto the draft. `check_types` and `get_preview_url` move it back.
- **Plugin:** `plugins/vibld` packages this server with two skills for
  Claude Code, Codex and Cursor, and the repository is their marketplace
  (D207). Install steps are in `plugins/vibld/README.md`.
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

The editing tools (D190), each counted against the plan's daily calls:

| Tool                 | What it does                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_files`         | A project's current files, with their sizes and the revision they are at                                                                                             |
| `read_files`         | Up to 20 files' contents, from the current code or a checkpoint; at most 100,000 characters a call                                                                   |
| `write_files`        | Writes up to 20 files and deletes up to 20 from the revision read; the result is a new checkpoint. With `dryRun`, writes nothing and returns the diff and type check |
| `check_types`        | Starts or reuses the live preview of the current code and reports its type check                                                                                     |
| `list_checkpoints`   | The project's checkpoints, newest first, and which is current                                                                                                        |
| `restore_checkpoint` | Makes a checkpoint the current code again, from the revision the list showed                                                                                         |
| `get_logs`           | The preview's state and type check, if it serves this code, and how the recent builds ended                                                                          |
| `take_screenshot`    | Starts or reuses the live preview of the current code and returns one page of it as an image                                                                         |

`start_build` makes a new project unless it is given one, so an assistant
never builds over whatever the person last had open in the builder.

`read_files` returns at most 100,000 characters a call, and a project file
may hold up to 160,000. A file that does not fit beside the others in a
call is named in `omitted`, to read in another. One that does not fit even
alone, read first, comes back in parts: the part names `nextOffset`, and
the next call names the one path with `offset` set to it.

`take_screenshot` loads a page of the preview (`path`, default `/`) in
Cloudflare Browser Rendering (`worker/screenshot.ts`, the `BROWSER`
binding) at the builder's Desktop, Tablet or Phone width (1280, 768 or
390, D192), and answers with an MCP image content block. The browser opens
the preview's own URL, the one `/api/preview` gives the account, which
carries the preview's token; the page path must stay on that origin. Each
capture is bounded: 20 seconds to load, at most 5 more for the network to
go quiet, a full page cut at 8,000 pixels tall, an image over 1.5 MB taken
again as a JPEG, and the browser closed whatever happens. Where `BROWSER`
is not bound (a self-hosted copy under Docker) the tool is not listed.

`get_logs` reports only what vibld records. A running project's server
output, runtime errors and browser console are not captured, and the tool
says so rather than answering with nothing.

## Limits on top of the plan

The plan's allowance and the ledger are the real ceiling, as for every
build. An assistant can loop where a person clicks, so `/mcp` adds:

| Limit                                | Where                    | Value                                     |
| ------------------------------------ | ------------------------ | ----------------------------------------- |
| Builds started from assistants a day | `VIBLD_MCP_DAILY_BUILDS` | 20 per account                            |
| Builds started from assistants       | `MCP_BUILD_BURST`        | 2 a minute per account                    |
| Messages                             | `MCP_BURST`              | 60 a minute per account                   |
| Messages before sign-in is checked   | `MCP_IP_BURST`           | 600 a minute per address                  |
| Calls to the editing tools a day     | `MCP_DAILY_EDIT_CALLS`   | Free 50, Build 500, Ship 2000 per account |
| File edits, from anywhere            | `EDIT_BURST`             | 30 a minute per account                   |
| Screenshots                          | `SCREENSHOT_BURST`       | 6 a minute per account                    |

Each assistant build is recorded in `mcp_builds` (migration 0052) with the
OAuth client that started it.

The editing tools cost nothing to run and are not metered (D201): the
person's assistant pays for its own tokens. What bounds them is the daily
cap, by plan, which counts every call to one of the eight, a read as much
as a write, over the last 24 hours. Screenshots are the one exception to
"cost nothing": Browser Rendering bills browser time, which
`SCREENSHOT_BURST` bounds on top of the cap. It is in `worker/entitlement.ts`, and
an admin can change a plan's under **Plans** (D134; NULL in
`plan_limits.mcp_daily_edit_calls` keeps the code's). A call takes its
place in `mcp_calls` (migration 0054) once its arguments are checked and
before it reads anything, so a malformed call costs nothing and a refused
one has read nothing; only the window's rows are kept. The refusal names
the cap and says the builder is not affected, and the five tools above are
not counted.

## Setup (once)

In the Clerk Dashboard, OAuth applications, Settings tab:
https://dashboard.clerk.com/~/oauth-applications

- **Scopes tab:** create the scope `build` (description: "Start and follow
  builds on your vibld account") and the scope `edit` (description: "Read
  and edit the files of your vibld projects"), and turn on advertising both
  in Clerk's OAuth metadata.
- **Settings tab, Client onboarding:** Client ID Metadata Documents and
  Dynamic Client Registration both on (D185), and **Default scopes for
  dynamic clients** `openid profile email build edit`. Default scopes apply
  only when a client names none, so `scripts/configure-accounts.mjs` also
  caps what such a client may request (`dynamic_client_allowed_scopes`) at
  those five plus `offline_access`. Clerk refuses both settings while `edit`
  does not exist, so create it first; the script reports the refusal and
  leaves the rest as it was.
- **Settings tab:** turn on the `aud` claim from the RFC 8707 resource
  parameter (`aud_claim_enabled`); without it no token names this server
  and every assistant is refused.
- **Settings tab, Access token format:** opaque. `/mcp` refuses JWT
  access tokens, because Clerk cannot revoke one: it would keep working
  for a day after the person disconnects the assistant.

Then deploy the web Worker (`deploy-web-preview.yml`), which applies
migrations 0052 and 0054.

`/mcp` and its metadata exist only where the Worker signs in with Clerk and
has `CLERK_SECRET_KEY` (it checks every token with it), D1 and the project
bucket; anywhere else both answer 404.

## Phases

1. **Built.** The endpoint, sign-in, the five tools, the limits, the
   Server Card (D182). Then the editing tools, their `edit` scope and
   their daily cap by plan (D190, D201), and screenshots of the preview
   with Browser Rendering (Chris, 2026-10-11).
2. **Next.** Stop a build; follow-up changes in conversation; publishing,
   only with the person's explicit confirmation in the tool call; CORS for
   browser-based clients such as the MCP Inspector; a list of connected
   assistants in the builder's settings, with a link to revoke one; the
   DNS-AID `_mcp` record (owned by the AI readiness work).
3. **Later.** Listing in the MCP Registry and assistants' connector
   directories, and a page about it on vibld.com. From D190, still to
   come: runtime and browser console logs, which nothing captures yet.
