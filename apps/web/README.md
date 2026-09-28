# @vibld/web

The Vibld builder shell: a React + TypeScript + Vite single-page application
(ADR-0005, ADR-0008) that drives a full generation lifecycle in the browser.

```bash
pnpm install
pnpm --filter @vibld/web dev        # http://localhost:5173
pnpm --filter @vibld/web build
pnpm --filter @vibld/web typecheck
pnpm --filter @vibld/web test
```

## What this slice does

`prompt → planning → staged files → validation → accepted checkpoint → preview`

The orchestration is `@vibld/core`'s, not a reimplementation: the shell wires a
`ModelProvider` into a `DurableGenerationRunner` over an
`InMemoryGenerationStore`, validates the staged snapshot, promotes the
checkpoint by compare-and-set and meters the run with `RunBudgetLedger`. To show
lifecycle progress without adding an event bus to core, `src/generation/observers.ts`
decorates the `GenerationStore` and `ModelProvider` contracts the runner already
depends on. This runs the same way for both providers -- the deterministic
fake and, since it implements the same `ModelProvider` contract, the real one
too (see "Durable generation" below for what a real `generate()` call does on
the other end of that fetch).

`BuilderSession` (`src/generation/session.ts`) is a framework-free controller;
React binds to it with `useSyncExternalStore`. An epoch guard means a run
abandoned by "Start over" or by a repeated submission can never write its result
into newer state.

## What this slice does not do

- **The default preview pane content is still a local mock.** It is static
  HTML assembled from the accepted plan and the generated stylesheet,
  rendered in a fully restricted iframe (`sandbox=""`); nothing installs
  dependencies and no generated code runs there. The Preview tab's "Run in
  sandbox" button (see "Sandbox previews" below) starts the real thing --
  the mock is what shows before that button is pressed, and for a
  model-generated project, which has no mock to build in the first place.
- **There is no model provider.** Plans come from a deterministic local
  function so CI needs no credentials (ADR-0007).
- **Console and Problems are placeholders** beyond the lifecycle log and
  validation findings. `@vibld/preview` reports install/start success or
  failure as a whole (see "Sandbox previews" below), but nothing pipes a
  running preview's live process output or build diagnostics into these
  panels yet.
- **No version history.** An account has projects now (see "Projects"
  below), each kept server-side with its conversation and settings, and every
  accepted revision is still stored in R2, but nothing in the builder browses
  or restores an earlier one.

## Hosted preview (optional)

The shell can be deployed to Cloudflare Workers static assets (ADR-0005) for a
shareable URL. It is a client-side SPA with no backend, no credentials and no
stored data, so nothing deployed here belongs to the trusted control plane.

This deploys the **builder UI**. It is _not_ the private, origin-isolated
preview ADR-0006 requires for running untrusted generated applications; that
arrives with sandbox execution (internal issue 6).

### One-time setup

Create a **`preview`** environment under **Settings → Environments**, then add
both secrets _to that environment_ rather than to the repository:

| Secret                  | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | A token with **Workers Scripts: Edit**, **D1: Edit** and **Workers R2 Storage: Edit**, nothing else |
| `CLOUDFLARE_ACCOUNT_ID` | The target Cloudflare account                                                                       |

Environment secrets are reachable only from a job that names the environment,
and any protection rule on it gates the run before a single step executes. Add
yourself as a **required reviewer** if the deploy should need approval each
time. Repository-level secrets of the same name still work as a fallback.

`Workers Scripts: Edit` cannot be scoped to one script, so the token can write
to every Worker on the account it is issued for. Issue it against a Cloudflare
account used only for Vibld to keep the blast radius to this preview.

**D1: Edit** and **Workers R2 Storage: Edit** were added alongside
`generation-store.ts`: `wrangler.jsonc` now declares `d1_databases` and
`r2_buckets` bindings, and a token that only had `Workers Scripts: Edit`
will fail the next deploy at the binding-verification step, not at runtime
-- if the existing token predates this change, it needs those two scopes
added (or reissuing) before the next deploy runs.

### Deploying

Run the **Deploy web preview** workflow from the Actions tab. It is
`workflow_dispatch` only, so it never runs on its own. The workflow fails fast
with a clear message if either secret is missing, and on success records the
deployed URL on the environment and in the run summary -- so the current preview
URL is always visible on the repository's Environments page.

The workflow applies any pending `migrations/` file against `vibld-control-plane`
(`wrangler d1 migrations apply --remote`) before it deploys the Worker --
idempotent, so a run with nothing new to apply is a no-op. This step's own
absence was a real production incident: 0002_billing.sql and
0003_publish.sql both merged and sat unapplied against the live database for
two days, and every `/api/plan` call failed with "Usage accounting is
unavailable" until it was caught and applied by hand. If a future migration
ever needs applying between deploys, run it the same way this workflow does:

```bash
pnpm dlx wrangler@4.137.0 d1 migrations apply vibld-control-plane --remote
```

To deploy from a workstation instead, authenticate wrangler yourself and run:

```bash
pnpm --filter @vibld/web build
pnpm --filter @vibld/web deploy:preview
```

The deployed Worker serves at `app.vibld.com` (a custom domain route --
`docs/decisions.md` L20; adding it disables the `workers.dev` URL for this
Worker entirely, so that address 404s once a custom domain exists). The
shell itself is gated behind sign-in now (`AuthGate` in `src/auth/clerk.tsx`,
see "Clerk authentication" below) -- a signed-out visitor sees a `<SignIn/>`
page, not the builder. That gate only works, though, because
`CLERK_FRONTEND_API_URL` is a **live** Clerk instance bound to the
`vibld.com` domain: Clerk's Frontend API refuses any request whose `Origin`
isn't `vibld.com` or a subdomain of it, so Clerk itself will not load at
all on a deployment reachable only at some other domain (a fork's own
`workers.dev` URL, for instance) -- put the whole route behind Cloudflare
Access instead if a deployment like that needs to stay gated.

## Invite-only access (the launch gate)

An open deployment lets anybody with an email address spend model budget, so
"anyone who can reach the URL can have an account" is a faucet pointed at the
provider bill unless something else limits it. An account is still created
freely (Clerk owns that) and, while the gate is closed, can do nothing until
its identity is on the invite list. What limits an open deployment is the
monthly allowance, the account-wide daily ceiling, and the welcome credit
waiting for a saved card (see "The welcome credit" under Billing below).

### Opening the beta (the flip)

Decided 2026-09-27 (docs/decisions.md): vibld launches as an open paid beta.
Everything else ships closed and ready; opening is these steps, in this
order, after the live billing check:

1. `VIBLD_ACCESS_MODE` on the **preview** environment of `vibld/vibld-internal`
   (it is an environment secret, not a `wrangler.jsonc` var):
   <https://github.com/vibld/vibld-internal/settings/environments> →
   **preview** → **Environment secrets** → `VIBLD_ACCESS_MODE` → set the
   value to exactly `open` (lowercase, no spaces). GitHub does not give the
   environment page a URL that can be written down without its numeric id,
   so the list above is the nearest link.
2. Clerk sign-up mode, which is separate and also still closed:
   <https://dashboard.clerk.com/~/user-authentication/access-mode> →
   **Public** → **Save**. Left on **Waitlist**, nobody new can create an
   account to reach the open gate.
3. Run **Deploy web preview**:
   <https://github.com/vibld/vibld-internal/actions/workflows/deploy-web-preview.yml>
   → **Run workflow**. Its "Sync the access mode" step writes the Worker
   secret; the run summary says `Access: OPEN`.
4. Run **Deploy marketing site**, so vibld.com's sign-up links go live with
   the door they lead to:
   <https://github.com/vibld/vibld-internal/actions/workflows/deploy-marketing.yml>
   → **Run workflow**.

To close it again, set the secret to anything but `open` (or delete it), put
Clerk back on **Waitlist**, and rerun step 3.

Nothing in this repository sets the value, and `test/open-beta-gate.test.ts`
fails if the Worker config or the workflow's default starts to.

`VIBLD_ACCESS_MODE` decides. **Anything other than the exact string `open` is
invite-only, including unset.** That is the opposite of the usual default and
it is deliberate: a typo cannot open the door, and a deployment that has never
considered the question is closed rather than open.

The gate runs in the router before dispatch, against a route table
(`worker/access-gate.ts`) that has to classify every path. `test/access-gate.test.ts`
reads `worker/index.ts`'s own route literals and fails on any path in neither
list, so a new endpoint that spends money cannot be added without a decision
about who may reach it. The table gates by path and, where gating every method
would trap somebody, by method: starting a sandbox or minting a public link
needs an invite, stopping one or pulling a link does not.

For browser routes, ungated never means unauthenticated: they still resolve a
principal first. Two entries are not browser routes and do not.
`/api/stripe/webhook` is authenticated by Stripe's signature over the raw body
and has no session at all, and `/api/github/callback` is a redirect target that
carries no secret and grants nothing, with the write behind `/api/github/bind`,
which is gated. Stating the rule absolutely, as this did, is how somebody comes
to apply it to a third route that deserves neither exception.

Four rules, in order, all failing closed:

1. A **platform admin** is always in, before the mode is read. The tool that
   issues invites is behind this same gate, so an operator who locked
   themselves out would have no way back.
2. An **open** deployment admits everyone.
3. An **unverified identity** is refused. An invite list keyed on email means
   nothing if the email was never verified.
4. Otherwise the list decides.

A deployment with no D1 binding refuses everybody except admins, for the same
reason: missing configuration must not become an open door.

Both refusals produce the same words. "Your email is not verified" and "you
are not on the list" are different facts about an account, and telling the
caller which applies turns the endpoint into a way to test whether an address
has been invited.

### Running the list

An admin gets an **Admin: invites** panel in the builder shell, which lists
every invite with what it currently is (waiting, in, withdrawn) and carries
the two acts that change it. That panel is the way in: without it, letting
somebody in would mean constructing an authenticated POST by hand.

**Two systems have to agree**, and the panel says so rather than implying
otherwise. Clerk is in Waitlist mode (above), so it decides whether somebody
can sign in at all; this list decides whether signing in gets them anywhere.
A row here for an address Clerk has not approved is somebody who cannot
create a session and so never reaches the gate, which is why the panel's
confirmation names the Clerk step and links to
<https://dashboard.clerk.com/~/users/waitlist> rather than reporting an
invite as access.

It is careful about what it claims, because this list is what decides who may
use the product. Issuing has three outcomes and they are reported apart: a new
invite, a withdrawn one put back, and an address already on the list where
nothing changed. A withdrawal that moved no row says so rather than reporting
success.

Underneath:

- `GET /api/access/status` -- what the shell asks to decide which screen to
  render. The endpoints are the boundary either way (ADR-0006). A failure to
  answer is not a refusal: the shell keeps the builder shut and says the check
  could not be made, with a way to try again, rather than telling an invited
  account it is on a waiting list.
- `GET /api/admin/invites` -- the list, never-used invites first.
- `POST /api/admin/invite` `{ email }` -- issue one. Re-issuing an existing
  invite does nothing and says so; reinstating a revoked one is reported as
  its own outcome rather than looking like a fresh invite.
- `POST /api/admin/invite/revoke` `{ email }` -- withdraw one. The row stays,
  so the record of what was authorised stays readable.

All four are behind the platform-admin check, not the invite gate. That
check needs an admin list and a D1 binding, and deliberately not
`CLERK_SECRET_KEY`. Requiring it everywhere meant a deployment with a good
admin list and no credit tool could not invite anybody, and said the credit
tool was missing when asked why.

`CLERK_SECRET_KEY` is optional and each route that wants it asks for itself:
the two credit routes refuse without it, and `POST /api/admin/invite` records
the invite either way and reports that Clerk was not asked. Setting it is
worth it, though, because sign-in is waitlisted in Clerk (L6) and without the
key an invite here is half the action: the row authorises somebody who still
cannot create a session, and an operator has to approve them by hand at
https://dashboard.clerk.com/~/users/waitlist. With the key set, inviting asks
Clerk to approve the address too and the panel says what Clerk answered.

### Deploying it

The deploy workflow writes `VIBLD_ACCESS_MODE` explicitly rather than leaving
it absent, so opening a deployment is a deliberate act the run records and
closing it again is possible from the same place. It comes from the
`VIBLD_ACCESS_MODE` secret on the workflow's environment; anything that is not
exactly `open` deploys invite-only, and a value that looks like it meant to
open the deployment (`OPEN`, `open `) is warned about in the run rather than
silently treated as closed.

**A closed deployment with no usable `VIBLD_PLATFORM_ADMINS` fails the
deploy**, before any secret is written. That combination admits nobody and
gives nobody the ability to issue an invite, since the only door is the admin
panel and that secret is the only key to it. It is a product that is down
while looking deployed, and it is cheaper to stop at the workflow than to
discover it from the outside.

A deployment with no `CLERK_PUBLISHABLE_KEY` fails the same check, open or
closed. `wrangler.jsonc` gives every Worker this workflow deploys a Clerk
issuer, so `resolvePrincipal` demands a bearer token on every `/api/*` route;
with no browser key the build inlines nothing, the shell renders no session,
and every request is refused for want of a token. A closed deployment also
loses the admin panel that way, but an open one is no more usable. (A deploy
with no Clerk at all is a supported shape for `pnpm dev` and for a
static-only host, neither of which is what this workflow produces.)

"Usable" is not decided by the workflow. `scripts/access-preflight.ts` makes
the whole decision and imports the Worker's own `parseAccessMode`,
`parsePlatformAdmins` and `normaliseEmail`, so the deploy and the running
product answer "is the door open", "what does this list mean" and "could this
be an address" with the same code. Written as shell it was a second
implementation of those three rules, and every time the two disagreed the
deploy was the more generous one, which is the direction that ships the
outage.

The check is its own step, before the first `wrangler secret put`, and writes
nothing. That ordering is the point rather than tidiness: a secret put
deploys a new Worker version immediately, and the admin list is among the
first secrets this job syncs, so a check that ran alongside the writes would
publish a broken list, lock out the admins who could have fixed it, and only
then fail the run.

## Model generation (optional)

The shell asks `/api/config` on load and uses whichever provider the
deployment offers: the hosted Worker when it is fully configured, the
deterministic fake otherwise. The footer names the provider that actually ran,
so the UI never implies AI when it is running the stub.

**The browser never holds a provider credential.** The key is a Worker secret,
and `@vibld/ai` is imported only from `worker/`, never from `src/` -- a build
check confirms the model SDK stays out of the client bundle (ADR-0006).

### Streaming

`/api/plan` returns a server-sent event stream, not a buffered JSON body. A
generation runs for a minute or more with no model output to forward, and a
buffered response sends nothing until it finishes -- long enough that browsers,
mobile networks and intermediate proxies abandon the connection. The failure
then surfaces as an opaque network error (Safari reports `Load failed`) rather
than anything about the generation.

The transport therefore emits keepalive comments on its own timer, independent
of model activity, starting with the first byte. The interval is configuration,
not a literal: set `VIBLD_STREAM_KEEPALIVE_MS` to override the documented
10-second default. Values outside 1–60 seconds fall back to the default.

The keepalive is cleared on success, failure and client disconnect, so a timer
cannot outlive its request.

### Fail closed

`/api/plan` and `/api/config` serve a generation only when a provider key
(`ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`), `USER_BUDGET`,
`CLERK_FRONTEND_API_URL`, `GENERATION_WORKFLOW`, `DB` and `PROJECT_CONTENT`
are **all** present. Missing configuration means refused, never open: an
unauthenticated endpoint on a public URL would let anyone spend the account's
model budget.

### Reference URL ("copy from or emulate")

`PromptPanel` offers an optional URL alongside the prompt on each request.
`handlePlan` fetches it server-side (`worker/reference-fetch.ts`) before a
Workflow is even created -- a bad or unreachable URL is refused the same way
a bad style or model choice is, before anything is billed. The page's markup
is reduced to plain visible text (scripts, styles and tags stripped, capped
at `MAX_REFERENCE_CHARS`) and placed in the prompt as material to draw on,
explicitly subordinate to the request itself (`@vibld/ai`'s
`buildUserPrompt`) -- never sent to the model as raw HTML, and never fetched
by the browser directly.

Refused before any network call is made: non-http(s) schemes, and a small
hostname denylist (loopback, link-local/cloud-metadata addresses,
`*.internal`) as defense in depth on top of what Cloudflare's own `fetch()`
already refuses to route to. The fetch itself is capped at 8 seconds and 512
KB read; a non-2xx response, a non-HTML/text content type, or a page with no
extractable text is reported back as a normal validation error rather than
silently generating without it.

The URL is scoped to the request it was submitted with -- unlike standing
instructions, it is cleared from the field once sent, so an unrelated
follow-up prompt never re-fetches a page nobody meant it for.

The Worker verifies the Clerk session JWT itself (`worker/principal.ts`,
`worker/clerk-auth.ts`) rather than trusting the browser's session cookie --
which never arrives here anyway, since the cookie is scoped to Clerk's own
Frontend API domain, not this Worker's origin. The client sends the token as
`Authorization: Bearer <token>` instead (`src/auth/clerk-token.ts`,
`src/generation/remote-provider.ts`), and ADR-0006 requires the Worker to
verify it itself regardless. Verification pins RS256 (rejecting the
`alg: none` downgrade), matches the Clerk instance's issuer, and honours
expiry with a small skew allowance.

**Cloudflare Access is off** (docs/decisions.md L5): Clerk is the only gate.

### Durable generation (docs/decisions.md L26)

A real generation's model call, staging, validation and promotion now run
inside `GenerationWorkflow` (`worker/generation-workflow.ts`), a Cloudflare
Workflow instance, against the D1/R2-backed `GenerationStore`
(`worker/generation-store.ts`) rather than in `handlePlan`'s own request
scope. `handlePlan` creates one instance per run (its id doubling as the
Workflow instance id) and polls `WorkflowInstance.status()` over the same SSE
connection it already holds open, so `remote-provider.ts`'s client contract
(`event: plan` / `event: error`) is unchanged. The run builds in the project
the builder names (`projectId` in the body), checked as the caller's first;
see "Projects" below.

Two things this costs, both accepted rather than solved here:

- **No live character progress for a real generation.** There is no channel
  between a Workflow step and the Worker polling it -- only the step's return
  value once it finishes. The stream still emits keepalives, so a long run
  reads as "still going", not as "how far along". The old in-request
  `onProgress` callback only ever existed for exactly this endpoint, so the
  fake provider (which never streamed live progress either) is unaffected.
- **Cancelling stops the _next_ step, not the current one.** `handlePlan`
  calls `WorkflowInstance.terminate()` on disconnect, but termination lands
  at a step boundary; a cancel that arrives mid-model-call cannot stop that
  one call from finishing (or being billed for). `budget.ts`'s existing
  abandoned-reservation reclaim is the backstop either way -- the same one a
  Worker dying mid-request already relied on before this change.
- **The browser still keeps its own working copy.** `BuilderSession` runs
  the lifecycle against an in-memory store and sends the revision it
  believes it is editing; the Worker reads the files from D1/R2 (internal issue 181) and
  refuses a build whose base has moved. Opening a project seeds that
  in-memory store from the server's accepted snapshot, so a reload resumes
  the project where the server has it rather than starting empty.

### Setup

1. Create a Clerk application and note its **Frontend API URL** (**Configure
   → API Keys**, e.g. `https://clerk.vibld.com`).
2. Set `CLERK_FRONTEND_API_URL` in `wrangler.jsonc`'s `vars` -- a public
   identifier, not a secret -- then redeploy.
3. Add the provider key as a Worker secret -- it must never be committed:
   `wrangler secret put ANTHROPIC_API_KEY`
4. Add `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to the `preview`
   environment. The deploy workflow's Build step inlines the publishable key
   as `VITE_CLERK_PUBLISHABLE_KEY`. `CLERK_SECRET_KEY` is not needed to verify
   a session (JWKS verification needs no secret), but Worker code does read it
   now: the two admin credit routes turn a typed email into a Clerk user id
   with it, and `POST /api/admin/invite` uses it to ask Clerk to approve the
   invited address. Leaving it unset is a supported shape and costs those
   three things, each of which says so rather than failing quietly.

Until all of that is in place the deployed shell keeps running the fake, which
is the intended safe default.

### Trying generation without a terminal

The **Try a generation** workflow in the Actions tab runs one real generation
from a prompt you type in the UI, prints the result to the run summary, and
optionally installs and builds the generated project as the ADR-0002
portability check. It needs `ANTHROPIC_API_KEY` on the `preview` environment
and spends model tokens on each run.

## Clerk authentication (the cutover -- docs/decisions.md L5)

Clerk is the only thing that gates `/api/plan` and `/api/config` now.
Cloudflare Access is off. The Clerk instance is live: Frontend API at
`https://clerk.vibld.com` (a custom domain -- its DNS record must stay
**DNS only**, not proxied, or Cloudflare intercepts it with its own "DNS
points to prohibited IP" error before Clerk ever sees the request), with
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` set on the `preview`
environment, the custom session claim configured, and **Waitlist** sign-up
mode enabled (L6) so sign-in stays restricted to approved accounts.

Two pieces, wired together:

- **Verification** (`worker/principal.ts`, `worker/clerk-auth.ts`):
  `resolvePrincipal` reads the `Authorization: Bearer` header, verifies it
  (RS256, JWKS-pinned) against `CLERK_FRONTEND_API_URL`, and returns a
  `Principal` with two identities that are **not interchangeable**:
  - `userId` -- the Clerk user id (`sub`). What `handlePlan`'s spend ledger
    and rate limiting key on (docs/decisions.md L3: "the budget ledger and
    every ownership row key on the Clerk user id. Email is display only.").
  - `policyIdentity` -- the verified email, or the shared `'unknown'` bucket
    when the email claim is missing or unverified. What `VIBLD_MODEL_POLICY`
    and `VIBLD_PLATFORM_ADMINS` (L4) are checked against instead: both
    predate Clerk, are human-edited by email address, and are not ownership
    rows.

  An email claim with no verification status attached is never treated as
  verified by default (`platform-admins.ts`'s `isPlatformAdmin` and
  `principal.ts`'s `policyIdentity` both require `emailVerified === true`) --
  that would turn a missing dashboard setting into an open grant.

- **Sign-in** (`src/auth/clerk.tsx`, `src/auth/clerk-token.ts`): `ClerkRoot`
  wraps the app in `ClerkProvider`; the header's `AuthStatus` shows a sign-in
  button or the user menu. `clerk-token.ts` is the JSX-free half --
  `getClerkToken()` (read via `window.Clerk`, since the session cookie is
  scoped to Clerk's own domain and never reaches this Worker's origin on its
  own) and `onClerkSessionChange()` (so `useBuilderSession.ts` re-probes
  `/api/config` the moment someone signs in through the modal, rather than
  requiring a reload) -- kept apart from `clerk.tsx`'s JSX specifically so
  `node --test --experimental-strip-types` (which strips types but not JSX)
  can still import it.

Both gracefully no-op if `VITE_CLERK_PUBLISHABLE_KEY` is ever unset
(`ClerkRoot` renders its children unwrapped; `AuthStatus` renders nothing;
`getClerkToken()` returns `null`) -- but since Access is off, an unset key on
a live deployment now means generation is unreachable, not merely
unauthenticated, which is the fail-closed behaviour `isConfigured` in
`worker/index.ts` requires.

**Manual setup steps (one-time, dashboard-only):**

- **Remove the Cloudflare Access application** that used to gate this
  Worker's route: <https://one.dash.cloudflare.com/> → **Access →
  Applications** → find the one protecting `vibld-web-preview` (or wherever
  the builder is routed) → delete it. Leaving it in place means Access still
  intercepts every request before Clerk is ever reached, regardless of what
  the Worker's own code does -- Access was always a second, independent gate
  at the edge, not something this repository's deploy can remove on its own.
- **Waitlist mode**: `https://dashboard.clerk.com/~/user-authentication/access-mode`
  → **Waitlist** → **Save** (done). Approve or deny requests at
  `https://dashboard.clerk.com/~/users/waitlist`.
- `VIBLD_PLATFORM_ADMINS` (comma-separated verified emails) is set on the
  deployment -- see "Admin: manual credit grants" below for its first
  consumer.
- `VIBLD_SIGNUP_CREDIT_FROM` decides who is offered the welcome credit (paid
  once they save a card; see "The welcome credit" under Billing), and
  **nobody gets it until this is set.** It names the instant the offer
  starts, as a full ISO instant with a timezone (`2026-09-13T00:00:00Z`);
  accounts created at or after it are in the cohort, and everyone else is
  not. Set it on the `preview` environment at
  https://github.com/vibld/vibld/settings/environments and the deploy
  workflow syncs it to the Worker, refusing the deploy if the value is not
  a real ISO instant rather than letting it look configured and grant
  nothing.

  There is deliberately no default. Any cutoff early enough to catch
  genuinely new accounts also catches every account that already exists, so
  a default would quietly pay the entire existing user base on the first
  request after deploy. `VIBLD_SIGNUP_CREDIT_USD_CENTS` sets the amount
  (default 100); `0` turns the grant off without touching the cutoff.

### Abuse controls required before Access came off (docs/decisions.md L29)

Access is off; sign-up is open to anyone (subject to Waitlist approval).
L29 named five controls that had to ship first -- audited directly, not
assumed, once that was true:

1. **Turnstile on sign-up** -- Clerk's own, not something this repo builds:
   confirmed via Clerk's `/v1/environment` (`display_config.captcha_provider:
"turnstile"`, `user_settings.sign_up.captcha_enabled: true`).
2. **Per-IP rate limit** -- `IP_BURST` (`wrangler.jsonc`), checked in
   `handlePlan` before `resolvePrincipal` is ever called. `PLAN_BURST`/
   `PLAN_SUSTAINED` key on the Clerk user id, so they do nothing for a flood
   of requests that never resolves to a valid one -- this is the layer that
   does. Not literally a Cloudflare WAF rule (that needs zone permissions
   this deployment's token doesn't have -- see "Deploying" above); the same
   Workers Rate Limiting mechanism, keyed by `CF-Connecting-IP` instead.
3. **Disposable-domain blocking** -- also Clerk's own: confirmed via the
   same environment response
   (`user_settings.restrictions.block_disposable_email_domains.enabled:
true`).
4. **Per-user ceiling** -- `reserveBudget`'s tier allowance, documented
   above (L36-L39).
5. **Account-wide daily ceiling** -- `VIBLD_ACCOUNT_DAILY_MICRO_USD`,
   documented above (L29).

## Sandbox previews (docs/decisions.md L7-L11)

`/api/preview` runs the caller's own project for real -- `npm install`, then
a live dev server -- in a genuinely untrusted, time-boxed container, and
returns a URL to view it. All of the actual work (the container, egress
lockdown, concurrency, lifetime, sharing) lives in `@vibld/preview`, a
separate Worker; see that package's README for why, and for the full
sharing design (L10). This app's own `worker/preview-client.ts` is a thin,
authenticated forwarder: it resolves the caller's Clerk principal, then
calls `@vibld/preview` over a service binding, trusting nothing the browser
could have supplied itself.

- `POST /api/preview` -- body `{ "files": [{ "path", "content" }, ...] }`
  (the same shape `/api/plan`'s `base` already uses). Starts a preview, or
  reports queued/in-progress if the caller already has one running.
- `GET /api/preview` -- polls the current preview's status. Never starts or
  enqueues anything; safe to call as often as needed.
- `DELETE /api/preview` -- stops the caller's preview early. Idempotent.

Every response is one of: `{status: "queued", position}`,
`{status: "ready-to-start"}` (a slot freed while queued -- call `POST`
again with the files to actually start), `{status: "installing" | "starting"}`,
`{status: "ready", url, expiresAt}`, or `{status: "failed", error}`.

`/api/preview` answers `503` when `PREVIEW` or `PREVIEW_INTERNAL_SECRET` is
unset -- unavailable, never open, the same rule `isConfigured` already
applies to `/api/plan`.

- `POST /api/preview/share` -- no body. Mints a new share link (L10) for
  the caller's currently-running preview; `409` if nothing is running to
  share. Returns `{ shareId, expiresAt, url }`.
- `GET /api/preview/share` -- every grant ever issued for the caller's
  preview, active or not: `{ shares: [{ shareId, createdAt, expiresAt,
revoked, url? }, ...] }`. `url` is present only for a still-active grant.
- `DELETE /api/preview/share` -- body `{ "shareId" }`. Revokes one grant,
  independently of the preview it points at and of any other grant.
  Idempotent.

### In the builder shell

The Preview tab's "Run live preview" button calls `/api/preview` with the
accepted checkpoint's files
(`src/generation/preview-client.ts`, the browser-side mirror of
`worker/preview-client.ts`'s `PreviewStatus` union and its defensive
parsing) and polls until the sandbox settles, then swaps the local mock for
a real `<iframe src>` pointed at the returned URL. "Stop" ends it early;
the tab shows a `live` badge while a sandbox is running, since it keeps
running even while another tab is in view.

The polling state lives in `Workspace.tsx` (`generation/use-preview-sandbox.ts`'s
`usePreviewSandbox`), one level above `PreviewPanel`, not inside
`PreviewPanel` itself: `Workspace` renders `PreviewPanel` only while the
Preview tab is active, so state scoped to `PreviewPanel` would be torn
down -- along with the poll loop -- every time the user switched to Code or
Console and back, silently orphaning a sandbox that was still running.

Once a sandbox is `ready`, the panel also shows a **Share** section
(`PreviewPanel.tsx`'s `SharePanel`): a "Share" button (`usePreviewSandbox`'s
same hook, extended with `shares`/`share`/`revokeShare`), a list of every
currently-active link with a "Revoke" button of its own, and a standing
warning that anyone with a link can view the running app and everything it
shows -- ADR-0006 requires that warning be part of the flow, not a tooltip
nobody opens. Shares are cleared from view (not revoked -- just no longer
this session's to show) the moment the sandbox itself stops or fails, since
a share only ever makes sense against a preview that is actually running.

### The draft preview (resolved 2026-09-28)

While a project's first build runs, the Preview tab shows a static draft of
the page instead of "Nothing to preview yet", labelled "Draft, building the
real site", with the build's stage (`LifecycleBar`) and progress
(`ProgressMeter`) laid over its foot. `BuilderSession` holds it as
`state.draft`; `PreviewPanel` renders it through `DraftPreview.tsx` and
`MockupFrame.tsx`, the same `sandbox=""` frame and `mockupFrameDocument`
content policy Explore's tiles use, so the draft cannot touch the builder.

- **Which draft.** The direction picked in Explore, when there is one: it
  is already in hand and is what the build was asked to follow. Otherwise
  the session asks `/api/mockups` for one quick draft (`"draft": true`: one
  direction instead of three, through the same route, rate-limit bucket,
  reservation, ceiling and settlement as a look). The Worker draws it on
  `DRAFT_MODEL` (DeepSeek Flash) whatever the build runs on, where the
  model policy grants it, and on the build's model otherwise
  (`draftModelFor` in `worker/model-access.ts`). It asks only after the
  build's first progress event, which `/api/plan` sends once the build's
  own reservation is held, so the draft can never take the in-flight slot
  the build needed. A draft that fails is dropped silently; one still being
  drawn when the build ends is aborted, which stops what it spends.
- **After the build.** The draft stays, labelled "Draft, the real site is
  built", with "Run live preview" (or the sandbox's start-up status) over
  it, until the live preview is running; then the pane shows the live
  preview as it always has. `Workspace` remembers that the live preview has
  run, so stopping it afterwards does not bring the sketch back. A failed
  or cancelled build drops the draft, and a sandbox that fails to start
  shows its failure as before.
- **Follow-ups** (a project with an accepted checkpoint) show no draft and
  ask for none: the current preview or code stays on screen.
- **Not saved.** The draft is neither a setting nor a turn, so the autosave
  never sends it, and reopening the project does not bring it back.
- **Fake mode** asks for no draft, since `/api/mockups` cannot answer a
  deployment without model generation; the pane behaves as before.

### Setup

1. Deploy `@vibld/preview` first (see its own README) -- apps/web's service
   binding only routes successfully once `vibld-preview` exists.
2. Add `PREVIEW_INTERNAL_SECRET` (a long random value) to the `preview`
   environment here, the same value used when deploying `@vibld/preview`.
   The **Deploy web preview** workflow syncs it to this Worker.

## Cloudflare auto-publish (ADR-0010, docs/decisions.md L40)

`POST /api/publish` -- body `{ "files": [{ "path", "content" }, ...],
"slug"?, "projectId"? }` (the same file shape `/api/preview` already
takes). Builds the project for real (`@vibld/preview`'s `buildProject`,
over the same service binding `/api/preview` uses) and, if that succeeds,
publishes the result as **that project's** site (`@vibld/publish`'s
`/internal/publish`, a second Worker -- see `apps/publish/README.md`).
`slug` is required on a project's first publish and optional after (the
existing slug is reused). Returns `{ slug, url, skipped }` on success --
`skipped` lists any binary asset paths the build produced that could not be
published yet (see `apps/publish/README.md`'s own text-only limitation).
Answers `503` when any of `PREVIEW`, `PREVIEW_INTERNAL_SECRET`, `PUBLISH` or
`PUBLISH_INTERNAL_SECRET` is unset, the same fail-closed rule
`isConfigured` already applies to `/api/plan`.

**One site per project** (resolved 2026-09-28). `projectId` names the
project, which has to be the caller's (404 otherwise) and not archived
(409); it is checked before anything is built. The publish service keys a
site by project (`published_projects.project_id`, unique), so publishing
one project can only ever claim or replace that project's own site, and a
slug is still unique across every site there is. A request with no
`projectId` comes from a builder older than this and publishes to the site
it always did, the account's first project's (below); if the account no
longer has that project it is refused and asked to reload. Every site
published before this was keyed by its owner's user id, which is the id of
the project `0033_projects.sql` made from that owner's work, so that project
finds its site at the same slug and nothing moves;
`0035_site_per_project.sql` gives a project to any site that had none, so
every site has one its owner can reach. A project's view
(`GET /api/projects/:id` and the list) carries its site as
`site: { slug, state, url }`, `state` being `live`, `down` or `held` as the
publish service reads it.

Gated by its own `PUBLISH_BURST` rate limit, keyed on the caller's Clerk
user id (checked after identity, unlike `IP_BURST`) -- publishing runs a
real sandbox build and a real R2 write, priced per caller rather than per
flood, so it does not ride `PLAN_BURST`'s ceiling.

`DELETE /api/publish` -- authenticated, body `{ "projectId" }`. Takes that
project's published site off the web (ADR-0013). There is no build step. The
project has to be the caller's; an archived one's site can still be taken
down, because taking something off the web is never refused. With no body
(an older builder) it takes down the account's first project's site, as it
always did. Shares `PUBLISH_BURST` with the POST, and answers `503` under the
same fail-closed rule. Returns `{ slug }`; a `403` means the project belongs
to somebody else and a `404` means it was never published.

**Deleting a project takes its site down first**, through this same
takedown with the owner present, and the project is not deleted while its
site is still serving: if the takedown fails the delete is refused with 409
and nothing is removed. A site that is held or already down does not stand
in the way. **Deleting the account takes every site down**: the takedown the
deletion request makes goes through each project whose site is live, and the
deletion's `sites` step is done only once none of them is serving. The slug
is never released in either case.

The two verbs share a path and are told apart by method, deliberately: a
link, an image, a prefetch and a form can all issue a `GET` or a `POST`,
and none of them can issue a `DELETE`.

The name is not released by a takedown. `apps/publish/README.md`'s "Taking
a site down" has the reasoning; the short version is that somebody has
linked to the address, and handing it to the next claimant would serve
their content where the previous owner sent people.

### In the builder shell

The Code tab's `PublishButton` (next to `ExportButton`, both keyed on
`state.acceptedSnapshot`) calls `/api/publish`
(`src/generation/publish-client.ts`, the browser-side mirror of
`worker/publish-client.ts`).

**Two presses, not one** (ADR-0013). The first raises a sentence naming the
slug, the checkpoint by revision, and whether this replaces something
already live; the second is the act. Taking the site down works the same
way and names what stops working. These are the only controls in the
builder whose result a stranger can see, which is what earns the extra
press; a generic "are you sure" would not.

The button is per project: it names the open project on every publish and
takedown, and starts from that project's site as the project was opened
with it, so a returning visitor is not asked for a slug the project already
has, "Take it down" is there whenever the site is live, a site its owner
took down offers "Publish again", and a site an operator holds says so and
offers nothing. A slug is required on a project's first publish. On success,
shows the live URL (and which binary asset paths, if any, were skipped); on
failure, the error inline.

**Not built yet:** the opt-in custom-domain step ADR-0010 describes, and
rolling back to a _previous_ published checkpoint rather than taking the
site down (it needs the retention decision ADR-0013 left open).

### Setup

1. Deploy `@vibld/preview` (above) and `@vibld/publish` (see its own
   README) first -- this Worker's two service bindings only route
   successfully once both exist.
2. Add `PUBLISH_INTERNAL_SECRET` (a long random value, distinct from
   `PREVIEW_INTERNAL_SECRET`) to the `preview` environment here, the same
   value used when deploying `@vibld/publish`.

## Billing (docs/decisions.md L12-L15)

Stripe-hosted Checkout and Billing Portal (L12): card data never reaches
this Worker, only a redirect URL does. Stripe webhooks mirror subscription
state into D1 (L13); the app reads that copy, not Stripe, on every request
that needs it. Vibld owns the Clerk-user-id-to-Stripe-customer mapping
(L14) via `client_reference_id` and customer metadata -- not Clerk Billing.
Stripe Tax is off (L15, confirmed 2026-09-27): no Checkout Session sets
`automatic_tax`, and none collects a tax id or a billing address for it.
`test/billing-checkout.test.ts` fails if a plan, top-up or card-setup session
asks for any of them.

The five prices this deployment sells (L36/L38: Build $29/mo or $290/yr,
Ship $99/mo or $990/yr, Top-up $20 one-time) already exist in the live
Stripe account, referenced here by `lookup_key` (`stripe-client.ts`'s
`PRICE_LOOKUP_KEYS`) rather than by id -- correcting a price in the Stripe
Dashboard needs no code change, only the amount to change.

- `GET /api/billing/status` -- authenticated, no body. Returns the caller's
  own tier, this period's spend against their allowance, remaining top-up
  credit, whether a Stripe customer exists yet for them, and where they
  stand with the welcome credit (`signupCredit`; see "The welcome credit"
  and "Billing UI in the builder shell" below).
- `POST /api/billing/checkout` -- body `{ "tier": "build" | "ship", "interval": "monthly" | "annual" }`
  or `{ "topup": true }`. Authenticated the same way `/api/plan` is; returns
  `{ url }`, the Checkout Session to redirect the browser to.
- `POST /api/billing/portal` -- authenticated, no body. Returns `{ url }` for
  the Stripe-hosted Billing Portal, where a customer manages or cancels
  their own subscription.
- `POST /api/billing/cancel` -- authenticated, no body, open to the same
  callers as the portal. Returns `{ url }` for a Billing Portal session
  that opens straight on cancelling the caller's subscription
  (`billing-checkout.ts`'s `createCancelSession`), and answers an account
  with no subscription the way the portal answers one with no customer
  (502). **A monthly plan is offered 50% off one month, once, before it
  cancels; an annual plan is offered nothing** (docs/decisions.md,
  2026-09-28). The offer is coupon `vibld-retention-50-1mo`
  (`stripe-client.ts`'s `RETENTION_COUPON_ID`), attached only when the
  subscription's price, read from Stripe, has a monthly lookup key and
  bills by the month. It is decided here and not in the portal's own
  settings because Stripe keeps a tier's monthly and annual prices on one
  product, so neither the portal's retention setting nor the coupon can
  tell them apart; that setting stays empty. If Stripe refuses the coupon
  (it has not been created yet, say), the flow opens without the offer
  and the refusal is logged, so nobody is kept from cancelling. A
  subscription already set to end is sent to the plain portal instead.
- `POST /api/billing/card` -- authenticated, gated, no body. Returns `{ url }`
  for a Stripe Checkout Session in `setup` mode, which saves a card and
  charges nothing. Answers 409 unless the caller is offered the welcome
  credit.
- `POST /api/stripe/webhook` -- Stripe's own POST, not a browser's. No Clerk
  session exists to check; the `Stripe-Signature` header, verified against
  the raw body before anything is parsed (L30), is the entire
  authentication. Subscribed events: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded` / `.async_payment_failed`,
  `customer.subscription.created` / `.updated` / `.deleted`, `invoice.paid`,
  `invoice.payment_failed` (the last is acknowledged but not separately
  mirrored -- `customer.subscription.updated` already carries the status
  change it implies), `charge.refunded`, `charge.dispute.closed` and
  `setup_intent.succeeded`.

  **`setup_intent.succeeded` pays the welcome credit** (see below), and so
  does a `checkout.session.completed` in `setup` mode. Either one alone is
  enough, and both arriving pays once. It is on the list so a saved card is
  still paid if the Checkout event is ever dropped from the endpoint.

  **The endpoint's events are kept complete by the Configure Stripe and
  Clerk workflow** (see "Setup" below), which adds any of these the
  endpoint for `https://app.vibld.com/api/stripe/webhook` is missing and
  never removes one. Its list is `scripts/configure-accounts.mjs`'s
  `REQUIRED_WEBHOOK_EVENTS`, and its test fails if that list drifts from
  the `case`s `billing-events.ts` handles or from the nightly replay's.

  **`charge.refunded` and `charge.dispute.closed` matter most, or refunds
  only ever reach this deployment through the nightly replay.** They are
  what takes a referral reward back when the payment that funded it goes
  out again, and an endpoint configured from an older copy of this list
  will never deliver either.
  `charge.dispute.closed` is acted on only when the dispute was lost: a won
  dispute means the money stayed. Both also take back the credit or plan
  the payment bought; see "Refunds and disputes" below.

  **A refund takes a reward back only when it is demonstrably the payment
  that earned it.** The ids a payment can be recognised by are recorded on
  the attribution when the payout settles (`funded_by`), and the refunded
  charge has to name one of them. A refund that names none of them, which
  includes every reward paid before this was recorded, leaves the reward
  standing and writes one line:

  ```
  {"event":"referral.reversal_unmatched","referredUserId":...,
   "refundedIds":[...],"knownFunding":[...]}
  ```

  Visible in `wrangler tail` and in this Worker's logs at
  <https://dash.cloudflare.com/?to=/:account/workers/services/view/vibld-web-preview/production/logs>
  (`vibld-web-preview` is the deployed service name, from `wrangler.jsonc`).
  The direction is deliberate: refunding an unrelated later top-up must not
  take back a reward the original purchase still funds, so an unprovable
  match costs the abuse case rather than taking credit from somebody
  wrongly.

  `invoice.paid` **is** acted on now: it carries `amount_paid`, so it is the
  event that says how much money moved, and it is the only one that
  announces a purchase. `customer.subscription.*` deliberately does not. A
  status is not a charge: a subscription covered in full by a coupon, or one
  whose first invoice is zero, reads `active` having taken nothing, and
  announcing on that paid a referral for free.

  The two `async_payment_*` events matter for delayed payment methods, where
  `checkout.session.completed` arrives with `payment_status: unpaid` and the
  money settles later or not at all. A top-up is recorded, and a referral paid,
  only for a session that is actually settled, so without the success event
  subscribed those purchases never get their credit. Nothing needs handling for
  the failure case: nothing was granted.

- A nightly Cron Trigger (`wrangler.jsonc`'s `triggers.crons`) re-reads every
  mirrored subscription from Stripe and corrects any drift a missed or
  failed webhook delivery left behind (L13). It also finishes referral
  payouts the webhook path could not: every attribution that claimed a cap
  slot and was never paid is retried, and every active subscriber is offered
  the (idempotent) payout, so a delivery that was missed outright or whose
  retries ran out is still recovered.

  What counts as owed is "this account has a cleared payment and no payout",
  not "this attribution holds a cap reservation". The reservation reading
  excluded the rows the sweep exists for: a payout that failed before taking
  its slot leaves nothing to find.

  A cleared payment is a row in `billing_payments`, keyed on the Stripe
  object that settled and carrying what it took, with a positive amount.
  Both halves matter. It is not hung off the subscription row, because
  `invoice.paid` can arrive before `customer.subscription.created` and an
  UPDATE against a row that does not exist yet changes nothing and reports
  nothing. And it requires an amount, because `no_payment_required`
  Checkouts, zero-amount invoices and trialing subscriptions are all settled
  states that took no money, and each one was a way to earn referral credit
  without ever being charged. `CLEARED_PAYMENT_SQL` (`worker/purchase-barrier.ts`)
  is the one place that decides, and it sits beside the barrier predicate it
  must not be confused with.

  The nightly reconcile offers the payout on that recorded answer rather
  than on a subscription's status, for every subscription rather than only
  the active ones: a subscriber who paid once and then cancelled reads
  `canceled` for ever, and reading status was how the sweep came to skip
  them.

  For a subscriber with no recorded payment, the reconcile asks Stripe once
  for their most recent paid invoice and records what it collected. That is
  the case reading subscription status used to get right and requiring a
  local row would otherwise lose: somebody who really is paying whose
  `invoice.paid` was never delivered. One request, no pagination, nothing
  persisted between runs.

  **It is deliberately not a full audit, and two gaps follow from that.** A
  subscriber whose most recent paid invoice collected nothing (a fully
  discounted month) but who paid before it is not recovered. Neither is a
  top-up whose `checkout.session.completed` was never delivered, since a
  Checkout leaves no local trace to start from.

  Closing those means reading each account's history back from Stripe, and
  that could not be made to work inside a scheduled run: the history grows
  without bound, the run has a fixed budget, and each bound placed on it
  turned "never finishes" into "stops early and reports success". Doing it
  properly needs a resumable cursor, a request budget and an explicit
  incomplete result, which is its own piece of work rather than a few lines
  here.

  The reconcile asks Stripe which subscriptions exist rather than only
  re-reading the ones already mirrored. A subscriber whose very first
  `customer.subscription.created` delivery was missed has no local row at all,
  and a subscription-mode `checkout.session.completed` only links the
  customer, so iterating the mirror alone would never reach them. The sweep
  over stranded payouts stamps each attempt before it runs and orders by that
  stamp, so a row that fails every night moves to the back of the queue
  instead of holding the front of it and starving every newer one.

  **The reconcile is bounded like the rest of the pass, and resumable**
  (internal PR 47, `0017_reconcile_cursor.sql`). It used to walk every subscription on
  every run with nothing bounding it, in an invocation whose D1 allowance
  three other phases had already drawn on. At roughly ten queries a
  subscription that exceeds the invocation somewhere past a hundred of them:
  D1 throws, `scheduled`'s own `.catch` turns the throw into a log line, and
  the reconcile simply stops happening -- drift uncorrected, missed payouts
  unrecovered, silently, every night after.

  It now takes a quarter of the allowance like the parked queue and the
  payout resume do, and walks the subscription ids in sorted order from where
  the last run stopped. Reaching the end clears the cursor, so the walk laps:
  every subscription is visited within one lap however many nights that
  takes. The result carries `remaining`, which is what keeps a deployment
  whose share never covers its list visible in the logs rather than silent --
  the "stops early and reports success" failure `0009_event_replay.sql` was
  written from, three times over.

### Refunds and disputes (resolved 2026-09-28)

A refund or a lost dispute takes back what the payment bought, as well as
any referral reward it funded (`clawBackPurchase` in
`worker/billing-events.ts`, `migrations/0032_payment_clawbacks.sql`). The
events are the two the webhook already receives, `charge.refunded` and
`charge.dispute.closed`; no new event type is needed. Both have to be ticked
on the endpoint at <https://dashboard.stripe.com/workbench/webhooks>, or a
refund reaches this deployment only through the nightly replay.
`charge.dispute.created` is not subscribed and removes nothing: only a lost
dispute took the money.

The charge is tied to the payment it paid for through the ids recorded when
that payment settled (`billing_payments`, its key and `aliases`), among the
charge customer's own payments only. On the current Stripe API a
subscription charge and its `invoice.paid` share no id, so when nothing
matches the Worker asks Stripe once which invoice the charge's payment
intent paid (`invoicePayments.list`) and matches that invoice instead.

| What happened                            | What is removed                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top-up refunded, in full or in part      | The refunded share of its $8 credit, floored at what the account has not spent. The rest is recorded as a shortfall and never collected.                                          |
| Subscription payment refunded, in full   | The subscription: its allowance stops at once in D1, and it is cancelled in Stripe with no final invoice and no proration.                                                        |
| Subscription payment refunded, in part   | The same. A partial refund is how an operator processes an annual plan's prorated cancellation, so it is treated as that cancellation.                                            |
| Dispute lost, on either                  | The same as a full refund of that payment, and the account is suspended: `/api/plan`, `/api/mockups` and `/api/chat` refuse it as `account-suspended` until an operator lifts it. |
| Dispute won, withdrawn, or merely opened | Nothing.                                                                                                                                                                          |

**Any refund of a subscription invoice ends that subscription**, including
one issued as goodwill or for a charge made in error. That follows from the
decision and is stated so nobody issues one expecting the plan to continue:
to compensate a subscriber and keep the plan, grant credit from the admin
panel instead.

Every effect is one row in `billing_clawbacks`: what went back out, the
payment it was tied to, the credit removed and any shortfall, the
subscription ended, and whether it suspended the account. The admin panel's
user lookup lists them, and offers **Lift suspension** for a suspended
account (`POST /api/admin/suspension/lift` `{ email }`). Lifting restores
paid features only; credit or a plan that was removed comes back only by a
grant or a new purchase.

Idempotency is the row id: `refund:<charge>:<cumulative amount refunded>`
for a refund and `dispute:<dispute>` for a dispute, so a redelivery, the
nightly replay and the parked retry all land on the same row. Credit owed
is computed from Stripe's running refunded total inside the one statement
that writes the row, so two partial refunds add up to exactly the share
they refunded and an older refund replayed late owes nothing. Cancelling in
Stripe is asked on every application and answers `already-ended` for a
subscription that is over.

A reversal that cannot be done in full answers `unresolved`, exactly like
an unattributed payment: the webhook delivery fails so Stripe retries it,
and the nightly replay parks it for the nightly retry. That happens for a charge that matches no
recorded payment (the replay can read a refund before the purchase it
refunds), Stripe not answering, or the spend ledger not answering. Nothing
is removed on a guess, and a parked reversal shows in the admin panel's
parked queue.

Things this does not do: a refund that later fails in Stripe does not
restore anything, and a refund of a charge made outside this product stays
parked for an operator to look at.

### Provider balance alerts (docs/decisions.md L44)

The same nightly Cron Trigger also runs `worker/provider-balance.ts`'s
`checkProviderBalances` -- one "daily" schedule, not two. Only **DeepSeek**
is actually checked: its `/user/balance` endpoint uses the same
`DEEPSEEK_API_KEY` this deployment already holds for generation, no
separate credential. **Anthropic has no public balance-check API** outside
the Console as of this writing -- reading its spend programmatically needs
an Admin API key (the Usage and Cost Admin API), a distinct, more
privileged credential from the plain key used for generation. That gap is
real and recorded here rather than silently skipped.

Below `VIBLD_DEEPSEEK_BALANCE_ALERT_USD` (default $10), an alert is sent
through Resend to `VIBLD_ALERT_EMAIL` (default `billing@vibld.com`) from
`VIBLD_ALERT_FROM` (default `alerts@notifications.vibld.com`, the
transactional domain L17 already reserves). Additive like every other
optional secret here: unset `RESEND_API_KEY` means the check still runs and
logs, it just cannot send. To turn alerts on, add `RESEND_API_KEY` (the
same key apps/marketing already uses -- Cloudflare Secrets are per-Worker,
so it has to be added here too) to the `preview` environment; the deploy
workflow syncs it the same way it already syncs every other optional
secret on this page. Actually sending also needs `notifications.vibld.com`
verified in Resend -- apps/marketing's own README already tracks that as
outstanding under its "Manual setup steps".

### What a tier actually buys (docs/decisions.md L35-L39)

`/api/plan`'s own spend gate (`worker/index.ts`'s `reserveBudget`) reads the
caller's mirrored subscription (`worker/entitlement.ts`'s `tierFor`) and
ceilings each run against three layers, in order:

1. **The account-wide daily ceiling** (L29) -- unchanged, still a UTC day.
2. **The caller's own monthly tier allowance** (L36): Free $1/mo, Build
   $10/mo, Ship $40/mo, resetting on the UTC calendar month.
3. **Top-up credit** (L37), tried only once the monthly allowance is
   genuinely exhausted, not merely low. A top-up is not period-scoped --
   it persists until spent, tracked as its own `USER_BUDGET` instance keyed
   `"<userId>:topup"` rather than a separate table, so the ceiling for that
   instance (the caller's lifetime top-up total, from
   `BillingStore.totalTopupCreditMicroUsd`) less what has been spent from it
   _is_ the remaining balance -- the same mechanism that already enforces
   every other ceiling here, reused rather than reimplemented.

A caller with no active subscription is Free. A denied `SpendVerdict`'s own
reason is `period-ceiling` now, not `daily-ceiling` -- it covers both the
account's daily layer and a tier's monthly one, whichever fires.

Two deliberate simplifications, both documented at their own definitions
rather than repeated here: the monthly reset is the calendar month for
everyone, not each subscription's own billing-cycle anchor
(`entitlement.ts`'s `allowancePeriodKey`); and a top-up's 12-month expiry
(L36) is approximated by excluding old purchases from the running total
outright, not by tracking each purchase's own expiry against what was
actually drawn from it first (`BillingStore.totalTopupCreditMicroUsd`).

### The welcome credit (card first, 2026-09-27)

A new account can get a one-time credit (`VIBLD_SIGNUP_CREDIT_USD_CENTS`,
default $1.00) once it has a card on file. It used to arrive with the
account; with sign-up open to anybody that is a dollar per email address,
so it now waits for a card, saved through a Stripe Checkout Session in
`setup` mode that charges nothing.

End to end:

1. `GET /api/billing/status` decides whether the caller is offered it
   (`signupCreditStatus`, `worker/signup-credit.ts`): allowed through the
   access gate, created on or after `VIBLD_SIGNUP_CREDIT_FROM` (Clerk is asked
   once), and not already holding a `signup:<user id>` grant. A yes is
   remembered as a row in `billing_signup_offers`; a no from the cohort, as the
   zero-cent marker it always was.
2. The builder shows "Add a card to get $1 of free build credit. You won't
   be charged." above the composer and under **Plan and usage**, with an
   **Add a card** button. That calls `POST /api/billing/card`, which creates
   the setup-mode session with `vibld_purpose: signup_credit` and the user id
   on both the session and its SetupIntent, card only.
3. Stripe reports the saved card twice, as `checkout.session.completed`
   (mode `setup`) and `setup_intent.succeeded`. Each is verified by the same
   signature check as every other event, then `billing-events.ts` re-reads
   the SetupIntent with its PaymentMethod expanded to get the card's
   `fingerprint`, and `BillingStore.claimSignupCardCredit` pays it.
4. The limits live in `billing_signup_cards`
   (`migrations/0029_card_first_signup_credit.sql`), keyed on the SetupIntent
   id: a partial unique index on `card_fingerprint` and another on `user_id`,
   both over rows whose outcome is `granted`. One card pays one account,
   and one account is paid once, whichever card and however the deliveries
   race. The payment itself is a `billing_admin_credits` row under the same
   `signup:<user id>` id as ever, so redeliveries, the two events for one
   card, and the nightly replay all pay at most once. A refused card is
   recorded too (`card-used`, `account-granted`, `no-offer`), and the builder
   tells somebody whose card had already claimed the credit elsewhere.

Accounts that got their dollar on creation, before this, keep it: their row
has the id already, so they are never offered or paid a second. A deployment
with no Stripe configured offers nobody the credit, since there is no way to
save a card.

### Referrals

$5 of build credit to each side once the referred account's first payment
clears, for up to 25 paid referrals per referrer (`DEFAULT_REWARD_CENTS` and
`MAX_PAID_REFERRALS`, `worker/referral.ts`). No self-referral, the first
attribution is the only one, and none can be made once the account has
started a purchase.

- `GET /api/referral/status` -- authenticated. Issues the caller's code on
  first look and returns `{ code, url, referred, paid, earnedCents,
rewardCents, maxPaidReferrals }`. `url` is `https://vibld.com/?ref=<code>`
  (`VIBLD_REFERRAL_ORIGIN` overrides the origin), so a friend sees the site
  before signing up. `earnedCents` is summed from the
  caller's referral grants net of clawbacks, not worked out from `paid`.
- `POST /api/referral/claim` -- authenticated, body `{ "code": "..." }`.
  Always answers `{ "recorded": true }`; why a claim was refused is logged,
  never returned.

End to end:

1. A code is 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. The Worker
   (`normaliseCode`), the builder (`src/referral/referral-client.ts`) and
   vibld.com (`apps/marketing/app/referral.ts`) each accept it in any case
   with spaces or hyphens, and nothing else. Tests on both clients hold them
   to the Worker's answers.
2. A link to vibld.com with `?ref=CODE` keeps the code in `sessionStorage`
   for the visit and adds it to every link to `SITE.signUpUrl` once the page
   has hydrated. The prerendered HTML is unchanged, so without JavaScript the
   sign-up link still works and simply carries no code. vibld.com's Cookie
   Notice says so.
3. The builder reads `?ref=` on `/` and `/sign-up` before rendering
   (`src/main.tsx`) and keeps it in `localStorage`, which survives a
   verification email opening a new tab.
4. Once signed in, `ReferralClaim` posts the kept code to
   `/api/referral/claim` once per page load, and forgets it as soon as the
   Worker answers. A network failure or a Worker error keeps it for the next
   load. The person signing up is never told a claim was refused.
5. **Refer a friend**, under **Plan and usage** in the settings menu
   (`src/components/ReferralPanel.tsx`), shows the link with a **Copy**
   button (a refused clipboard selects the link instead), what both sides
   get from `rewardCents` and `maxPaidReferrals`, and progress from
   `referred`, `paid` and `earnedCents`.

**Saving a card for the welcome credit does not close the barrier.** The
barrier (`PURCHASE_BARRIER_SQL`, `worker/purchase-barrier.ts`) is a row in
`billing_purchase_starts`, written when a plan or top-up Checkout Session is
created, or a mirrored top-up or subscription. It used to be any row in
`billing_customers`, which the card-setup session writes too, so every
account that took its dollar could never be referred. `0030_purchase_starts.sql`
carries every existing customer over as started, so no account that was
blocked before is unblocked by the migration.

### Billing UI in the builder shell (L35)

The header now shows the caller's tier and this period's spend against their
allowance (`GET /api/billing/status`, `worker/index.ts`'s `handleBillingStatus`
-- a read-only mirror of exactly what `reserveBudget` above computes and
reserves against; nothing new is authoritative, `UserBudget` still is), plus:

- **A tier picker and "Upgrade" button**, shown only on the Free tier --
  starts a Checkout Session for the chosen tier at the monthly price
  (`src/billing/billing-client.ts`'s `startCheckout`).
- **"Buy top-up"** -- always offered; a top-up is a fallback layer regardless
  of tier (see above).
- **"Manage billing"**, opening the Stripe-hosted Billing Portal -- shown
  only once the status endpoint reports a Stripe customer exists
  (`hasStripeCustomer`), since the Portal 502s without one and a caller who
  has never checked out has nothing to manage yet.
- **"Cancel plan"**, opening the cancel flow from `POST /api/billing/cancel`
  (`openCancelPlan`), which is where a monthly plan is offered half off a
  month -- shown only on a paid tier whose plan is not already set to end.
- **"Add a card"**, for an account offered the welcome credit
  (`src/components/SignupCreditOffer.tsx`), here and above the composer.

Every button redirects the whole page to a Stripe-hosted URL and back
(`success_url`/`cancel_url`/the Portal's `return_url`), so there is no
in-app checkout state to keep in sync -- the next mount just fetches the
status again. `src/components/BillingStatus.tsx` is the JSX half; the fetch
wrapper and URL-shaped response parsing it calls are JSX-free
(`src/billing/billing-client.ts`) for the same testability reason
`remote-provider.ts` is (see that file's own doc comment).

### Setup

1. Add `STRIPE_SECRET_KEY` -- the account's live secret key
   (https://dashboard.stripe.com/apikeys) -- to the `preview` environment
   here. The **Deploy web preview** workflow syncs it to this Worker, the
   same way it already syncs `PREVIEW_INTERNAL_SECRET` above.
2. Add `STRIPE_WEBHOOK_SECRET` -- the signing secret for this deployment's
   registered webhook endpoint (https://dashboard.stripe.com/workbench/webhooks)
   -- to the same environment. Relayed once, out of band, when the endpoint
   is created -- never committed here.
3. Once `app.vibld.com` (L20) is live, update that webhook endpoint's `url`
   to point at it (a Dashboard edit or one API call; the signing secret does
   not change). Until then, deliveries queue and retry against a domain
   that does not yet resolve to this Worker -- harmless, since nothing can
   subscribe before both the code and the domain exist.
4. Run **Configure Stripe and Clerk** with `mode` = `apply`:
   <https://github.com/vibld/vibld-internal/actions/workflows/configure-accounts.yml>.
   It creates the retention coupon `vibld-retention-50-1mo` (50% off,
   `once`, any product), adds any missing event to the webhook endpoint
   above, and sets the portal's default configuration, including the
   cancel feature the cancel flow needs. `inspect` shows what it would do
   and writes nothing; both are safe to repeat.

## Admin: manual credit grants (docs/decisions.md L4)

The first consumer of `platform-admins.ts`'s `isPlatformAdmin`: a platform
admin can grant a user spend credit outside the Stripe top-up flow --
support, goodwill, or testing. `AdminPanel` in the builder shell offers
this to anyone `/api/config`'s `isAdmin` field says is a platform admin;
`/api/admin/user` (GET, by email) and `/api/admin/topup` (POST) both
re-check admin membership themselves regardless of what the shell showed
(ADR-0006) -- the picker is a convenience, the endpoint is the boundary.

A grant lands in its own `billing_admin_credits` table, not as a row in
`billing_topups`: every row in that table came from a real Stripe Checkout
Session (see `billing-store.ts`'s own comment), which is exactly what the
nightly `reconcileSubscriptions` assumes. `BillingStore.totalSpendableCreditMicroUsd`
combines both tables into the one balance `handlePlan`'s budget gate and
`/api/billing/status`'s readout actually spend against and show -- a grant
is immediately usable, and immediately visible in the user's own "top-up
remaining" figure. Grants expire after 12 months, the same window L36 gives
a purchased top-up.

`/api/admin/*` accepts an email, not a Clerk user id -- what an admin
helping a user actually has -- and resolves it server-side
(`clerk-lookup.ts`, a raw call to Clerk's Backend API rather than a new
SDK dependency, the same choice `clerk-auth.ts` already made for session
verification). A single grant is capped at $500 (`request-guard.ts`'s
`MAX_ADMIN_TOPUP_USD_CENTS`) so a typo cannot hand out an enormous sum;
grant again for more.

The same lookup lists what refunds and lost disputes removed from the
account, and whether a lost dispute has it suspended; **Lift suspension**
(`POST /api/admin/suspension/lift`, same admin check and Clerk lookup)
clears it. See "Refunds and disputes" above.

### Setup

1. `VIBLD_PLATFORM_ADMINS` (comma-separated verified emails) and
   `CLERK_SECRET_KEY` (https://dashboard.clerk.com/~/api-keys -- the
   **Secret keys** section) both go on the `preview` environment here. The
   **Deploy web preview** workflow syncs both to this Worker, the same way
   it already syncs `STRIPE_SECRET_KEY` above. Both are optional in the
   same fail-closed sense every other secret here is: unset means
   `/api/admin/*` answers "not configured", not open.
2. `migrations/0004_admin_credits.sql` needs no manual step -- the
   **Deploy web preview** workflow's migration-apply step (see "Hosted
   preview" → "Deploying" above) picks up any pending migration
   automatically on the next deploy.

## Projects (resolved 2026-09-28)

An account has projects, and each one remembers everything about itself:
its accepted code, the whole conversation with the agent, its style preset,
reference page and model, its standing instructions and visual preferences.
Opening one puts all of it back. Before this an account had exactly one
project, keyed by its Clerk user id, and the builder restored nothing on
load, so a refresh lost the conversation and every setting.

**Storage** (`migrations/0033_projects.sql`, `worker/project-store.ts`). A
`projects` row per project (owner, name, archive state, when it was created,
changed and last opened, and the settings) beside the generation store's own
`generation_projects` row, which shares its id and still holds the accepted
revision. The conversation is JSON in R2 at `projects/<id>/transcript.json`,
under the same prefix as the snapshots, with its key in the row. The
migration turns each account's one project into its first, named "Untitled
project" and keeping its id, which is how work from before projects comes
back.

**Routes** (`worker/project-handlers.ts`), all behind Clerk like every
other `/api/*` route, and a project that is not the caller's is 404:

| Route                              | Does                                                                                       | Invite gate |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| `GET /api/projects`                | List, active and archived, with the tier's limit                                           | open        |
| `POST /api/projects`               | Create (held to the limit)                                                                 | gated       |
| `GET /api/projects/:id`            | Open: settings, conversation, accepted code                                                | open        |
| `PATCH /api/projects/:id`          | Rename, archive, unarchive (held to the limit), save settings and conversation             | open        |
| `DELETE /api/projects/:id`         | Delete: its published site first, then everything under its prefix, then its rows          | open        |
| `POST /api/projects/:id/duplicate` | Copy the accepted code, settings and conversation into "<name> (copy)" (held to the limit) | gated       |
| `POST /api/projects/:id/share`     | Turn its share link on (below)                                                             | gated       |
| `DELETE /api/projects/:id/share`   | Turn it off, for good                                                                      | open        |

The gate's reasons are in `access-gate.ts`: making or copying a project is
starting new work, and reading, tidying or deleting your own is not.
Deleting refuses with 409 while a build is still running in the project,
because the run would otherwise recreate its rows with no owner.

**The limit.** A free account may have three active projects; archived
ones are unlimited, and Build and Ship have no limit
(`ACTIVE_PROJECT_LIMIT` in `entitlement.ts`, read through the same `tierFor`
as the allowance). A create, duplicate or unarchive past it is refused with
403 and `code: "project-limit"`, checked inside the SQL statement so two
requests racing cannot both take the last slot. The builder shows the
reason and an upgrade button that starts Checkout.

**Runs.** `/api/plan` builds in the project named by `projectId`, refused
as 404 for another account's and 409 for an archived one. A request with no
`projectId` comes from a builder older than projects and builds in the
caller's most recently opened active project, or a new one if there is none.
`/api/runs?project=<id>` reads one project's history.

**Publishing is per project**: each project publishes to its own
`<slug>.vibld-preview.dev` site, deleting a project takes its site down, and
the sites published when there was one per account kept their addresses
(see "Cloudflare auto-publish" above). Everything else stays per account,
deliberately:

- **The media library.** Shared by every project the account has (decided
  2026-09-28). A remix into another account copies what its code uses into
  the remixer's library (below); a duplicate within one account copies
  nothing.
- **The preview sandbox.** One per account; opening another project stops
  it.
- **GitHub.** One connected repository per account; pushing from any
  project pushes there.
- **Spend, rate limits, `/api/chat` and `/api/mockups`.** Neither route
  reads a project, and the allowance is the account's.

**In the builder** (`src/projects/`). `/p/<id>` is a project and `/projects`
is the list; any other address shows the open project, or on a fresh load
the one opened last, and is corrected to its `/p/<id>`. The header shows the
open project's name, editable in place, a "Projects" link, and a quiet
"Saving…", "Saved" or "Couldn't save". The list offers open, rename,
duplicate, archive and delete (confirmed in the page), and unarchive and
delete for archived projects. "Start over" becomes "New project".

**Autosave** (`src/projects/autosave.ts`) sends settings whenever they
change and the conversation whenever a turn settles (an accepted build, a
reply, a failure), debounced by a second, one save in the air at a time, a
failed one kept and retried, and flushed before another project is opened
and when the page goes away. Opening a project restores its own model,
instructions and preferences where it chose them, and fills the rest from
this browser's last choice, which is also what a new project starts with.

**Without a server.** Where the deployment generates in the browser
(`generation: "fake"`), there is no server copy of the code to restore, so
the builder works in memory exactly as it did before projects, with no list
and nothing saved. A model deployment whose projects cannot be read falls
back the same way and says the session is not being saved.

### Sharing and remixing (resolved 2026-09-28)

An owner can turn on an unlisted link for a project, copy it, and turn it
off again. Anybody with the link sees the project's name, a live preview
and its code, read-only, and somebody signed in can **Remix** it: copy it
into a new project of their own.

**The link** (`migrations/0034_project_share.sql`, `worker/share-link.ts`)
is `https://app.vibld.com/s/<token>`, where the token is 32 random bytes in
base64url, stored on the project's row. It is never the project id, which
for a backfilled project is the owner's Clerk user id. Turning the link on
twice keeps the same token; turning it off forgets the token, so that link
is dead for good, and turning it on again makes a new one. The owner's view
of a project carries `share: { on, url, held }`.

**What a stranger gets** (`worker/share-handlers.ts`):

| Route                            | Does                                                                      | Who                        |
| -------------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| `GET /api/share/:token`          | The project's name, its accepted code, and whether a live preview can run | anybody with the link      |
| `GET /api/share/:token/preview`  | The live preview's state                                                  | anybody with the link      |
| `POST /api/share/:token/preview` | Start the live preview                                                    | signed in                  |
| `POST /api/share/:token/remix`   | Copy it into the caller's account (held to the limit)                     | signed in, behind the gate |

Nothing about the owner is in any answer: not their id, name or email, not
the project's id, dates, settings or conversation. Every dead link answers
the same 404, whichever of these made it dead: turned off, the project
archived (unarchiving brings it back) or deleted, an operator's hold, the
owner suspended by a lost dispute, or the owner having asked for the
account to be deleted. All of them are one statement
(`ProjectStore.findShared`). The view and the preview are counted per
address by `SHARE_BURST` before the database is read; starting the preview
is also counted per caller by `SHARE_PREVIEW_BURST`, and a remix per caller
by `REMIX_BURST`. All three are declared in `wrangler.jsonc`.

**The live preview runs in one sandbox per link**, started when somebody
signed in presses "Run live preview" and then shown to every viewer of that
link, signed in or not. Starting it needs an account (decided 2026-09-28),
though not an invite: a sandbox is the one thing a link lets a stranger
spend, and an account is something a start can be counted against, refused
while it is suspended or leaving, and traced to. Somebody not signed in sees
"Sign in to run the live preview" instead, and a preview another viewer
started. It is one sandbox per link:
not one per viewer, and not a static render, because a generated project is
a Vite and React app that draws nothing until it runs. The sandbox is named
by a hash of the token, never by the project or the owner, since its name
is in the preview's address; it serves the owner's media, restricted to the
files the code references, as the owner's own preview does
(`apps/preview`'s `mediaOwner`). It lives the usual thirty minutes in the
usual container budget, spends no model money, and is stopped when the
owner turns the link off, archives or deletes the project, when an operator
holds the link, and when the account is deleted.

**A remix** copies the accepted code and the settings (style, reference
page, model, instructions, visual preferences) into a new project named
"Remix of <name>", and not the conversation, which the link never showed.
Into another account it also copies the media the code uses into the
remixer's library (`worker/media-copy.ts`), so the remix depends on nothing
of the original owner's: a file the remixer already has byte for byte is
reused, a different file under the same name is stored under the next free
name and the copied code is rewritten to use it, and a library without room
refuses the remix whole with 409 and `code: "media-room"`. Within one
account nothing is copied.

**Operator holds.** `POST /api/admin/publish/hold` and `/release` take
`{ "share": "<link or token>" }` in place of `{ "slug" }`, and hold a share
link the way they hold a site: the link serves nothing, its live preview is
stopped, the owner can still turn it off but cannot turn it on, and who and
why are kept in `project_share_holds`. Releasing puts the link back only if
the owner left it on. The admin panel's takedown field takes a slug or a
share link.

**In the builder.** The header's "Share" control shows whether the link is
on, what it gives away (said before it is turned on), the link to copy, and
the switch. `/s/<token>` is the share page (`SharedProjectPage`), which
renders signed in or not and carries none of the builder's state. Remix,
or "Sign in to run the live preview", signed out shows the sign-in form in
place and carries on once signed in (`?remix=1` or `?preview=1`, and the
tab's session storage for a sign-up that ends elsewhere): a remix then opens
the new project, and a preview starts.

### Setup

`migrations/0033_projects.sql`, `0034_project_share.sql` and
`0035_site_per_project.sql` are applied by the **Deploy web preview**
workflow like every other migration. The two rate limits are declared in
`wrangler.jsonc` and need nothing provisioned. Nothing else: the routes use
the D1, R2 and service bindings the Worker already has.

## Account deletion (docs/decisions.md L32)

Anybody signed in can delete their account from the gear menu ("Account",
then "Delete account"), invited or not: `/api/account/delete` is ungated in
`access-gate.ts`. The page explains what stops now, what is deleted after
30 days and what is kept, and sends nothing until the person types
`delete my account`. The Worker checks the phrase too.

**The moment they ask** (`account-deletion.ts`), a row is written to
`account_deletions` (`migrations/0031_account_deletions.sql`) and, from then
on, `resolvePrincipal` refuses every authenticated request from the account
with 403 and `reason: "deletion-scheduled"`, except the deletion routes
themselves. Then, each on its own and each recorded when it is done:

1. **Subscription.** Every subscription Stripe has for the customer that can
   still take money is cancelled immediately, with `prorate: false` and
   `invoice_now: false`: nothing is refunded or prorated, as the refund
   policy says.
2. **Preview.** Stopped through the preview service's stop path.
3. **Published site.** Taken down through the owner's own takedown
   (`handleUnpublish`), while the person is asking. The step is done when
   D1 says nothing of theirs is serving.
4. **GitHub.** This deployment's grant is revoked. The GitHub App stays
   installed on the person's GitHub account; that is theirs to remove.
5. **Referrals.** Unpaid rewards on either side are reversed (paid ones are
   ledger and untouched), and the referral code is deleted.

A step that fails (Stripe unreachable, the publish service down) leaves the
request recorded and the step undone. It is retried by the person, whose
next sign-in shows a "scheduled for deletion" screen with a button for it,
and by the nightly pass. The nightly pass never takes a site down
(ADR-0013); a site still serving holds the purge until the owner or an
operator takes it down, and the admin panel says which.

**After 30 days** the nightly pass purges the account, in steps that each
save their place: the subscription is checked once more, then every project
the account owns is deleted one at a time (everything under
`projects/<id>/`, its snapshots and its saved conversation, and then its
rows, so each pass takes a project out of the next pass's list), then the
media (`media/<user>/`), then any project, run, trace and media rows left, the published site's catalogue (its
bytes are collected by apps/publish's orphan sweep; the slug is kept, never
released, under the tombstone), the GitHub grant and push history, the
referral code and the redeemed invite, both spend-ledger Durable Objects,
and last the Clerk user (`DELETE https://api.clerk.com/v1/users/{id}` with
`CLERK_SECRET_KEY`).

**Kept**, re-keyed from the Clerk id to a random tombstone: billing
customers, subscriptions, top-ups, payments, scheduled cancellations, the
welcome-credit offer and card rows, credit grants (referral payouts
included) and referral attributions. None of them holds an email address;
parked Stripe events naming the account lose theirs
(`customer_email`, `customer_details`, `billing_details`, `receipt_email`).
The deletion row itself is the audit record L32 keeps: it is re-keyed to
the tombstone and deleted 12 months after the purge. A site held by an
operator keeps its bytes for their review and is marked unpublished, so
lifting the hold does not put it back online.

**Keeping the account.** Until the purge starts, the "scheduled for
deletion" screen offers "Keep my account" (`/api/account/delete/cancel`).
What was already stopped stays stopped.

**The nightly budget.** The deletion pass shares the nightly D1 allowance
(`VIBLD_REPLAY_QUERY_BUDGET`) with the billing pass. It costs one query a
night to find out there is nothing to do, so the billing pass's thresholds
(the parked floor from 39, the split from 92) now apply to the allowance
less one. With work waiting, an allowance
of 122 or more gives it up to a quarter and splits the rest as before;
below that it takes a turn in the billing rotation (`planNight` in
`billing-replay.ts`), and the parked queue keeps its floor. At most five
requests a night; a request that has failed seven times is tried weekly.

**The operator's view.** The admin page's "accounts scheduled for deletion"
lists each pending request, when it purges, what is not done yet, its last
error and any site still online (`/api/admin/deletions`).

What is not deleted by this: the preview sandbox's own Durable Object keeps
the record of share links it issued and the id of the account whose media
it last served, because apps/preview has no route to forget them; and
Cloudflare Workflows keeps finished generation instances for its own
retention period.

### Setup

1. `CLERK_SECRET_KEY` on the `preview` environment (see "Admin: manual
   credit grants" above). Without it every purge stops at its last step,
   with the account's data deleted and the sign-in account kept, and the
   admin panel shows the error.
2. `migrations/0031_account_deletions.sql` is applied by the **Deploy web
   preview** workflow like every other migration.

## Pushing to GitHub (internal issue 13, docs/decisions.md L30/L42a)

A checkpoint can be pushed to a repository the user connected: a branch
`vibld/<revision>`, one commit carrying the generated files, and a pull
request against the repository's default branch. `/api/github/status` (GET)
tells the builder what is connected; `/api/github/push` (POST) does the
push. Both take the same `files` shape `/api/preview` does, plus a
`revision`.

Nothing about it is stored as a user credential. ADR-0006 separates two
classes, and the App's private key is the Vibld-infrastructure kind: a
Worker secret that signs a short-lived JWT, which mints an **installation
token scoped to the single repository the user approved** (`repositories`
and `permissions` are both sent on the mint, so a token cannot reach the
rest of an installation). That token lives for the length of one push and
is never written down. What persists is the binding itself in
`github_bindings`: an installation id, a repository, a branch, who approved
it and when, and when the grant expires (90 days). A revoked grant keeps
its row and blocks new work rather than disappearing.

A push is made safe to retry rather than assumed to happen once (ADR-0007).
The parent commit is resolved and **written to `github_pushes` before the
first call that can succeed without saying so**, and `beginPush` inserts or
does nothing, so every retry of a checkpoint gets the parent the first
attempt used. The commit's author and committer dates come from that same
recorded row. Both together are what make a retry produce the identical
git object instead of a second commit: git objects are content-addressed,
so a different parent or a different timestamp is a different commit, and
an attempt whose reply was lost would otherwise push twice. `pushCheckpoint`
then reconciles what is already there rather than assuming a clean start.

`/api/github/push` has its own burst gate (`GITHUB_BURST`, keyed on the
Clerk user id and checked after identity) for the same reason publishing
does: a flood here costs GitHub API quota and writes into a real
repository.

### Setup

1. Create the App at https://github.com/settings/apps/new. Repository
   permissions: **Contents: Read and write** and **Pull requests: Read and
   write**, nothing else. Webhook: unchecked. "Where can this GitHub App be
   installed": **Any account**.
2. On the App's page, **Generate a private key**. The `.pem` downloads once.
   Paste its whole contents (including the `BEGIN`/`END` lines) into a new
   secret `VIBLD_GITHUB_PRIVATE_KEY` on the `preview` environment at
   https://github.com/vibld/vibld/settings/environments -- never into a
   chat, an email, or this repository. The App ID shown at the top of the
   same page goes into `VIBLD_GITHUB_APP_ID` there too.
3. On the same page, under **Identifying and authorizing users**, set the
   **Callback URL** to `https://app.vibld.com/api/github/callback` and tick
   **Request user authorization (OAuth) during installation**. Then copy the
   **Client ID** into `VIBLD_GITHUB_CLIENT_ID`, and use **Generate a new
   client secret** for `VIBLD_GITHUB_CLIENT_SECRET`, both on the same
   environment. Without these a deployment can push on a binding it already
   has but cannot make new ones.
4. The **Deploy web preview** workflow syncs all four to this Worker on the
   next deploy, the same way it already syncs `STRIPE_SECRET_KEY` above, and
   `migrations/0005_github.sql` is applied by that workflow's
   migration-apply step. All four are optional in the same fail-closed sense
   as every other secret here: unset means `/api/github/*` answers "not
   configured", not open.

### Connecting a repository (internal issue 121)

The part that decides _which_ repository, and the only part of this feature
where the security is the feature rather than the error messages.

GitHub redirects to the App's setup URL after an installation with
`?installation_id=N` on the query string. That redirect is a plain GET: it is
not signed, it carries no secret, and nothing about it proves the browser
making the request had anything to do with the installation. Binding on it
would let any signed-in user request the callback with somebody else's
installation id and have Vibld push commits into a stranger's repository. A
`state` nonce does not close that, because the attacker legitimately holds a
nonce for their own session and it is the id beside it that is forged.

So `installation_id` is read as a preference and never as permission. What
establishes the right to bind is a user-to-server token:

1. `/api/github/connect` returns the authorize URL and the signed `state` it
   contains. It returns the URL rather than redirecting, because the caller
   is an authenticated `fetch` from the builder and a 302 would be followed
   by that fetch, sending its `Authorization` header to GitHub. The app keeps
   the state and compares it on the way back, so a link somebody else crafted
   carries a state the browser never issued.
2. `/api/github/callback` is where GitHub lands, and the only route here that
   is not authenticated. GitHub returns through a top-level browser
   navigation, which carries no `Authorization` header, so a route that
   demanded a Clerk session would reject every real callback with a 401. It
   does no work and holds no authority: it puts the `code` and `state` in the
   fragment (never sent to a server) and redirects to the app. Its redirect
   target is built from this origin rather than taken from the request, or it
   would be an open redirect with an OAuth code attached.
3. `/api/github/complete` is the authenticated half, called by the app with a
   `fetch` that can carry the Clerk token. The `state` must verify _and_ name
   that caller, because verifying alone would let somebody else's
   authorization be completed inside this session. It trades the `code` for a
   **user** token and asks GitHub `GET /user/installations` and
   `GET /user/installations/{id}/repositories`. A forged installation id
   fails by simply not being in the answer.
4. `/api/github/bind` writes the binding, choosing from the list that was
   signed rather than from the request body, so the destination and its
   default branch are the ones GitHub reported.

Every installation the person reaches is read at step 3, not just the one
the redirect named, and each repository carries the installation it would be
pushed through. Repository lists are paged through rather than read once, for
the same reason. Offering one and naming the rest would be a dead end rather
than a limit: reading another installation needs the user token, and that is
gone as soon as the callback ends. The fan-out is capped, and one
installation failing does not lose the others.

The user token is used for those two reads and discarded. It is never
stored: it proves who is connecting, and pushing has its own credential.
ADR-0006 keeps those classes apart, and a token that can act as somebody
across the whole of GitHub is the class this product does not hold.

Between the callback and the bind there is nothing on the server to
remember, because the callback signs what it established (this user, this
installation, these repositories, at this time) and the bind call may only
choose from what was signed. Repositories the user cannot push to, and
archived ones, are left out at step 2: offering them means somebody picks
one, waits, and is refused at the push instead of at the choice.

Only `revoked_at` is set on disconnect, never a delete, so a grant that
existed stays a fact.

GitHub downloads a PKCS#1 key ("BEGIN RSA PRIVATE KEY") and WebCrypto
imports only PKCS#8, so `github-app.ts` wraps the DER itself rather than
asking for a converted key. `test/github-app.test.ts` signs with both forms
and verifies against the public key, because a wrong ASN.1 wrapper is the
kind of mistake that only shows up in production.

## Generated output

Generated projects are conventional and portable (ADR-0002): React, TypeScript
and Vite with ordinary `dev`, `build`, `lint` and `typecheck` scripts, and no
Vibld runtime dependency.
