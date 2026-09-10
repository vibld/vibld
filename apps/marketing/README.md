# @vibld/marketing

Vibld's own public site at [vibld.com](https://vibld.com) — built from the
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

A coming-soon page (L22): wordmark, tagline, one paragraph, a waitlist form,
an illustration of how Vibld works, and a footer linking every legal
document. Nothing else — no pricing, about or contact pages yet; those come
with the marketing site's next phase, not this one.

Eight legal documents (L23), governed by Georgia law with venue in Gwinnett
County: Terms of Service (including a DMCA notice procedure), Privacy Policy,
Acceptable Use Policy, Security & Vulnerability Disclosure (plus
`/.well-known/security.txt`, RFC 9116), Subprocessors, Cookie Notice, Refund
Policy, and Open-Source Notices. `app/site.ts` is the single source for the
entity name, mailing address and every `@vibld.com` address they reference —
change it there, not in eight places.

These are boilerplate drafts, not legal advice. Have a Georgia attorney read
the Terms and Privacy Policy before the first payment is taken (see the
Refund Policy, which exists ahead of any billing on purpose).

## The waitlist

`/api/waitlist` (`worker/index.ts`) is a real endpoint, not a demonstration:
it validates the submission (`worker/waitlist.ts`, tested without a Workers
runtime — the same pattern `apps/web/worker/spend.ts` uses) and adds the
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

The form posts to a real `action`/`method`, so it degrades to a full-page
submission without JavaScript; with it, `WaitlistForm.tsx` submits via
`fetch` and shows the result inline.

Double opt-in (L18) is not implemented yet: it needs a verified sending
domain (`notifications.vibld.com` or `mail.vibld.com`, per L17), which needs
DNS records this repository cannot add on its own. Until that domain is
verified, a signup is captured immediately — single opt-in — rather than
blocked on a feature with an unmet dependency.

## What only Chris can do

- **Register a DMCA agent** with the U.S. Copyright Office
  (`https://dmca.copyright.gov/osp/`, ~$6). The Terms already publish the
  takedown procedure and note the registration is pending; once it's filed,
  add the registration number to `legal.terms.tsx`.
- **Create the `@vibld.com` mailboxes** the footer and legal pages reference
  (`support`, `privacy`, `security`, `abuse`, `legal`, `billing`, `hello`) —
  wherever vibld.com's mail is hosted.
- **Verify a sending domain in Resend** (`notifications.vibld.com` or
  `mail.vibld.com`) before double opt-in can be built.

## Deploying

One-time: create a **`marketing`** environment under **Settings →
Environments**, and add `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit + DNS:
Edit on the `vibld.com` zone, for the custom-domain routes),
`CLOUDFLARE_ACCOUNT_ID`, and `RESEND_API_KEY` to it — the same pattern
`apps/web`'s README documents for its `preview` environment. Then run the
**Deploy marketing site** workflow from the Actions tab
(`workflow_dispatch` only).

`TURNSTILE_SECRET_KEY` is optional on the same environment: add it to turn
on server-side verification of the widget already live in `WaitlistForm.tsx`
(the public site key needs no secret handling — it's a plain constant in
`app/site.ts`). It's on the same Cloudflare Turnstile page the site key came
from. Without it, the endpoint works exactly as before -- the honeypot
alone, no Turnstile check.

To deploy from a workstation instead:

```bash
pnpm --filter @vibld/marketing build
pnpm --filter @vibld/marketing deploy
```
