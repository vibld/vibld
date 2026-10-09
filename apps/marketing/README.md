# @vibld/marketing

Vibld's own public site at [vibld.com](https://vibld.com) -- built on the
stack of the ADR-0008 marketing template (React Router framework mode,
static prerendering, Vite, TypeScript, Tailwind), the way
`docs/decisions.md`'s L21 requires: "The marketing site is its own Worker,
built from the ADR-0008 template." Generated projects do not use that stack:
they are a Vite single-page app with no router and no prerendering
(`packages/ai/src/stack.ts`, `scaffold.ts`).

It is a separate app from `templates/marketing` on purpose.
`templates/marketing` is the generic, MIT-licensed starter Vibld hands to
users and has to stay independent of Vibld (it is tested to build outside the
pnpm workspace, with no Vibld dependency and no mention of Vibld anywhere in
its output). This app is the opposite: it _is_ Vibld's own site, lives inside
the workspace, and is allowed to say so.

```bash
pnpm install
pnpm --filter @vibld/marketing dev        # http://localhost:5173
pnpm --filter @vibld/marketing build
pnpm --filter @vibld/marketing typecheck
pnpm --filter @vibld/marketing test
```

## What's here today

The "Live Build" design (approved 2026-09-27), in the brand's colors:

- **Home** (`app/routes/home.tsx`): a hero whose builder window assembles a
  small invented site in front of the reader (`components/LiveBuild.tsx`),
  then the seven-step flow, the styles, what you get, use cases, the plans and
  a sign-up link into the builder (`SITE.signUpUrl`). The builder is a demonstration drawn in the page and
  says so; it calls nothing. Its prerendered state is the finished build, and
  it only replays after hydration, for a reader who has not asked for reduced
  motion.
- **How it works**, **Features**, **Pricing** and **Use cases** (an index and
  one page per kind of project), each held to the guides under `/docs`.
  Pricing reads every figure from `apps/web/worker` (`app/plans.ts`): each
  plan's price from `PRICE_USD_CENTS` beside the Stripe lookup keys, and the
  model spend it includes from what the spend gate enforces, labeled apart so
  one cannot read as the other. `test/plans.test.ts` pins the prices to
  `docs/decisions.md` (L36, L38), and `turbo.json` in this directory makes a
  change to those files rebuild the site.
- **Examples** has a sample gallery (D153): one brief per kind of site,
  built in several styles, every one a real build. It ends with a separate,
  marked section of hand-built starter templates (`app/templates.ts`),
  after every generated example, so the page's "no hand edits" promise
  stays about the examples it is made of.
- **Templates** (`/templates`, `/templates/<group>` and
  `/templates/<group>/<subcategory>`): the design catalog by category and
  subcategory (D161, map in `packages/ai/src/design-categories.ts`), each a
  prerendered page, with the style gallery's entries as template cards
  under the website subcategory their industry names (D162). Their previews
  past the first page load from `/templates/style-cards/<n>.json`.
- **Style gallery** (`/styles/gallery` and `/styles/gallery/<id>`, D143):
  one page per complete style.
- **Styles**: every preset in `@vibld/ai/style-presets`, each drawn as a
  miniature site in HTML and CSS (`components/SiteMiniature.tsx`,
  `styles/miniature.css`). Presets with a palette are drawn only in their own
  pairs; surface treatments in one neutral demonstration palette, which the
  page says. `test/looks.test.ts` measures every pair.

- **Docs** (`/docs`, `app/routes/docs.*.tsx`): an index and one guide per
  page, in two tracks declared in `app/site.ts` (`DOC_TRACKS`,
  `DOC_GUIDES`): using the hosted builder, and running vibld yourself.
- **Roadmap** (`/roadmap`): the items in `app/roadmap.ts`, grouped by
  status, with a vote on everything not yet shipped. Votes go through
  `/api/roadmap/votes` and `/api/roadmap/vote` (`worker/roadmap-api.ts`),
  one per browser, with a per-address limit and Turnstile for a browser the
  Worker has not seen before.
- **Use cases** (`/use-cases` and `/use-cases/<slug>`): one route per entry
  in `app/use-cases.ts`, declared once per path so the prerender emits no
  SPA fallback.
- **Crawler files**, written after the build by `scripts/postbuild.ts` from
  `app/site.ts`: `robots.txt`, `sitemap.xml`, `llms.txt` and
  `llms-full.txt`, plus a `.zip` of each generated example for the
  examples page to link to.

Colors are the brand's aliases plus a few marketing-local tokens (six pale
tints, the code block, one green), declared in `app.css` and measured against
the brand's ink in `test/tokens.test.ts`.

Eight legal documents (L23), governed by Georgia law with venue in Gwinnett
County: Terms of Service (including a DMCA notice procedure), Privacy Policy,
Acceptable Use Policy, Security & Vulnerability Disclosure (plus
`/.well-known/security.txt`, RFC 9116), Subprocessors, Cookie Notice, Refund
Policy, and Open-Source Notices. `app/site.ts` is the single source for the
entity name, mailing address and every `@vibld.com` address they reference --
change it there, not in eight places.

These are boilerplate drafts, not legal advice. Have a Georgia attorney read
the Terms and Privacy Policy before the first payment is taken (see the
Refund Policy, which exists ahead of any billing on purpose).

## Brand (internal issue 7)

Deferred under D28(c) until "the product works" -- picked back up once it
did. Before drawing anything, the repository already had _two_
uncoordinated palettes: `apps/web`'s violet `theme.css` (the builder's own
product UI) and this app's warm `app.css` (already live on the coming-soon
page and in `public/favicon.svg`). Rather than invent a third, this
formalizes the second one -- the mark and palette that were already here,
just never assembled into an actual system:

- **Mark**: the checkmark-V path already in `public/favicon.svg`, unchanged.
  `SiteHeader` now renders it beside the wordmark instead of text alone.
- **Palette**: `--color-accent`/`--color-ink`/`--color-paper` etc., already
  in `app.css` -- no new colors introduced.
- **Type**: Bricolage Grotesque (display), Hanken Grotesk (body) and
  JetBrains Mono, chosen with the Live Build design and self-hosted from
  `public/fonts/`, each beside its family's license file, so the site still
  contacts no font service and the Cookie Notice stays true. Listed on
  `/legal/licenses`; cached for a year by the Worker because each filename
  carries its package version.
- **Social cards**: `public/og-image.png` (1200×630) and
  `public/apple-touch-icon.png` (180×180), both rendered locally from plain
  HTML/SVG at build time -- no generative image tool, nothing that touches
  the network. `metaFor()` in `app/site.ts` now emits `og:image` and
  `twitter:image` pointing at the former; every route gets it for free.
- **Repository link**: `SITE.repoUrl`, referenced from the homepage's new
  "View the code on GitHub" line.

`apps/web`'s own violet theme is untouched -- internal issue 7's acceptance
criteria scope this to the public brand expression, not product UI.

## The waitlist (retired)

`POST /api/waitlist` was retired in D168 (docs/decisions.md): no page had
rendered the waitlist form since the open beta, and the path now answers the
same 404 as any unknown `/api/` path. The addresses already collected stay as
contacts in the `vibld-waitlist` segment in Resend
(`6a463d34-31bc-4f24-ba0b-f30bfb5c7660`), the recipient list for the launch
email (`docs/launch-email.md`, which is not part of the public export).
Cloudflare Turnstile's server-side check moved to `worker/turnstile.ts`,
where the roadmap's vote uses it.

## Manual setup steps

- **Renew the DMCA agent designation** with the U.S. Copyright Office
  (`https://dmca.copyright.gov/osp/`) every three years. It is registered as
  DMCA-1081350, and `legal.terms.tsx` publishes that number.
- **Create the `@vibld.com` mailboxes** the footer and legal pages reference
  (`support`, `privacy`, `security`, `abuse`, `legal`, `billing`, `hello`) --
  wherever vibld.com's mail is hosted.
- **Verify a sending domain in Resend** (`notifications.vibld.com` or
  `mail.vibld.com`) before the launch email (docs/launch-email.md) is sent.

## Deploying

One-time: create a **`marketing`** environment under **Settings →
Environments**, and add `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit + DNS:
Edit on the `vibld.com` zone, for the custom-domain routes),
and `CLOUDFLARE_ACCOUNT_ID` to it -- the same pattern
`apps/web`'s README documents for its `preview` environment. Then run the
**Deploy marketing site** workflow from the Actions tab
(`workflow_dispatch` only).

`TURNSTILE_SECRET_KEY` is optional on the same environment: add it to turn
on server-side verification of the Turnstile token on `/api/roadmap/vote`
(the public site key needs no secret handling -- it's a plain constant in
`app/site.ts`). It's on the same Cloudflare Turnstile page the site key came
from. Without it, `/roadmap` still shows its counts but refuses a browser's
first vote.

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/marketing build
pnpm --filter @vibld/marketing deploy
```
