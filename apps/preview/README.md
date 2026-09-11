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
  `npm run dev` and exposes it via `exposePort()`.
- **`worker/preview-fleet.ts`** / **`worker/fleet.ts`** -- `PreviewFleet`, a
  single well-known Durable Object instance enforcing L9's other number: 25
  concurrent previews across every user, with the 26th queued (a real FIFO
  position, not a rejection) rather than refused. Same reserve-now/release-
  later shape as `apps/web`'s `UserBudget`, split into a pure, tested
  decision module (`fleet.ts`) and a thin Durable Object wrapper
  (`preview-fleet.ts`), for the same reason `spend.ts`/`budget.ts` are split.
- **`worker/index.ts`** -- routes two entirely different kinds of traffic on
  one Worker: public, unauthenticated requests on `*.vibld-preview.dev`
  (proxied straight into a sandbox by `proxyToSandbox`, satisfying L8's
  isolated-origin requirement -- this domain never carries a builder cookie),
  and an internal control-plane API (`/internal/preview/*`) that only
  apps/web calls, over a service binding, gated by a shared secret (see
  `internal-auth.ts`).

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

## What's still missing

- **Sharing (L10).** A preview is private by default today -- its URL is
  known only to the user who started it, returned over an authenticated
  `/api/preview` call on apps/web. An explicit, signed, revocable,
  time-limited _share_ link (beyond that default privacy) is a follow-up.
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
and add `PREVIEW_INTERNAL_SECRET` to it -- a long random value, shared with
`apps/web`'s own copy of the same secret (see that app's README). The
Cloudflare API token needs **Workers Scripts: Edit** (already covers this
account, per `apps/web/README.md`) plus **DNS: Edit** on the
`vibld-preview.dev` zone, for the wildcard route.

**Docker must be available on the deploy runner** -- the Sandbox SDK builds
the container image (`./Dockerfile`, `FROM docker.io/cloudflare/sandbox`)
at deploy time. GitHub's `ubuntu-latest` runners ship Docker preinstalled.

Run the **Deploy sandbox service** workflow from the Actions tab
(`workflow_dispatch` only).

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/preview deploy
```
