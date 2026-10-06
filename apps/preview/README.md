# @vibld/preview

Ephemeral sandbox previews for generated projects (ADR-0004;
docs/decisions.md L7-L11). This is production infrastructure -- not to be
confused with `preview/nstarsystems`-style throwaway branches or
`.github/workflows/deploy-preview.yml`, which deploy one arbitrary generated
project as its own permanent Worker purely so a human can look at it. This
package instead runs _any_ generated project, on demand, in a genuinely
untrusted, time-boxed, network-restricted container -- and throws it away
when the caller stops it or the hard lifetime runs out.

```bash
pnpm install
pnpm --filter @vibld/preview typecheck
pnpm --filter @vibld/preview test
```

## What this is

- **`worker/preview-sandbox.ts`** -- `PreviewSandbox`, a Durable Object
  extending `@cloudflare/sandbox`'s `Sandbox`. One instance per user
  (`getSandbox(env.Sandbox, userId, { normalizeId: true })`), which is also
  how L9's "1 concurrent preview per user" is enforced: a second call for the
  same user reuses this same instance rather than creating a competitor.
  Writes the caller's files into `/workspace`, runs `npm install`, starts
  `npm run dev` and exposes it via `exposePort()`. Also `buildProject`
  (ADR-0010: Cloudflare auto-publish's build step) -- a one-shot
  `npm install && npm run build` in the same sandbox, reading the output
  tree back with `listFiles`/`readFile` rather than exposing a port. Runs
  in an instance named for building rather than in the caller's preview
  sandbox, because sharing one meant a build was refused whenever a preview
  was live, which is most of the time (internal PR 196 review). It takes a build
  ticket from the same `PreviewFleet` previews use and destroys its
  container as it finishes: a build holds no exposed port and no long-lived
  process, but it does hold one of the platform's container slots while it
  runs, and that is what `worker/capacity.ts` accounts for. A build that
  finds no room is refused as `busy` rather than queued. Two builds for one
  user are still excluded, now by a lock rather than by the preview's
  presence.
- **`worker/preview-fleet.ts`** / **`worker/fleet.ts`** -- `PreviewFleet`, a
  reserve-now/release-later counter enforcing L9's other number: 25
  concurrent previews across every user, with the next request queued (a
  real FIFO position, not a rejection) rather than refused. Same shape as
  `apps/web`'s `UserBudget`, split into a pure, tested decision module
  (`fleet.ts`) and a thin Durable Object wrapper (`preview-fleet.ts`), for
  the same reason `spend.ts`/`budget.ts` are split. One well-known instance
  counts previews and builds against one budget of 25 containers, the
  platform's `max_instances`, with builds bounded at 5 of it (internal issue 197).
  Previews get all 25 whenever nothing is building; a preview queues behind
  a build only when every container is taken, and its position counts the
  previews ahead of it, because builds never wait in the queue. See
  `worker/capacity.ts`.
- **`worker/free-previews.ts`** -- D158's limits on a Free account's
  previews, which apps/web marks with `free: true` on
  `/internal/preview/start`. Their time holding a container is counted per
  UTC day by `PreviewFleet`, keyed by the account whose preview it is
  (the builder and every share link of its projects share one day, and a
  session crossing midnight counts its later part against the new day),
  and a new start is refused past
  `VIBLD_FREE_PREVIEW_DAILY_MINUTES` (120 by default; 0 turns Free previews
  off), and the fleet never gives one the last `PAID_PREVIEW_RESERVED` (5)
  containers, which are kept for paid plans.
- **`worker/index.ts`** -- routes four kinds of traffic on one Worker:
  published sites, `<slug>.vibld-preview.dev`, handed to apps/publish over
  the `PUBLISH` service binding (`worker/publish-route.ts` decides which
  hosts those are);
  public, unauthenticated requests on `*.vibld-preview.dev` (proxied straight
  into a sandbox by `proxyToSandbox`, satisfying L8's isolated-origin
  requirement -- this domain never carries a builder cookie); share-link
  redemption on the reserved `share.*` subdomain (L10, see below); and an
  internal control-plane API (`/internal/preview/*`, `build` included) that
  only apps/web calls, over a service binding, gated by a shared secret
  (see `internal-auth.ts`).
- **`worker/share-token.ts`** -- the "signed" half of L10: a pure,
  storage-free HMAC-SHA256 sign/verify pair for share links.
- **`worker/start-request.ts`** -- what `/internal/preview/start` accepts.
  A sandbox is named for its user, except a shared project's live preview
  (apps/web's `share-handlers.ts`), which runs in one sandbox per project
  share link, named for the link, so a stranger's viewing never costs more
  than one sandbox per link. That sandbox serves its project owner's media,
  so apps/web names the owner as `mediaOwner`; still only the files the
  code references are served. Absent, the media owner is the sandbox's own
  name, as it always was. It also says what `/internal/preview/update`
  accepts.
- **`worker/live-update.ts`** -- a new revision applied to a running
  preview without a restart (D74): only the files that differ from what the
  sandbox serves are written, deleted ones are removed, and Vite reloads.
  When the dependencies changed, `npm install` runs first (under the
  `installing` phase) and the dev server alone is restarted. Anything it
  cannot do in place, `PreviewSandbox.updatePreview` answers as `restart`,
  and the builder restarts the preview as it did before.
- **`Dockerfile`, `warm/package.json`** -- the image carries the
  generation stack already installed (D74). A preview moves that
  node_modules into its project before its own `npm install`
  (`worker/provision.ts`'s `SEED_COMMAND`), which then only reconciles it
  with the project's package.json, and `npm prune` removes what the project
  does not declare. `packages/ai/test/preview-warm-cache.test.ts` keeps the
  list equal to `packages/ai/src/stack.ts`.

## Why a separate package, not a folder in apps/web

Two independent reasons, not one:

1. **L8 itself.** Previews need an isolated origin -- a second registrable
   domain (`vibld-preview.dev`) that never shares cookie scope with the
   builder. That means a separate Worker regardless of anything else.
2. **A real TypeScript constraint.** `apps/web`'s `tsconfig.json` is shared
   between its browser bundle and its Worker code, so it deliberately avoids
   `@cloudflare/workers-types` (see `apps/web/worker/cloudflare.d.ts`'s own
   comment) -- those ambient Durable Object / Container globals would
   collide with the DOM lib the browser code also needs. `@cloudflare/
sandbox` has no browser code to protect, so this package uses the real
   `@cloudflare/workers-types` directly rather than hand-rolling a narrower
   version.

## Egress (L11)

`PreviewSandbox` sets `enableInternet = false`, `interceptHttps = true` and
`allowedHosts = ['registry.npmjs.org']`. Nothing else reaches the network
from inside a preview: no model-provider credential and no control-plane
credential is ever available there (ADR-0006) -- there is nothing to steal in
the first place, since the sandbox only ever receives the project's own
files.

## Sharing (L10)

A preview is private by default: its own URL is known only to the user who
started it, returned over an authenticated `/api/preview` call on apps/web.
Sharing it beyond that is explicit and opt-in -- `PreviewSandbox.createShare`
mints a grant, never anything a preview offers on its own.

- **Signed.** `share-token.ts`'s `signShare`/`verifyShare` -- an HMAC-SHA256
  over the share id and its expiry, so a share URL cannot be forged or
  altered in transit. Checked in `worker/index.ts`'s `handleSharedPreview`,
  before a Durable Object is ever woken for it.
- **Revocable, independently of the preview it points at.** Each grant is a
  row in `PreviewSandbox`'s own `shares` table (SQLite, the Durable Object's
  own storage -- no new binding, the same `ctx.storage.sql` idiom
  `preview-fleet.ts`'s queue table already uses). Several grants may be
  active for one preview at once; revoking one (`revokeShare`) does not
  disturb any other, or the preview itself. `proxyShared` checks this table
  fresh on every request -- the HMAC alone proves the link was legitimately
  minted, not that it is still live.
- **Time-limited.** 24 hours by default, capped by the preview's own
  remaining L9 lifetime -- a share cannot outlive the preview it points at,
  and `createShare` sets the grant's own stated expiry to say so honestly
  rather than advertise a full 24 hours a preview open for another five
  minutes cannot back.
- **The redemption URL** is `https://share.{PREVIEW_HOSTNAME}/{sandboxId}/{shareId}?exp=...&sig=...`
  -- a reserved subdomain distinct from the owner's own
  `{port}-{sandboxId}-{token}.{PREVIEW_HOSTNAME}` preview URL, so a share
  grant is a genuinely separate credential from the owner's own token, not
  a copy of it with an extra check bolted on. `proxyShared` forwards a
  validated request to the real, currently-valid preview URL as an ordinary
  outbound `fetch()` -- that URL already routes correctly through this
  Worker's own public entrypoint, so nothing here reaches into
  `@cloudflare/sandbox` internals `Sandbox`'s own public API surface
  (`fetch`, `containerFetch`, `exposePort`) does not already offer.
- **Known limitation:** a server-side redirect issued by the running dev
  server itself (not client-side app routing, which works fine) would break
  out of the `/{sandboxId}/{shareId}` path prefix a share is reached under.
  Not handled in this pass -- the base preview URL has no equivalent problem,
  since it carries no such prefix.
- **Not yet covered by a test:** ADR-0006 requires testing that a raw
  sandbox/port URL cannot bypass access control. `PreviewSandbox` is not
  exercised by the current `node --test` suite at all (only pure logic --
  `fleet.ts`, `internal-auth.ts`, `share-token.ts` -- and `PreviewFleet`,
  run against real SQLite in `test/shared-budget.test.ts`, are), so this
  remains unverified by an automated test, for the base preview-proxy token
  check as much as for sharing. A Miniflare/`wrangler`-backed integration
  suite for this package's Durable Objects would close this gap and is a
  natural, separate follow-up rather than something to build inside this
  change.

## Other known gaps

- **The hard lifetime (L9, 30 minutes) is enforced lazily**, on the next
  call that touches a given preview, not by a scheduled Durable Object
  alarm -- see `preview-sandbox.ts`'s module comment for why: `Container`
  already owns this object's one alarm slot for `sleepAfter` (L9's 10-minute
  idle half), and a second, competing `setAlarm()` call here would fight it.
  A preview nobody polls again stops accumulating container activity once
  `sleepAfter` puts it to sleep regardless; `PreviewFleet`'s own accounting
  self-heals the same way `UserBudget`'s abandoned-reservation reclaim
  does, on the next caller's request rather than a timer.

## Deploying

One-time: create a **`preview`** environment under **Settings →
Environments** (the same one `apps/web` and `apps/marketing` already use),
and add these secrets to it:

- `PREVIEW_INTERNAL_SECRET` -- a long random value, shared with apps/web's
  own copy of the same secret (see that app's README).
- `PREVIEW_SHARE_SECRET` -- a second, separate long random value, signing
  share links (L10). Deliberately not the same value as
  `PREVIEW_INTERNAL_SECRET`: one authenticates apps/web calling in over a
  service binding, the other authenticates an anonymous third party on the
  public internet -- a different trust boundary, so a different secret.
  Not shared with apps/web -- only this Worker ever signs or verifies a
  share link.

The Cloudflare API token needs **Workers Scripts: Edit** (already covers
this account, per `apps/web/README.md`) plus **DNS: Edit** on the
`vibld-preview.dev` zone, for the wildcard route.

**Docker must be available on the deploy runner** -- the Sandbox SDK builds
the container image (`./Dockerfile`, `FROM docker.io/cloudflare/sandbox`)
at deploy time. GitHub's `ubuntu-24.04` runners ship Docker preinstalled.

Run the **Deploy sandbox service** workflow from the Actions tab
(`workflow_dispatch` only).

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/preview deploy
```
