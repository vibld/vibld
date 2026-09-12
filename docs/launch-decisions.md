# Open decisions: previews, accounts, billing, marketing site, security

Status: **answered 2026-09-09.** The accepted choices are recorded in
[`decisions.md`](decisions.md#launch-decisions-accepted-2026-09-09), including
four that moved off the recommendation below (L15, L33, L40, L42c) and a
handful still open (the L9 concurrency cap, L40's credential-vault
qualifiers, and the new generation pattern/style/SEO catalogue). This
document stays as the rationale and options record; it is not being kept in
sync item-by-item -- `decisions.md` is the source of truth for what was
chosen.

Every item below is a choice I cannot make for you, or a choice I can make but
that costs money or changes an accepted decision in [`decisions.md`](decisions.md).
Each has a recommendation. Answer by ID (`L3 b`, `L11 as recommended`); anything
you skip, I will build as recommended.

Decisions D1-D30 are already accepted and are not reopened here, except where a
line says explicitly that it amends one.

---

## A. Accounts and identity

Today there are no accounts. Cloudflare Access is the only thing standing
between the internet and the model budget: the ledger is keyed on
`access.email` and the rate limits on `plan:${access.email}`, so removing Access
without replacing it gives every visitor one shared $4/day bucket.

### L1 - Clerk replaces Supabase Auth for the Vibld platform

**Amends D30.** D30 chose Supabase Auth, on the assumption the platform ran on
Supabase Postgres. Clerk is a different bet: hosted sign-in UI, organisations,
MFA and password reset that we never own.

- (a) **Clerk for the Vibld platform. D23 is untouched -- Supabase remains the
  recommended backend for the applications Vibld generates.** _(recommended)_
- (b) Keep Supabase Auth as D30 says.

D23 and D30 are separable and should stay separable: what signs a customer in to
Vibld is not what signs an end user in to the app Vibld generated for them.

### L2 - Session verification in the Worker

- (a) **Verify the Clerk session JWT against the cached JWKS inside the Worker
  (`@clerk/backend`), no network call per request.** _(recommended)_
- (b) Call Clerk's API to verify each request.

(b) puts a third-party outage in the path of every request and adds latency to
every generation.

### L3 - What the budget ledger is keyed on

Today: email. Email is mutable and can be reassigned; a Clerk user id cannot.

- (a) **Key `USER_BUDGET`, rate limits and every ownership row on the Clerk user
  id. Email becomes display only.** _(recommended)_
- (b) Stay on email.

There is no production data, so this is free to do now and expensive later.

### L4 - Platform admins

You asked for a GitHub secret with a comma-separated list of emails. That works
and matches how `VIBLD_MODEL_POLICY` is already synced to the Worker by the
deploy workflow -- no console step, no terminal command.

- (a) **`VIBLD_PLATFORM_ADMINS` as a GitHub Actions secret, comma-separated
  emails, synced to a Worker secret on deploy. An email grants admin only when
  Clerk asserts it is a verified primary address.** _(recommended)_
- (b) Same, but the list holds Clerk user ids instead of emails.
- (c) Clerk organisation roles instead of a secret.

(a) has the property that matters: admin cannot be granted from inside the
running application, only by someone who can push to this repository. The
verified-primary-address condition is what stops an unverified `chris.brock@…`
claim from minting an admin. (c) is worth adding later for delegated admins, but
it cannot bootstrap itself.

### L5 - When Cloudflare Access comes off

- (a) **Access stays until Clerk sign-in _and_ the abuse controls in L20 are
  both live. Then Access is removed in the same deploy that turns on public
  sign-up.** _(recommended)_
- (b) Remove Access as soon as Clerk lands.

(b) opens a window where the whole internet shares one $4/day budget.

### L6 - Who may sign up at launch

D4 says invitation-only hosted alpha.

- (a) **Clerk waitlist mode: anyone can request access, only allowlisted emails
  can sign in. You approve from the Clerk dashboard or by the admin list.** _(recommended)_
- (b) Open sign-up with the free-tier limits doing the containment.

---

## B. Ephemeral sandbox previews

### L7 - Sandbox runtime

- (a) **Cloudflare Sandbox SDK / Containers, as D5 already says.** _(recommended)_
- (b) E2B or Daytona.
- (c) Fly Machines.

Sticking with D5 keeps one vendor, one bill and one identity model. It requires
the Workers Paid plan and Containers -- a paid-infrastructure decision, so it
needs your explicit yes (see L27).

### L8 - Preview origin

D17 requires previews on an isolated origin.

- (a) **A second registrable domain, e.g. `vibld-preview.dev`, one subdomain per
  preview.** _(recommended)_ ~$10-15/yr.
- (b) `*.preview.vibld.com`.

(b) shares the registrable domain with the control plane, so a preview shares
cookie scope with `vibld.com`. Untrusted generated code runs in those previews
(ADR-0004). (a) is the only option that makes the isolation real.

### L9 - Preview lifetime and concurrency numbers

`decisions.md` defers these to implementation. Proposed:

| Limit                                       | Proposed   |
| ------------------------------------------- | ---------- |
| Idle timeout                                | 10 minutes |
| Hard lifetime                               | 30 minutes |
| Concurrent previews per user                | 1          |
| Concurrent previews per account (all users) | 10         |

Change any number, or accept as proposed.

### L10 - Preview sharing

- (a) **Private by default; sharing is a signed, revocable, time-limited URL
  (D17 as written).** _(recommended)_
- (b) Viewers must sign in to Vibld to open a shared preview.

### L11 - Sandbox network egress

- (a) **Deny by default; allow the package registry only. No model-provider
  credentials and no control-plane credentials reach the sandbox (ADR-0006).** _(recommended)_
- (b) Open egress.

The sandbox runs code an untrusted prompt produced. (b) makes every preview an
outbound proxy for whoever wrote the prompt.

---

## C. Stripe

### L12 - Integration surface

- (a) **Stripe-hosted Checkout + Billing Portal.** _(recommended)_
- (b) Stripe Elements embedded in the app.

(a) keeps card data entirely off our origin and keeps PCI scope at SAQ-A.

### L13 - Where entitlement is read from

- (a) **Stripe webhooks mirror subscription state into our database; the app
  reads our copy; a nightly reconcile against Stripe corrects drift.** _(recommended)_
- (b) Query Stripe on each request.

### L14 - Clerk-to-Stripe linkage

- (a) **We own the mapping: Clerk user id in `client_reference_id` and on the
  Stripe customer's metadata.** _(recommended)_
- (b) Clerk Billing (Clerk's built-in Stripe integration).

(b) is faster to stand up but constrains the pricing model to what Clerk
supports, and the model in L21 is metered.

### L15 - Sales tax

SaaS is generally not taxable in Georgia, but roughly twenty other states tax it
and economic nexus is a per-state threshold, not a choice.

- (a) **Stripe Tax on from the first paid invoice** (+0.5% per transaction). _(recommended)_
- (b) Off; revisit at volume.

Retrofitting tax onto invoices already issued is the expensive version.

### L16 - Legal entity on invoices, terms and the privacy policy

Your Resend account has `chrisbrockllc.com` verified, so I assume **Chris Brock
LLC**, a Georgia LLC. I need, and cannot obtain:

- the exact registered entity name
- a mailing address that may appear publicly (CAN-SPAM requires one in every
  marketing email; privacy laws require one for data-subject requests). A
  registered-agent or PO Box address is fine and is what I would use rather than
  a home address.
- which of `privacy@`, `security@`, `abuse@`, `legal@`, `support@` you want live
  on vibld.com

---

## D. Email capture and Resend

Your Resend account exists and has ten verified domains. `vibld.com` is not one
of them.

### L17 - Sending domains

- (a) **Two subdomains: `notifications.vibld.com` for transactional (sign-in,
  receipts, build failures) and `mail.vibld.com` for marketing. Separate Resend
  domains, separate reputations.** _(recommended)_
- (b) One domain for everything.

Under (b), one spam complaint on a launch announcement degrades delivery of
password-reset mail. DNS records for both can be created by the deploy pipeline;
no console step for you.

### L18 - Marketing consent

- (a) **Double opt-in on the waitlist and any marketing list.** _(recommended)_
- (b) Single opt-in.

CAN-SPAM does not require double opt-in; deliverability and any EU visitor do.

### L19 - DMARC policy at launch

- (a) **Start `p=none` with reporting, move to `p=quarantine` after two weeks of
  clean reports, then `p=reject`.** _(recommended)_
- (b) `p=reject` immediately.

---

## E. Marketing site at vibld.com

**vibld.com is already registered at Cloudflare Registrar and already on
Cloudflare nameservers.** The zone has no records. Nothing is needed from a
registrar; `wrangler` creates the DNS records itself when the Worker declares a
custom domain, so this is entirely automatable from the deploy workflow.

### L20 - Hostnames

- (a) **`vibld.com` and `www.vibld.com` serve the marketing site; the builder
  lives at `app.vibld.com`.** _(recommended)_
- (b) One Worker serves both, builder at `vibld.com/app`.

(a) means a marketing deploy can never break the product, and cookie scope for
the app never covers the public pages.

### L21 - Marketing site is a separate Worker

- (a) **Separate Worker, built from the ADR-0008 marketing template, deployed by
  its own workflow.** _(recommended)_
- (b) Add routes to the existing Worker.

### L22 - Coming-soon scope

Proposed for the first deploy: wordmark, the line _Vibe. Build. Ship._, one
paragraph, a waitlist email field writing to a Resend audience, and a footer
linking the legal pages. Confirm the tagline and tell me if anything is missing.

### L23 - Which legal pages, and how far I go

I will draft, in plain language, governed by Georgia law with venue in Gwinnett
County: **Terms of Service, Privacy Policy, Acceptable Use, Security &
Vulnerability Disclosure (plus `/.well-known/security.txt`), Subprocessors,
Cookie Notice, Refund Policy, Open-Source Notices** (covering the Apache-2.0
core and MIT templates of D24).

Two that depend on your answer:

- **DMCA policy + registered agent.** Needed once users publish content through
  us. Registering an agent with the US Copyright Office costs $6 and is a form
  only you can sign. (a) **register and publish the policy** _(recommended)_
  (b) defer until publishing ships.
- **EU/UK customers at alpha.** Accepting them means publishing a DPA, naming
  subprocessors with transfer mechanisms, and possibly an Article 27
  representative. (a) **US-only at alpha, stated in the Terms** _(recommended)_
  (b) accept EU/UK from day one and I draft the DPA.

These are boilerplate written by an engineer, not legal advice. Have a Georgia
attorney read the Terms and Privacy Policy before you take the first payment;
the rest can ship as drafted.

---

## F. Hosting we do not yet have

### L24 - The control-plane database

Nothing persists today. Accounts, the Stripe mirror, projects, checkpoints, the
waitlist and the audit log all need somewhere to live.

- (a) **Cloudflare D1 for the control plane at alpha, with R2 for project
  content. D23 unchanged: Supabase stays the recommendation for generated apps.**
  _(recommended -- amends D30's database half)_
- (b) Supabase Postgres + Hyperdrive as D30 says.
- (c) Neon.

(b) adds a second vendor, a second bill (~$25/mo for a Postgres instance that
does not pause), a connection-pooling layer and cross-cloud latency, to store a
few thousand small relational rows. If we later need vector search for D13,
Vectorize covers it without Postgres. If D13's semantic index arrives and wants
`pgvector` specifically, that is the moment to revisit -- one migration of a
small schema, not a foundational bet.

### L25 - Object storage

R2 for project content, checkpoints and export archives. Already implied by D6;
confirming because it is new spend (~$0.015/GB-month, no egress fees).

### L26 - Durable generation

ADR-0007 wants generation to survive a disconnect.

- (a) **Cloudflare Workflows now, in the same change as sandboxes.** _(recommended)_
- (b) Keep the current in-request streaming until after launch.

### L27 - Paid infrastructure approval

You told me not to enable paid infrastructure silently. What the above requires:

| Item                                                                | Cost                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Workers Paid (needed for Containers and additional Durable Objects) | $5/mo                                                                                                          |
| Containers (sandbox previews)                                       | usage; expect single-digit cents per preview session -- I will confirm against current pricing before enabling |
| R2                                                                  | $0.015/GB-month, no egress fees                                                                                |
| D1                                                                  | free tier covers alpha                                                                                         |
| vibld.com                                                           | already paid, renews 2027-09-06                                                                                |
| Preview domain (L8)                                                 | ~$10-15/yr                                                                                                     |
| Clerk                                                               | free to 10,000 monthly active users                                                                            |
| Stripe                                                              | 2.9% + $0.30, plus 0.5% if L15(a)                                                                              |
| Resend                                                              | account exists; free to 3,000 emails/mo                                                                        |
| Sentry                                                              | free tier                                                                                                      |

**Fixed floor is about $5/month plus one domain.** Everything else scales with
use. Say yes to this table, or name the lines you want left off.

---

## G. Security

### L28 - Do we need RLS?

Row-level security is what protects a database that untrusted clients can reach
directly with a user-scoped token -- Supabase's PostgREST model. Under L24(a)
the only client of the control-plane database is our Worker, so RLS has nothing
to enforce that the Worker is not already enforcing, and D1 does not offer it.

My recommendation, in three parts:

1. **Control plane: no RLS. Instead, every read and write goes through one
   authorisation choke point, and a test asserts that no query path bypasses
   it.** A single enforced function is auditable; RLS on a database only we can
   reach is ceremony.
2. **If you choose L24(b) (Supabase), then RLS is required** -- enable it
   deny-by-default on every table even though we hold the service key, because
   the failure mode of a leaked anon key is total.
3. **Generated applications: RLS is mandatory in the Supabase template.** This
   is where it genuinely matters and where users will otherwise ship a public
   database. Vibld should refuse to generate a Supabase-backed app with RLS off.

### L29 - Abuse controls before public sign-up

Proposed as a set, all recommended: Cloudflare Turnstile on sign-up and on
anonymous generation; a WAF rate limit per IP in front of `/api/*`; disposable
email domains blocked at sign-up; the existing per-user daily ceiling and
in-flight cap retained; an account-wide daily ceiling added above them so one
compromised account cannot spend the month.

### L30 - Webhook verification

Stripe, Clerk (Svix) and the GitHub App each sign their webhooks. All three
verified with a replay window, no exceptions, rejected before the body is
parsed. Recommended; flagging it only so it is on the record.

### L31 - Do we store user API keys at alpha?

- (a) **No. No BYOK storage until the credential vault D16 requires actually
  exists.** _(recommended)_
- (b) Accept keys now and encrypt them in D1.

`decisions.md` already says Cloudflare secrets are not a user-secret vault. (b)
is the decision that turns a breach into a disclosure event. Note that BYOK in
the self-hosted build needs no vault at all -- the key is the operator's own
environment variable, and they are the only user. See L45.

### L32 - Data retention after account deletion

- (a) **Project content purged 30 days after deletion; audit log entries kept 12
  months with the user id replaced by a tombstone.** _(recommended)_
- (b) Different numbers -- tell me which.

Whatever you pick goes verbatim into the Privacy Policy.

### L33 - What we do not need

SOC 2, a penetration test and a bug bounty are not alpha requirements and I am
not going to propose them. Say so if you disagree.

---

## H. Funding model spend

**Settled: no auto-purchase.** You will rely on the console auto-reload in each
provider account. That is also the only thing available -- neither Anthropic nor
DeepSeek exposes an API to buy credits, and a subscription-triggered top-up
would fire at the wrong moment anyway: on signup rather than on low balance.

What is left is how the hosted product pays for model calls, and whether we
watch the balance ourselves.

### L34 - How hosted model access is funded

- (a) **One shared platform key per provider. Our own credit ledger stops a user
  before their spending reaches the provider bill.** _(recommended)_
- (b) Hosted BYOK: each user supplies their own key. See L45 -- this belongs to
  the self-hosted build, not the hosted product.
- (c) A per-user Anthropic workspace and key through the Admin API. Gives
  per-user caps enforced by Anthropic, but makes every signup an Anthropic API
  call and still cannot buy credits.

### L44 - Do we watch the provider balance ourselves?

Auto-reload prevents an outage; it does not tell you when spending changes
shape. DeepSeek exposes `GET /user/balance`; Anthropic exposes an Admin API cost
report.

- (a) **A scheduled Worker reads both daily and emails you through Resend when
  either crosses a threshold you set.** _(recommended)_
- (b) No alerting; the provider consoles are enough.

## I. Subscription structure

D21 constrains this and it is worth stating plainly: **saving, Git, BYOK and
export are not paid gates.** So the paid line cannot be "export costs money".
What we sell is our model spend, hosted previews, and managed operation.

### L35 - Denomination

- (a) **An internal credit is 1¢ of model spend. The user sees a plain
  "generations remaining" number that reflects the model they chose.** _(recommended)_
- (b) Flat "N builds/month" regardless of model.

(b) is simpler to market and loses money the moment someone picks Opus: measured
today, a run costs $0.10 on `deepseek-v4-flash`, $0.31 on `deepseek-v4-pro` and
$1.81 on `claude-opus-5` -- an 18x spread that a flat count cannot absorb.

### L36 - Tiers

Proposed, sized so included model spend is roughly 35-40% of price:

| Tier   | Price  | Included model spend | ≈ runs (flash / pro / Opus) | Also                                                            |
| ------ | ------ | -------------------- | --------------------------- | --------------------------------------------------------------- |
| Free   | $0     | $1/mo                | 10 / 3 / 0                  | flash only; ZIP + GitHub export; BYOK; 10-min previews          |
| Build  | $29/mo | $10/mo               | 100 / 32 / 5                | all models; 30-min previews; custom preview links               |
| Ship   | $99/mo | $40/mo               | 400 / 129 / 22              | priority sandboxes; deploy to your own host; higher concurrency |
| Top-up | $20    | $8                   | 80 / 25 / 4                 | expires 12 months from purchase                                 |

Free includes export deliberately -- D21 requires it, and it is also the funnel:
someone who has exported a working project is who buys Build. Whether BYOK also
appears here is L45.

### L37 - Overage behaviour

- (a) **Hard stop at the allowance with one-click top-up.** _(recommended)_
- (b) Auto-charge overage.

(a) matches the existing daily ceiling and means no customer ever gets a
surprise invoice -- which is also the support burden we avoid.

### L38 - Annual billing

- (a) **Annual at 2 months free (Build $290, Ship $990).** _(recommended)_
- (b) Monthly only at launch.

### L39 - Is Opus in a tier at all?

- (a) **Yes, drawn from the same allowance, spending it ~18x faster. The model
  picker already shows the cost.** _(recommended)_
- (b) Opus on Ship only.
- (c) Opus only via BYOK.

---

## J. Export and deployment

ZIP export ships today. GitHub push is planned in [#64](https://github.com/vibld/vibld/pull/64),
which is still waiting on three answers.

### L40 - "Sync with Cloudflare Workers"

- (a) **We push to the user's GitHub repository with a committed
  `wrangler.jsonc`; the user connects that repository to Workers Builds once, in
  their own Cloudflare account. Every later push rebuilds. Vibld holds no
  Cloudflare credentials for anyone.** _(recommended)_
- (b) Vibld deploys into the user's Cloudflare account via OAuth.

(a) is ADR-0006 and ADR-0002 working as designed: the user's project is a
conventional repository that a conventional host builds, and losing Vibld does
not cost them their deployment. (b) makes us a holder of other people's
infrastructure credentials, which is the thing D16 was written to avoid.

### L41 - Other hosts

Same pattern, so the only work per host is a committed config file: `vercel.json`,
`netlify.toml`, `Dockerfile`, `.do/app.yaml`.

- (a) **Cloudflare, Vercel and Netlify at launch; DigitalOcean and a container
  path after.** _(recommended)_
- (b) All at once.

### L42 - #64's three open questions

- GitHub App permissions: Contents, Pull requests, Metadata only. _(recommended)_
- A Vultr Kubernetes/registry template in phase 3: **no**, unless you have a
  specific reason -- it is the only target that needs infrastructure rather than a
  config file.
- Phase 4, Vibld holding deploy hooks for users: **no.** Same objection as L40(b).

### L43 - Git history in an exported repository

- (a) **One initial commit for the first export, then one commit per accepted
  checkpoint thereafter.** _(recommended)_
- (b) Squash to a single commit every time.

---

## K. The open-source build and self-hosting

Hosted first; the public Apache-2.0 build for self-hosters with BYOK follows
once the hosted product is dialled in. The repository is already public and
already Apache-2.0 (D24), so this is about what the self-hosted build _is_, not
about licensing. D21 requires the complete single-user builder to work without
Vibld Cloud, and the README already flags that the self-hosting path is
unvalidated.

### L45 - Is BYOK offered in the hosted product?

D21 says BYOK must not be an artificial paid gate. The self-hosted build
satisfies that: a self-hoster puts their own key in their own environment and
pays us nothing.

- (a) **BYOK is the self-hosted story. The hosted product sells credits only --
  simpler billing, one support path, and no user keys to hold (L31).** _(recommended)_
- (b) Hosted BYOK as a cheap tier: a flat platform fee, user's key, no credits.
- (c) BYOK on the hosted free tier.

This changes the Free row in L36: under (a) it offers export but not BYOK.

### L46 - How the self-hosted build authenticates

Clerk is a hosted service with an account and a bill. A single developer running
Vibld on their own machine should not need one.

- (a) **No auth by default for a single-user local install; Clerk switched on by
  the presence of its environment variables, which is how the hosted deploy
  configures itself.** _(recommended)_
- (b) A single shared token in an environment variable.
- (c) Clerk required in both.

The same pattern already works for the model provider: the code picks a provider
from which keys are present.

### L47 - Previews in the self-hosted build

Cloudflare Containers needs a paid Cloudflare account, which a self-hoster may
not have. ADR-0004 already defines an execution-adapter interface.

- (a) **A local adapter -- Docker or a child process on the developer's own
  machine -- shipped alongside the Cloudflare one, so the OSS build previews
  without a Cloudflare bill.** _(recommended)_
- (b) Self-hosted builds get no preview until someone asks for one.

(a) is also what validates the adapter boundary D5 asked us to preserve; without
a second implementation it is an untested claim.

### L48 - Where hosted-only code lives

- (a) **One public repository. Billing, entitlement and tenancy code ships in
  the open and is inert without the secrets; the moat is the operation, not the
  source.** _(recommended)_
- (b) A private repository for billing and tenancy, public core.

(b) means every change that touches both is two pull requests, and D21's
"complete single-user builder in OSS" gets harder to honour, not easier.

### L49 - When the self-hosted build is announced

- (a) **Tag v0.1.0 once the hosted alpha is stable _and_ a clean checkout has
  been proven to build, run and generate with only a provider key -- verified in
  CI, not by hand.** _(recommended)_
- (b) Announce alongside the hosted launch.

(b) means the first self-hosting bug report is also the first time anyone tried
it.

## What only you can do

Everything else is automatable from this repository. These are not:

| What                                                                                                              | Where                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Create the Clerk application, then add its keys as GitHub secrets -- the deploy workflow syncs them to the Worker | https://dashboard.clerk.com/apps/new                    |
| Create the Stripe account and add the secret + webhook signing secret as GitHub secrets                           | https://dashboard.stripe.com/register                   |
| Enable the Workers Paid plan (needed for Containers)                                                              | https://dash.cloudflare.com/?to=/:account/workers/plans |
| Register the DMCA agent, if L23 (a)                                                                               | https://dmca.copyright.gov/osp/                         |
| Tell me the exact legal entity name, public mailing address, and which `@vibld.com` mailboxes to create           | --                                                      |

GitHub secret names, once you have the values:
`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
`VIBLD_PLATFORM_ADMINS` -- added at
https://github.com/vibld/vibld/settings/secrets/actions

## Order I would build it in

1. Marketing site at vibld.com with the waitlist and legal pages (L20-L23) -- no
   dependency on anything else, and it is the thing that is publicly missing.
2. Control-plane database and R2 (L24, L25) -- everything below needs it.
3. Clerk, admin list, ledger re-keyed to user id (L1-L4, L6), Access removed
   last (L5) once abuse controls (L29) are in.
4. Stripe and the credit ledger (L12-L15, L35-L39).
5. Ephemeral sandbox previews (L7-L11, L26).
6. GitHub push and host configs (L40-L43), which is #64 unblocked.
7. The local execution adapter and a CI-verified clean-checkout run (L46, L47,
   L49), then tag v0.1.0 and announce self-hosting.
