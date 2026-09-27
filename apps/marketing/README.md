# @vibld/marketing

Vibld's own public site at [vibld.com](https://vibld.com) -- built from the
same stack ADR-0008 chose for generated marketing sites (React Router
framework mode, static prerendering, Vite, TypeScript, Tailwind), the way
`docs/decisions.md`'s L21 requires: "The marketing site is its own Worker,
built from the ADR-0008 template."

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

The "Live Build" design (approved 2026-09-27), in the brand's colours:

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
  model spend it includes from what the spend gate enforces, labelled apart so
  one cannot read as the other. `test/plans.test.ts` pins the prices to
  `docs/decisions.md` (L36, L38), and `turbo.json` in this directory makes a
  change to those files rebuild the site.
- **Examples** ends with a separate, marked section of hand-built starter
  templates (`app/templates.ts`), after every generated example, so the
  page's "no hand edits" promise stays about the examples it is made of.
- **Styles**: every preset in `@vibld/ai/style-presets`, each drawn as a
  miniature site in HTML and CSS (`components/SiteMiniature.tsx`,
  `styles/miniature.css`). Presets with a palette are drawn only in their own
  pairs; surface treatments in one neutral demonstration palette, which the
  page says. `test/looks.test.ts` measures every pair.

Colours are the brand's aliases plus a few marketing-local tokens (six pale
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
  `public/fonts/`, each beside its family's licence file, so the site still
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

## The waitlist

**No page renders the waitlist form any more.** vibld launches as an open
public beta (docs/decisions.md, resolved 2026-09-27), so every call to action
links to the builder's sign-up form instead and `WaitlistForm.tsx` was
removed. Deploy this site only once the builder is open (`apps/web/README.md`,
"Opening the beta"): until then its sign-up links lead to a closed door. The
endpoint below is left in place, unchanged, and the addresses already
collected stay in the Resend segment; they are the recipient list for the
launch email (`docs/launch-email.md`, which is not part of the public
export).

`/api/waitlist` (`worker/index.ts`) is a real endpoint, not a demonstration:
it validates the submission (`worker/waitlist.ts`, tested without a Workers
runtime -- the same pattern `apps/web/worker/spend.ts` uses) and adds the
email to the `vibld-waitlist` segment in Resend via their contacts API. A
hidden honeypot field catches simple bots, and Cloudflare Turnstile
(docs/decisions.md L29) sits in front of both submission paths: the widget's
public site key is a plain constant in `app/site.ts` (Turnstile's site keys
are meant to ship in HTML, unlike its secret key), and `worker/waitlist.ts`
verifies the token server-side against Cloudflare's siteverify endpoint,
checking the action and hostname too so a token issued for a different site
can't be replayed here. A failed check is treated exactly like a filled
honeypot -- the caller still sees success, so a bot never learns which
defense caught it. Both defenses are additive: Turnstile is skipped
entirely, not required, when `TURNSTILE_SECRET_KEY` isn't set (see
"Deploying" below), so a deploy without it still has the honeypot.

The form posted to a real `action`/`method`, so it degraded to a full-page
submission without JavaScript, and the endpoint still accepts both shapes.

Double opt-in (L18) is not implemented yet: it needs a verified sending
domain (`notifications.vibld.com` or `mail.vibld.com`, per L17), which needs
DNS records this repository cannot add on its own. Until that domain is
verified, a signup is captured immediately -- single opt-in -- rather than
blocked on a feature with an unmet dependency.

## Manual setup steps

- **Register a DMCA agent** with the U.S. Copyright Office
  (`https://dmca.copyright.gov/osp/`, ~$6). The Terms already publish the
  takedown procedure and note the registration is pending; once it's filed,
  add the registration number to `legal.terms.tsx`.
- **Create the `@vibld.com` mailboxes** the footer and legal pages reference
  (`support`, `privacy`, `security`, `abuse`, `legal`, `billing`, `hello`) --
  wherever vibld.com's mail is hosted.
- **Verify a sending domain in Resend** (`notifications.vibld.com` or
  `mail.vibld.com`) before double opt-in can be built.

## Deploying

One-time: create a **`marketing`** environment under **Settings →
Environments**, and add `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit + DNS:
Edit on the `vibld.com` zone, for the custom-domain routes),
`CLOUDFLARE_ACCOUNT_ID`, and `RESEND_API_KEY` to it -- the same pattern
`apps/web`'s README documents for its `preview` environment. Then run the
**Deploy marketing site** workflow from the Actions tab
(`workflow_dispatch` only).

`TURNSTILE_SECRET_KEY` is optional on the same environment: add it to turn
on server-side verification of the Turnstile token on `/api/waitlist`
(the public site key needs no secret handling -- it's a plain constant in
`app/site.ts`). It's on the same Cloudflare Turnstile page the site key came
from. Without it, the endpoint works exactly as before -- the honeypot
alone, no Turnstile check.

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/marketing build
pnpm --filter @vibld/marketing deploy
```
