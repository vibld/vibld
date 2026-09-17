# @vibld/publish

Serves the primary, Vibld-subdomain path of Cloudflare auto-publish
(ADR-0010: [`docs/adr/0010-cloudflare-auto-publish.md`](../../docs/adr/0010-cloudflare-auto-publish.md);
docs/decisions.md L40). A published project gets a working
`<slug>.published.vibld-preview.dev` URL with no Cloudflare credential of
the user's involved at all -- this Worker runs entirely on infrastructure
Vibld already controls.

```bash
pnpm install
pnpm --filter @vibld/publish typecheck
pnpm --filter @vibld/publish test
```

## What this is

- **`worker/publish-store.ts`** -- `PublishStore`: a slug → `{projectId,
userId}` mapping in D1, and a project's built file content in R2, keyed
  `published/{slug}/{path}`. Taking a site down marks the row
  (`unpublished_at`) and deletes the R2 objects; it never deletes the row,
  so the name stays with its owner -- see "Taking a site down" below. Both the D1 database and the R2 bucket are the
  _same_ `vibld-control-plane` ones apps/web already binds (see
  `wrangler.jsonc`'s comment) -- one more table and one more key prefix, not
  a second database or bucket to provision.
- **`worker/index.ts`** -- routes two kinds of traffic on one Worker: an
  internal API (`/internal/publish` and `/internal/unpublish`, gated by a
  shared secret -- `internal-auth.ts`, the same shape apps/preview's own
  internal API uses) that apps/web calls once it has a project's
  _already-built_ static output ready to publish, or to take a published
  site off the web; and public, unauthenticated traffic for
  `*.published.vibld-preview.dev`, resolved by slug and served straight out
  of R2 with static-hosting fallback semantics.
- **`worker/slug.ts`** -- slug validation: a published slug becomes a DNS
  label, so it is checked as one (RFC 1035 shape, lowercase, a short
  reserved list) rather than accepted as free text.
- **`worker/resolve-path.ts`** -- the fallback order a request path is
  tried in: the literal path, then `path.html`, then `path/index.html` --
  the same "deep links and missing routes" concern ADR-0008 already raises
  for the generated template, applied here at serve time.
- **`worker/content-type.ts`** -- Content-Type by file extension. R2 holds
  no metadata of its own in this Worker's usage, so this is recovered from
  the path alone, same as any conventional static file server.

## Taking a site down

`POST /internal/unpublish` with `{userId, projectId}` (ADR-0013:
[`docs/adr/0013-preview-and-publish-as-separate-verbs.md`](../../docs/adr/0013-preview-and-publish-as-separate-verbs.md)).
apps/web reaches it through `DELETE /api/publish`, which resolves a Clerk
principal first; this Worker checks ownership again, because apps/web knows
who is asking and only the store knows whose slug this is.

Two things happen, in this order:

1. The row is marked `unpublished_at`. `resolveSlug` (public serving) then
   refuses it, so the address stops working immediately.
2. Every R2 object under `published/{slug}/` is deleted, paging through the
   cursor rather than assuming one `list` call sees them all.

A failure between the two leaves the site down with some objects still in
R2 under a prefix nothing resolves to, and a repeat of the call clears them.
The other order would fail the other way: content gone while the row still
says live, so the site reads as up and serves nothing.

**The slug is never released.** ADR-0010 makes it a durable, semi-public
identifier: somebody has linked to it. Deleting the row would return the
name to the pool, and the next person to claim it would be served at an
address the previous owner advertised -- worse than a dead link, and the
shape of a takeover. So the row stays, the owner keeps the name, nobody
else can claim it, and publishing again under that name is what puts the
site back.

## An operator taking a site down

`POST /internal/hold` with `{slug, by, reason}`, and `POST /internal/release`
with `{slug, by}` (#172, `0018_operator_hold.sql`, `0020_hold_history.sql`). apps/web reaches both through
`/api/admin/publish/hold` and `/api/admin/publish/release`, behind the
platform-admin check. There is no ownership check here, which is the point of
the route rather than a gap in it: the caller has already been established as
a platform admin, which is stricter than owning the site.

Named by slug because that is what a report carries: somebody sends an
address.

**It is not the owner takedown with a different caller.** Publishing again is
what clears `unpublished_at`, by design, and an operator hold the owner could
lift by pressing Publish would be no hold at all. So `held_at` is its own
column, promoting a revision leaves it alone, and `handlePublish` refuses
with 409 while it is set. Only `/internal/release` clears it.

**The bytes stay.** The harm is the content being reachable, and the flag
ends that the moment it is written. Deleting is irreversible, destroys what
was served before anybody has looked at it, and makes a hold placed in haste
on a wrong report impossible to undo. An operator acting in minutes on
somebody else's account should not be making the irreversible call.

**And the owner cannot delete them either**, which took three goes to get
right. The first cut refused an owner takedown when the read said held, and
the read and the deletion are two round trips, so a hold arriving between
them lost. The refusal is now part of the write (`AND held_at IS NULL`), and
the same condition is re-asked between each listing and the deletion that
follows it. Publishing had the same shape and needed the layout below to fix
it: a republish begun before the hold used to overwrite the held revision in
place.

**Releasing does not republish.** A site whose owner had also taken it down
stays down; clearing the hold returns the decision to whoever else has a say
in it. The reply's `state` says which of `live`, `down` or `held` the site
ended in, so the operator is told rather than left assuming.

`held_by` and `held_reason` are recorded because SECURITY.md calls
security-sensitive actions auditable, and a takedown of work that is not
yours is the clearest case of one. The reason is required, not optional: a
hold nobody can review later is the half of "auditable" that cannot be added
afterwards.

**The state is not the record.** The columns above are what serving and the
republish refusal read, and `release` clears them; a first cut of this left
that as the only evidence, so after an ordinary hold-then-release there was
nothing to say the site had ever been taken down, by whom or why. So the
record lives in `published_site_holds`, appended and never updated, and
`release` carries a `by` for the same reason `hold` does: lifting a hold is
as much an action somebody took as placing it. Each write is one batch with
the state change it records, so neither can land without the other.

## Revisions

Each publish writes `published/<slug>/<generation>/`, and
`published_projects.generation` names the one the public gets
(`0021_publish_generations.sql`). Three are kept; promoting a fourth drops
the oldest.

**The pointer is what publishes.** Files first, then the row, so a revision
nothing points at is invisible and a failure between the two leaves the
previous one serving. Promotion is a compare-and-set on `held_at IS NULL`,
which is what makes the hold unraceable: the decision happens after the
bytes have landed, where it can still be taken back, rather than before they
are written, where the writing has already happened by the time anybody
disagrees.

**Why not overwrite in place.** That is what this used to do, and it made
the write itself the moment of change. There was nothing to be conditional
about and nothing to roll back to: one bad publish and the last good one was
gone.

**Why three.** More than one so there is something to go back to, and not
everything because R2 is not free and nobody is reading the eleventh.

**A takedown removes all of them.** Retention is for getting back to a
revision of a site you still have. An owner saying the work should not be
here is a different request, and leaving two older copies behind would be
answering it wrongly.

## Why a separate package, not a folder in apps/web

Same first reason apps/preview gives for the same question: a published
site needs the isolated origin `vibld-preview.dev` already provides (ADR-0010
extends its existing cookie-isolation argument from ephemeral previews to
durable published output), which means a separate Worker regardless of
anything else. This package needs no container/Sandbox SDK, unlike
apps/preview, so it has no Docker build step at deploy time.

## What this does not do yet

`/internal/publish` itself only ever accepted already-built static files
(`ProjectFile[]`, the same shape apps/preview's `/internal/preview/start`
already takes) -- it has never run a build itself, by design (this
Worker's job is storing and serving, not building). `apps/web`'s
`POST /api/publish` now supplies that missing piece: it calls
apps/preview's `buildProject` first, then hands this Worker the result --
see `apps/web/README.md`'s "Cloudflare auto-publish" section for the full
path. `apps/web/worker/index.ts`'s `handlePublish` also gates that
endpoint with its own `PUBLISH_BURST` rate limit, the same shape
`PLAN_BURST` uses -- so the "no real caller yet to gate" reasoning this
section used to give is resolved.

Still not built, per ADR-0010's own scoping:

- The opt-in custom-domain step (the user's own pasted Cloudflare token).
- Storage quota per user/plan tier (only a request-rate limit exists so
  far, not a cap on how much R2 storage one account may occupy).
- Slug release/reclaim rules after a project is deleted. Taking a site
  down settles half of this and settles it as "never released" (below);
  what happens to the name when the whole project is deleted is still
  open.
- Rolling back to a _previous_ published checkpoint. Taking the site down
  and publishing again is what exists; restoring the version before this
  one needs the retention decision ADR-0013 left open (how many published
  revisions are kept, and for how long).
- Binary assets (images, fonts): `apps/preview`'s `buildProject` skips
  them rather than mis-serve them, since this Worker's own R2 usage is
  text-only today (see `publish-store.ts`'s module comment). A build that
  emits any reports which paths were skipped in its response.

## Deploying

**No new Cloudflare resources to create.** This Worker binds the exact
`database_id`/`bucket_name` apps/web's `wrangler.jsonc` already uses;
Cloudflare allows the same D1 database and R2 bucket to be bound into more
than one Worker. The **Deploy publish service** workflow applies any pending
`migrations/` file against that database (`wrangler d1 migrations apply
--remote`, run from apps/web since that is where the migrations directory
lives) before it deploys the Worker -- no manual step needed. (0002 and 0003
themselves went unapplied against production for two days before this
automation existed -- see apps/web/README.md's "Deploying" section.)

One-time: add a **`PUBLISH_INTERNAL_SECRET`** secret (a long random value,
distinct from `PREVIEW_INTERNAL_SECRET` -- a leak of one must not
compromise the other) to the **`preview`** environment under **Settings →
Environments**, the same one `apps/web` and `apps/preview` already use.

The Cloudflare API token needs **Workers Scripts: Edit** (already covers
this account) plus **DNS: Edit** on the `vibld-preview.dev` zone, for the
wildcard route -- the same permissions apps/preview's own token already
has, since it is the same zone.

Run the **Deploy publish service** workflow from the Actions tab
(`workflow_dispatch` only) before apps/web calls `/api/publish` for the
first time.

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/publish deploy
```
