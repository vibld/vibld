# Fimo: what it does, and what Vibld should take from it

## How this was read

Grounded in sources that can be checked, not recall:

- **`fimo.ai/llms-full.txt`**, the complete published documentation corpus
  (346 KB, 78 pages), read directly. Every quote attributed to "the docs"
  below is read from that file.
- **The published `fimo` npm package, version 2.7.0**, tarball downloaded and
  unpacked: 517 files, including the compiled CLI, five framework templates,
  four agent-bundle templates and the four agent skills as plain markdown.
  Quotes attributed to a file path are read from that tarball.
- **The marketing pages** (`fimo.ai`, `/pricing`, `/features/*`) read through
  a fetch-and-summarise tool, so quotes from those pages passed through a
  summariser and are the weakest evidence here. Where a marketing claim
  matters, I checked it against the docs corpus instead.

Anything marked _inferred_ is an inference and says so.

## What Fimo actually is

Their own `llms.txt` is more precise than the homepage, and it is the sentence
worth internalising:

> Fimo is an autonomous website platform. A coding agent builds the site, then
> Fimo keeps it editable by the team and operable by AI through content,
> isolated environments, scheduled agents, and hosting. The code stays yours.

And the scope limit, stated by them rather than inferred by me:

> Use Fimo after a coding agent has built a website and you need
> non-developers to edit it, agents to operate it, or a safe path from preview
> to production. Fimo takes over after the build and works with your existing
> code and framework. It focuses on websites rather than arbitrary full-stack
> application features.

Built by the founders of Strapi, which shows: the content model is the most
mature part of the product.

**This is not Lovable's shape and it is not Vibld's shape.** Lovable and Vibld
compete over the _build_: prompt to running site. Fimo deliberately does not
compete there -- it assumes Claude Code or Cursor already did the build, and
sells everything that happens afterwards. Their comparison page against Cursor
says so directly: "Cursor builds your website. Fimo makes it run itself."

Two consequences for Vibld:

1. Fimo is a **weak competitor and a strong donor**. It is not racing Vibld
   for the same first user action, so almost nothing here is a feature Vibld
   must match defensively. Nearly everything here is a design Vibld can lift
   because it solves problems Vibld will hit at M2 and M3 regardless.
2. Fimo is what Vibld's _output_ could plug into, and equally the roadmap
   Vibld would follow if it ever went past the build loop. The overlap arrives
   at M2 (conversational editing), M3 (publish) and M5 (visual iteration).

## The single best idea in the product

Agent work has four outcomes, named, and the agent must pick one. From
`docs/agents/create`:

> - **Ask** when a missing human decision blocks correct work. The question
>   appears in the Inbox.
> - **Retain** when the work is complete but a person should review it before
>   merge.
> - **Merge** when the result is complete, verified, and safe to apply to the
>   target Branch.
> - **Discard** when no work should be applied.

Plus the state machine around it: "Asking ends the current invocation.
Answering starts a continuation with the retained work and your response.
Retaining work for review does not ask a question."

That last clause is the part most systems get wrong. A blocking question and a
finished-but-unreviewed proposal are different objects with different
lifecycles, and Fimo refuses to collapse them. Vibld's `BuilderState` has
planning, staged, validated and accepted; it does not yet have "the agent
stopped because only you can answer this", and D11 ("bounded repairs/retries
and explicit cancellation") is the closest thing. Ask/Retain/Merge/Discard is
a better vocabulary than anything Vibld has written down, it costs nothing to
adopt, and it is the correct shape for M2's conversational editing.

## Agents as repository files

New bundles live at `.fimo/agents/<name>/`:

- `config.yaml` -- model, run limits, description, triggers, requested
  secrets, connected tools
- `GOAL.md` -- "The whole of GOAL.md is the agent's prompt -- there's no
  frontmatter or structured fields, just plain English"
- `capabilities.yaml` -- extra grants only
- optional `scripts/` and `references/`

The shipped default (`assets/agent-templates/_default/config.yaml`) is 13
lines:

```yaml
version: 1
description: 'A new Fimo agent. Edit this tagline to describe what it does.'
model: openai/gpt-5.6-luna
runtime:
  max_credits: 5000
triggers:
  - type: manual
```

Triggers are `manual`, a cron schedule with a timezone, or a webhook. A
_scheduled command_ is a separate, lighter thing: one project command on a
cron, explicitly "not an agent bundle".

The whole definition is versioned, reviewed and deployed like code, and it
cannot run until it reaches `main`: "While you work on a Branch, Studio shows
new bundles in the Agents list in a disabled state ... The bundle and its
triggers cannot run until the Branch is merged into `main`." Deleting a bundle
in the UI "commits the removal of `.fimo/agents/<name>/` from `main`, so it is
the same act as deleting the folder yourself and running `fimo deploy`".

Four templates ship in the package: `seo-audit`, `broken-link-sweeper`,
`content-translator`, `post-deploy-check`, plus a `welcome-guide` inside the
welcome template. The `seo-audit` GOAL.md is worth reading in full as a
specimen: eight numbered per-page checks, an explicit output structure, and a
"What NOT to do" section that includes "don't mention capabilities or write
access in the report itself".

## The capability model

This is the most carefully thought-out security design I found, and it is
directly applicable to Vibld's D-series scoped autonomy permissions.

The platform keeps the dangerous primitives for itself rather than granting
them:

> Managed agents always receive the project-worker basics: they can read and
> change project files, run shell commands, and commit changes in their task
> Branch. Fimo owns the Branch and publication step, so you do not declare
> `files:*`, `shell:exec`, or `git:*` in `capabilities.yaml`.

`capabilities.yaml` is therefore only for _extra_ reach, and defaults closed:
"An absent or empty file grants no CMS or asset scope."

Wildcards are expanded rather than stored:

> Namespace selectors such as `cms:*`, `assets:*`, `i18n:*`, and `forms:*`
> grant every current and future declarable capability in that namespace. Fimo
> expands them into concrete grants when a run starts, so consent and
> enforcement remain auditable.

Cost drives the boundary between free and opt-in: `webFetch` on public pages
is free to every agent because "Fimo retrieves the page itself and it costs
nothing"; `net:fetch` is required for `webSearch` "which runs the query against
a search service Fimo pays for". Each search returns a `usage` summary "so an
agent can see its own cost as it works".

Mid-run escalation is bounded in three ways at once:

> A project member selects which capabilities to approve; selecting none is a
> valid denial, and a written note can explain the decision but never grants
> access on its own. Approved capabilities apply only to the continuation
> started by that answer, not to later runs.

"Selecting none is a valid denial" and "a note never grants access on its own"
are both defences against an agent talking its way past a human, and the
per-continuation scope means an approval cannot be banked. The CLI docs then
carry the matching instruction to the _coding_ agent, as a warning:

> A coding agent must show you the stored form and submit only the answer you
> gave it. It should never choose for you, and never approve a capability you
> did not approve.

## Budgets, and what happens when one runs out

Vibld already enforces a spend ceiling before each run rather than after it,
so this is refinement rather than a gap. What Fimo adds is vocabulary and
failure honesty.

- `runtime.max_credits` is a per-run ceiling on top of the organisation
  balance, and it is the only limit they want you tuning. `max_steps` exists
  but the docs actively discourage it: "there is no platform step cap, and
  credits already bound every run."
- Stop reasons are distinct and named: `budget_exceeded` for the run's own
  limit, `insufficient_credits` for the organisation, `max_steps` for the step
  bound.
- Credits are **reserved** while a run is live, the reservation can grow, and
  "Fimo charges the actual usage, not the reserved amount, and releases any
  remainder when the run ends."
- A run that cannot be afforded does not become a failed run: "The skipped
  attempt creates no run or run notification."
- Every run list and run page carries a **Credits** column, explicitly so you
  can "compare runs and tune an agent's model, prompts, and `max_credits`
  limit". A live run shows a placeholder rather than a wrong number.
- Four separate meters that they forbid you adding up: AI credits, bandwidth,
  schedule compute, agent-hours. "Do not add agent-hours, schedule compute, or
  AI credits together."
- Overage is one opt-in budget across bandwidth and agent runtime, off by
  default, and "No budget means extra usage stays off, never unlimited
  spending." On Free, exhausting bandwidth pauses public serving while "Studio,
  your content, and your assets stay fully available the whole time."
- When the meter cannot be read, the page "says so instead of showing a zero";
  where there is no estimate it shows **Unknown** "rather than showing a zero".

That last pattern, and the refusal to bill a run whose duration is uncertain
("Runs ending with paid usage disabled or an uncertain duration are not
billed"), is the same instinct as Vibld's recent Stripe recovery commits.

## Typed reasons for "nothing happened"

`fimo agents run` exits non-zero and names which of four things went wrong:
`AGENT_NOT_DEPLOYED`, `AGENT_CONFIG_INVALID`, `NO_MANUAL_TRIGGER`,
`MANUAL_TRIGGER_NOT_SYNCED`, plus `INSUFFICIENT_CREDITS` separately "so a
script can tell it apart from a run that started". The UI mirrors it: the Run
button is disabled "with the reason on the button", and a run started anyway
"answers with the same explanation".

Run statuses are equally specific: **Merged**, **Done** (finished with nothing
to deliver), **Needs your input** (open question), **Needs attention**
(captured changes awaiting review), **Merge required** (changes conflict).
Five states where most products ship two.

This is the same discipline as Vibld's own commit log ("refuse to deploy an
invite gate nobody can open", "Do not mark an event done that wrote nothing").
It is cheap to copy and it is culturally already Vibld's.

## Branch means the whole stack

> Every branch spins up a complete copy of your stack: its own server, its own
> database, its own asset bucket.

`fimo checkout -b` creates the git branch _and_ the environment: "Use `fimo
checkout -b` instead of `git checkout -b`." `fimo status` and `fimo diff`
compare across every surface at once, not just files, and merge semantics are
spelled out: non-conflicting additions, deletions and renames carry over, "A
renamed file moves rather than being copied", target-only changes are
preserved.

Review is grouped by surface with counts: **Code, Schema, Content, Labels,
Assets**. A run reviewed before asset capture existed "leaves the Assets tab
closed, because that run has no asset count to report", which is a small,
honest touch.

Preview and publish never blur:

- `fimo deploy` updates the branch preview. "A Preview deploy never publishes
  your site."
- `fimo deploy --publish` publishes from the configured production source
  branch.
- "Merging changes updates the target Branch. Publishing the live website is a
  separate action with its own confirmation."
- Agents cannot publish at all: "The agent does not publish its own Git
  changes ... Only a manual run whose current request explicitly asks to
  publish or go live can publish the live website. Schedule and webhook runs
  do not treat event payloads as publication approval."

That last sentence is a real threat model: a webhook payload is attacker-
influenced input, and treating it as consent to go live would be the bug.

Version history restores **code and content together** as one restore point,
which is the thing a CMS bolted onto a repo normally cannot do.

## Reports, and the fact the platform owns their styling

Every run produces a report with a result-first title and two parts: a
**brief** ("the decision-complete handoff", shown in full on every surface
including the email and the CLI) and **details** (evidence, tables, trends,
verification). The report title becomes the email subject "so the outcome is
visible before the message is opened".

The constraint I would steal verbatim:

> agents pick what it says (compare these, this moved, this is made of), and
> Fimo owns every colour, size, label, and legend, so no report can style
> itself.

Also: severity colours "appear only when the agent has a real scale to
report", so "a list of suggestions never reads like a list of failures"; media
is referenced by media-library position rather than URL and a deleted asset
"degrades to those words too, never to a broken frame"; a surface that cannot
draw a block "shows that block's text instead of dropping it"; and "Nothing in
a report is a control: it is something you read." If an agent writes prose
where a list body belongs, "Fimo asks it to rewrite the brief before
finishing".

## Notifications: switches for blocking work, digests for the rest

Work that blocks a person is a boolean (agent questions, merge conflicts,
publication failures, schedule failures, allowance warnings) "because holding
it for a morning would be the wrong promise". Work you review on your own time
gets **Immediate / Daily summary / Off**, with "Work ready for review"
defaulting to Immediate and "Agent run outcomes" to Daily summary "because a
finished run is a recap rather than a decision".

A daily reminder covers still-open questions, one message per organisation,
"Nothing is sent on a morning when you have no open question", and it offers
**Pause for a week** that restarts itself and states the resume date.

## How Fimo teaches coding agents about a Fimo project

This is the piece I would put in front of Chris first, because Vibld
_generates_ projects and therefore has the same problem in a sharper form.

Fimo does not vendor its documentation into every repository. `fimo skills
install` writes one small bootstrap skill per tool, and the real instructions
are streamed from the CLI on demand. The entire global skill
(`assets/skills/fimo/SKILL.md`) is a pointer:

> Fimo ships its skills through its CLI. `fimo-code` resolves from the
> project's installed `fimo` package; workflow skills resolve from the CLI you
> run. This file is only a pointer -- fetch the real skill when needed.

Four loadable skills (`fimo-code`, `fimo-cli`, `fimo-studio`,
`fimo-migration`) with ~100 reference documents behind them, addressed as
identifiers rather than paths:

> Reference paths mentioned in streamed skill output, such as
> `references/media.md`, are identifiers, not files in the project. Load them
> through the CLI ... Do not use a filesystem read tool for them.

The version handling is the part that matters for a tool whose contracts will
change, which is exactly Vibld's stated situation:

> Every loaded skill begins with the Fimo version that supplied it. An older
> version may be the project's intentional runtime, so do not upgrade it
> automatically.

And "Always fetch the skill fresh from the CLI rather than trusting a copy."

Project rules are generated per tool from one source, non-destructively:
`AGENTS.md` is canonical, `fimo rules sync` creates `CLAUDE.md`,
`.cursor/rules/fimo.mdc`, `.windsurfrules`, `GEMINI.md` for the tools that need
their own format, and "only creates missing files. It does not overwrite a
variant you have edited."

There is also a `site-checks` reference that tells an agent how to pick a
target to verify against (local server, existing preview, or supplied URL) and
to report "what that target can prove without treating preview measurements as
published-site performance". Vibld's validation suite is measuring exactly
that and could use exactly that caveat.

## Editable content over generated code

One schema per `src/schemas/<Uid>.json`, PascalCase filename matching `uid`,
field types `string | text | richtext (Tiptap JSON) | number | date | boolean
| media | json | reference | blocks`, singletons via `isSingleton`, references
with `target` and `many`.

The guidance is editor-first rather than developer-first: "use `heroHeading`
instead of `H1`"; "Avoid `json` for editor-managed content. Use it only for
opaque data that editors do not need to understand or edit"; "Keep routing,
layout, computed values, and external system data in code." Studio field
`groups` "changes only the Studio layout, not stored content, generated types,
validation, permissions, or what agents can edit" -- a presentation concern
explicitly fenced off from semantics. Reserved metadata keys are named and
refused. Locale policy is per field, so a localized type can share one SKU or
price.

Interface copy is separate from structured content: labels read through `t()`,
and `fimo validate` "Verify every `t()` key has a DB value" -- a build-time
check that the CMS and the code still agree.

Content is versioned in the database on every edit while "Code changes land as
commits", and the two restore together.

Assets get a genuinely hard problem handled properly: `fimo assets usage <id>`
reports "Current, Main, and Live reference impact", `assets replace` rewrites
current-branch references, `assets remove` removes from the current branch
only, and destruction needs `--permanent`. Removing an image on a branch does
not take it off the live site.

## Everything else worth naming

- **Machine-readable marketing.** `llms.txt`, `llms-full.txt`, an `ai-info.md`
  of "Structured facts about Fimo for ChatGPT, Claude, Perplexity, and
  Gemini", every marketing page and blog post available as `.md` or via
  `Accept: text/markdown`, a `server.json` MCP manifest, a
  `.well-known/ai-catalog.json`, and a public docs MCP endpoint. This is their
  GEO pitch practised on themselves, and it is how I was able to read the
  entire product in a handful of requests. Cheap, and it worked on me.
- **MCP in both directions.** A project MCP endpoint at
  `api.fimo.ai/api/mcp` with OAuth protected-resource metadata, plus
  `fimo mcp add/search/info/run` for attaching remote MCP servers to a
  project, plus `fimo integrations` with per-provider auth modes and tools.
- **Analytics that separate humans from crawlers.** `fimo analytics pageviews`
  is "Humans only; add `--device bot` for crawlers", with date annotations on
  the chart. For a product selling GEO, crawler traffic is the metric.
- **Webhooks done properly.** Deliveries, per-delivery attempts, retry, test
  send, and `rotate-secret`.
- **Secrets and vars per environment**, secrets added via `--stdin` so they
  never enter shell history, and agent-requested secrets listed per bundle
  (`fimo agents secrets list <name>`).
- **Migration from the incumbents**, `--source-platform webflow | framer |
squarespace | wix | carrd | wordpress | nextjs | astro | react-router |
other`, labelled alpha in their own docs: "Website migration is in alpha and
  not stable yet, so review every result before you continue."
- **Five frameworks**: Next.js App Router (default), React Router, Astro,
  SvelteKit, Vite + React.
- **A referral CLI**: `fimo referral link`, `fimo referral stats`.
- **Media generation in the CLI**: `fimo image generate/edit/remove-
background/upscale`, `fimo video generate/animate/replace`.

## Where Fimo is weaker than its marketing

- **Migration is alpha and says so.** The flagship "bring your Webflow site"
  motion is the least stable part.
- **The default autonomous model is not Claude.** Bundles scaffold to
  `openai/gpt-5.6-luna` and omitting `model` also selects it. Their model list
  is broad; their default is not the frontier choice.
- **"Fimo owns the Branch and publication step"** is the flip side of the
  security model. Agents cannot commit outside their task branch and cannot
  publish, which is right, but it also means the platform is in the loop for
  operations a self-hosting user would want to run themselves. Their
  portability claim is about the code, not about the operations.
- **Content lives in Fimo's database.** The code is portable; the content
  behind `t()` and the entries API is a hosted dependency. "Your code stays
  yours" is true and is not the same claim as "your site keeps working without
  us", which is a claim Vibld's README does make about its own output.
- **Their own README carries a comment** admitting a logo URL is frozen into
  every published tarball with "nothing in CI catches its removal", including
  an account of how a previous logo URL "stayed broken without anyone
  noticing". Unusual candour, in a file they publish.

## Licensing: facts only

- The published `fimo` package, version 2.7.0, has **no `license` field** in
  its `package.json`, **no LICENSE file** in the tarball, and no `repository`
  or `homepage` field.
- The tarball ships the compiled CLI under `dist/` together with uncompiled,
  readable assets: the four skills and their ~100 reference documents as plain
  markdown, five framework templates, and four agent-bundle templates.
- I found no open-source licence statement on `fimo.ai` or in the published
  documentation corpus, and I did not retrieve their terms of service or any
  separate legal page.
- I have not checked whether a public source repository exists.

What may or may not be read, adopted, adapted or referenced from any of that
is your call, not mine, and nothing in this document is excluded or included
on licensing grounds.

## What I would take, in order

1. **Ask / Retain / Merge / Discard as the outcome vocabulary**, with a
   blocking question modelled separately from an unreviewed proposal, and a
   continuation that resumes retained work with the answer. This is the piece
   with the highest ratio of clarity gained to work done, it belongs in M2
   before conversational editing is built on a vaguer model, and it fits D11
   rather than contradicting it.
2. **Typed refusal reasons and specific statuses.** Named stop reasons
   (`budget_exceeded` vs `insufficient_credits`), a disabled control that
   states its own reason, a non-zero exit a script can branch on, and states
   that distinguish "finished with nothing to do" from "finished and merged"
   from "waiting on you". Vibld's engine already behaves this way; the
   vocabulary is missing.
3. **The capability model.** Dangerous primitives held by the platform rather
   than granted, an empty manifest granting nothing, wildcards expanded to
   concrete grants at run start for audit, escalation scoped to one
   continuation, an empty selection as a valid denial, and a note that never
   grants access. This is what Vibld's scoped-autonomy decisions need in order
   to become an implementation.
4. **CLI-served, version-stamped agent instructions.** One thin pointer per
   tool, real instructions streamed on demand and stamped with the version
   that produced them, references addressed as identifiers rather than file
   paths, and per-tool rule files generated from one canonical `AGENTS.md`
   without overwriting hand edits. Vibld ships generated projects into other
   people's agents and has exactly this problem; ADR-0009's whole-project
   context question is adjacent to it.
5. **Preview and publish as separate verbs, with agents barred from
   publishing** and event payloads explicitly not read as consent. M3 will
   need this and it is cheaper to decide now.
6. **Platform-owned report rendering.** The model chooses what a block says,
   never how it looks; severity colour only where a real scale exists; a
   surface that cannot render a block prints its text. Vibld's console and
   Problems panes are the place this lands.
7. **The per-run budget ceiling on top of the account ceiling**, with reserve-
   then-charge-actuals, a per-run cost column, and separate meters that are
   never summed. Vibld enforces a ceiling; this makes it tunable per unit of
   work and legible after the fact.
8. **`llms.txt`, `llms-full.txt` and markdown-negotiated pages** for Vibld's
   own site and docs. A day of work, and it is how a competitor got fully
   analysed by an agent in an afternoon.
9. **Agent bundles as reviewed repository files**, if and when Vibld grows
   recurring project automation. Not before M3, and only if there is demand
   evidence; the design is worth copying, the timing is not now.

## What I would not take

- **The content database and the CMS.** It is Fimo's best-built component and
  it is the wrong thing for Vibld to build. It makes the hosted platform
  load-bearing for the generated site, which cuts against Vibld's stated
  principle that generated applications keep working without Vibld Cloud.
- **Five framework adapters.** One versioned template that validates and
  exports is worth more than breadth Vibld cannot yet prove.
- **Media generation.** Already deferred as off the critical path; nothing
  here changes that.
- **Site migration from Webflow and friends.** Alpha in a more mature product,
  and the same category as clone-a-website in the Lovable analysis: it makes
  the output someone else's design.
- **Their meter structure.** Four separately-metered resources is the right
  answer at their scale and premature complexity at Vibld's.

## One open question this raises

Fimo's existence is evidence for a position Vibld has not taken: that the
build is not the product, and the operate loop is where a site spends its
life. Vibld's roadmap stops at visual iteration and defers teams,
collaboration and governance to "product evidence". Fimo is a well-funded,
experienced team betting that the operate loop is a separate product entirely,
and selling it to the users of the tools Vibld competes with.

Two readings, and I do not think the evidence here picks between them:

- Vibld should stay narrow, win the build, and let the operate layer be
  someone else's product (possibly Fimo's, which would make interoperability
  rather than emulation the goal).
- Or the build is commoditising fastest of all, and the durable product is the
  thing that keeps a site alive afterwards, in which case M5 is not the end of
  the roadmap and the ordering above understates items 1 and 9.

That is a positioning decision, not a technical one.
