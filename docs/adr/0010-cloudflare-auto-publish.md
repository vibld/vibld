# ADR-0010: Cloudflare auto-publish for exported projects

- Status: Proposed
- Date: 2026-09-11
- Decision owners: maintainers
- Refines: ADR-0002, ADR-0005, ADR-0008

## Context

`docs/decisions.md` L40 already resolved the shape of this feature: a scoped
Cloudflare API Token the user pastes in (not OAuth), held in Cloudflare
Secrets Store, Cloudflare-only for now, with a **Vibld-provided subdomain
publish as the primary path** -- working with no action from the user beyond
pasting a token once -- and a full custom domain as an opt-in second step.
What L40 left open, explicitly: "the actual scheme will hang off `vibld.com`
or `vibld-preview.dev`, decided when this is built."

That question turns out to bundle two different design decisions, and
resolving it well means separating them:

1. **What actually serves a published site**, and whose Cloudflare account
   it runs in.
2. **Which hostname it serves from**, and whether that hostname can safely
   share a registrable domain with anything else Vibld already runs there.

On (2): `apps/preview` already resolved the same question for the _live
iteration_ preview, and did not put it on `vibld.com` -- L8 put ephemeral
preview traffic on a second registrable domain, `vibld-preview.dev`,
specifically so a preview (which runs arbitrary, unreviewed generated code)
never shares cookie scope with the control plane at `app.vibld.com`
(Clerk's session cookie included). A durable published site carries the
exact same property -- arbitrary generated code, served under a
Vibld-controlled hostname, indefinitely -- so the same isolation argument
applies. `vibld-preview.dev` is the domain that already exists for this
reason; `vibld.com` is not.

On (1): the L40 language ("a scoped API Token... stored in Cloudflare
Secrets Store... primary path is a Vibld-provided subdomain") reads as if
the user's token deploys the primary path, but it does not need to. A
Vibld-owned subdomain can only be served from infrastructure Vibld
controls -- a customer's Cloudflare account has no path to originate traffic
for a zone Vibld owns. So the primary path needs no user credential at all;
the user's token is only load-bearing for the opt-in custom-domain step,
where Vibld must act inside a zone it does not own.

## Decision

**Primary path -- Vibld subdomain, no user credential required.**

Published projects are static build output (ADR-0002, ADR-0008: the first
generated-app template is a portable, conventionally-buildable static site;
nothing in that contract requires a live server per project). Serve them
from a single Worker in Vibld's own Cloudflare account -- the account CI
already deploys `apps/web`, `apps/preview` and `apps/marketing` into -- bound
to a wildcard route on the existing `vibld-preview.dev` zone:

```
{ "pattern": "*.published.vibld-preview.dev/*", "zone_name": "vibld-preview.dev" }
```

The `published.` label is deliberate: it cannot collide with `apps/preview`'s
own ephemeral hostname shape (`{port}-{sandboxId}-{token}.vibld-preview.dev`,
which never inserts a third-level label), so one zone safely serves both
without ambiguity about which Worker a request belongs to.

The Worker resolves the project slug from the `Host` header, looks up a slug
→ owner/R2-prefix mapping (a small D1 table -- reuse the pattern
`PreviewFleet` already established for a single durable coordination point),
and serves that project's build output from R2. Publishing an export means:
build, then upload the output to `r2://vibld-published/<slug>/...` and
upsert the slug mapping -- a normal authenticated call from `apps/web` into
this new Worker over a service binding, the same shape `apps/preview`'s
`/internal/*` routes already use (`internal-auth.ts`), not a new trust
model. No Cloudflare credential of the user's is read or stored for this
path; it runs entirely on credentials Vibld already holds.

Slug allocation follows the project: first publish claims the slug (checked
for availability, not user-chosen out of a global namespace fought over by
strangers), later publishes to the same project overwrite the same slug's
R2 prefix. A user may not reuse a slug already claimed by another project.

**Opt-in second step -- the user's own domain.**

Only this step touches the user's Cloudflare account, and only for users
who ask for it. The user pastes a scoped API Token (Workers Routes: Edit,
DNS: Edit, restricted to the one zone they name) that Vibld stores in
Cloudflare Secrets Store, never in D1 or in a log. Vibld uses it to add a
DNS record in the user's own zone (a CNAME to their project's
`<slug>.published.vibld-preview.dev`, or a Cloudflare for SaaS custom
hostname pointed at the same target, whichever proves simpler once
implemented against the real API) plus the matching Worker Route so the
existing publish Worker also answers on the custom domain. Nothing about
serving changes: the same Worker, the same R2 lookup, one more Route
pointed at it. The token is used at configuration time only, not held open
for every request the custom domain serves.

**What is explicitly out of scope for this ADR:**

- Vercel/Netlify (L41) -- same subdomain/credential split, a separate ADR
  once this one is proven.
- Workers for Platforms dispatch namespaces (one script per project) -- the
  right mechanism once published projects need to run actual server code
  per request rather than serve static build output; not needed for the
  current template and adds account-level script-count/billing surface
  this ADR does not need to take on yet.
- Automatic domain registration on the user's behalf -- no such flow exists
  or is proposed; "custom domain" here always means a domain the user
  already owns and has already put on Cloudflare.

## Consequences

**New abuse surface, addressed like every other mutating endpoint in this
codebase.** Publishing is a new authenticated, rate-limited action with a
real infrastructure cost (R2 storage plus a public origin serving
indefinitely) -- it needs its own per-user and per-IP gates in the same
`PLAN_BURST`/`PLAN_SUSTAINED`/`IP_BURST` shape `handlePlan` already uses
(L29), not a bespoke one. A published project also needs a storage quota
per user/plan tier, analogous to the existing generation-spend ledger, so
one account cannot fill R2 unbounded.

**Credential blast radius is bounded by design, and only for users who opt
in.** A leaked custom-domain token grants DNS/Route edit on exactly the one
zone the user named -- not their whole Cloudflare account, not billing, not
other zones. Cloudflare Secrets Store keeps it out of D1 and out of Worker
logs; token rotation/revocation is the user's own Cloudflare dashboard
action, same as revoking any other scoped API token. The primary path has
no such surface at all: it holds no third-party credential.

**A slug is a durable, semi-public identifier.** Unlike a preview's
opaque, time-boxed hostname, a published slug is meant to be shared and
remembered, so slug squatting/reuse rules (claimed by first publish, tied
to the project, not released back into a free-for-all pool on project
deletion without a cooldown) need to be nailed down before this ships, to
avoid a deleted project's old slug being immediately reclaimed by an
unrelated party.

**This ADR does not resolve L42c's underlying tenancy question by itself.**
L42c already accepted "Vibld may hold deploy hooks/credentials for users,
specifically to run the L40 flow" -- this ADR proposes the mechanism, it
does not reopen whether Vibld should do so.

## Alternatives considered

- **Deploy into the user's own Cloudflare account for the primary path
  too** (one Worker script per project, in their account, using their
  token from the first publish onward): matches a literal reading of L40's
  prose, but makes the "primary, zero-friction path" require a credential
  up front -- the opposite of what L40 actually weighted for. Rejected;
  kept as the shape of the _custom-domain_ step instead, where a
  credential is unavoidable because the target zone is genuinely the
  user's.
- **Serve published sites from `*.vibld.com` instead of
  `vibld-preview.dev`.** Simpler to say, but reopens exactly the
  cookie-scope isolation problem L8 already solved for the ephemeral
  preview case, for a workload (arbitrary, long-lived generated code) that
  carries the same risk. Rejected without a concrete reason `app.vibld.com`
  or `vibld.com`'s cookies would be safe to share.
- **Cloudflare Pages** instead of a Worker + R2: Cloudflare is
  consolidating Pages into Workers Static Assets, and every other
  component in this codebase (ADR-0005) is already a Worker; a second
  hosting primitive adds an operational path with no offsetting benefit
  here.
- **Workers for Platforms dispatch namespace per project** now, rather
  than later: gives each published project its own script and per-script
  limits/billing, which is real isolation, but is unneeded complexity
  while every published project is static build output with no per-request
  server logic. Revisit when a template needs one.
