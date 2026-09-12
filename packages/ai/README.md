# @vibld/ai

The first real model adapter. It implements `ModelProvider` from
[`@vibld/core`](../core), so it is a drop-in peer of `FakeModelProvider` — the
state machine, durable runner and builder shell are unchanged by it.

## Boundary

```
@vibld/core          ModelProvider, GenerationPlan      Vibld-owned contracts
  ^
@vibld/ai            AnthropicModelProvider             policy: prompt, schema, errors
                     PlanClient                         the seam (no vendor types)
                     createAnthropicPlanClient          the only file importing an SDK
```

`anthropic-client.ts` is the **only** file in the repository that imports a
model vendor's SDK (ADR-0003). Everything above it speaks `PlanRequest` /
`PlanCompletion`, which is also what makes the provider testable with no
network and no key — the tests supply their own `PlanClient`.

## What it guarantees

Structured outputs (`output_config.format`) make the response schema-valid by
construction rather than by asking for JSON in the prompt. On top of that the
provider turns three silent failures into explicit, typed errors:

| Error                     | Cause                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `ProviderRefusalError`    | `stop_reason: refusal`, with the category preserved         |
| `ProviderTruncationError` | `stop_reason: max_tokens` — the project is cut off mid-file |
| `ProviderShapeError`      | Response missing or not matching the plan schema            |

Truncation gets its own error deliberately. A silently truncated project looks
like a success and then fails at install or build time with a syntax error far
from the real cause — the single most common broken-preview failure in the
predecessor codebase.

The adapter guarantees _shape_ only. Path canonicalization, file limits and
required files stay with the validator in the generation pipeline, which runs
before any checkpoint is promoted (ADR-0007). Model output is untrusted input.

## Trying it

Nothing else in the repository makes a live model call. This CLI is the only
path, and it needs a key you supply:

```bash
ANTHROPIC_API_KEY=... pnpm --filter @vibld/ai plan "a landing page for a cybersecurity SaaS with pricing, an FAQ, heavy motion graphics, and a navy / dark purple / neon yellow palette"

# write the generated project out and build it like any npm project
ANTHROPIC_API_KEY=... pnpm --filter @vibld/ai plan "..." --out /tmp/generated
cd /tmp/generated && npm install && npm run build
```

That second form is the portability check from ADR-0002: the output must build
with ordinary npm commands and no Vibld anything.

## Not wired into the builder yet — and why

The builder shell is a **static SPA served from a public URL**. A model key
placed in it would be readable by anyone who opens the page, which ADR-0006
forbids: provider credentials belong to a trusted service, never to code the
browser can read.

So using this from the deployed builder needs a server hop — an endpoint that
holds the key and calls this adapter. That endpoint also needs an access
control decision before it exists, because an unauthenticated endpoint on a
public URL lets anyone spend the account's model budget.

## Design intelligence

`style-presets.ts` (16 named visual directions), `patterns.ts` (10 marketing
page types, 6 SaaS screens) and `palettes.ts` (15 product-type colour +
typography defaults) are closed-set, keyword-matched retrieval — the same
shape, for the same reason: a request's own text selects a handful of
relevant, concrete guidance to append to the prompt, never an arbitrary
string a caller supplies directly (docs/decisions.md L50-L51). `plan-schema.ts`'s
`PLAN_SYSTEM_PROMPT` carries a small, universal "UX BASELINE" section
alongside these for the rules that apply regardless of style or product type.

A meaningful share of this content (the eight newer style presets, the UX
baseline, and every palette's values) is adapted from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
(MIT License) — a much larger, actively-searched design-intelligence dataset
(89 styles, 192 product/palette pairs, 119 UX guidelines) meant to be queried
by a local Python tool at generation time. Neither the tool nor live
retrieval fits here yet (no Python runtime in a Worker, no retrieval
infrastructure until #12/D13 exists — see `patterns.ts`'s own comment), so
what is ported is a hand-picked, adapted subset of the underlying values:
real hex tokens and real Google Fonts pairings, restated as plain CSS custom
properties to match this project's own default stack rather than the
source's Tailwind-oriented output.

## Model selection

`DEFAULT_MODEL` exists so the adapter runs, and is **not** a selection. D10
reserves that for a measured bakeoff with an approved spending cap; the model,
effort and token ceiling are all constructor options so a bakeoff can sweep
them without touching this code.
