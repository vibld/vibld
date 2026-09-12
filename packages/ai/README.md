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

`style-presets.ts` (23 named visual directions — 16 surface treatments and
7 complete colour systems), `patterns.ts` (10 marketing
page types, 6 SaaS screens), `palettes.ts` (15 product-type colour, typography
and feel defaults) and `motion.ts` (12 motion recipes) are closed-set,
keyword-matched retrieval — the same shape, for the same reason: a request's
own text selects a handful of relevant, concrete guidance to append to the
prompt, never an arbitrary string a caller supplies directly
(docs/decisions.md L50-L51). `plan-schema.ts`'s `PLAN_SYSTEM_PROMPT` carries
the universal "UX BASELINE", "MOTION BASELINE" and "CONTENT" sections
alongside these, for the rules that apply regardless of style or product
type.

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

Motion and copy voice were added later, from a second pass over eight more
MIT-licensed design skills. What was taken, and from where:

- **[emilkowalski/skills](https://github.com/emilkowalski/skills)** (MIT) —
  the bulk of `motion.ts` and of `MOTION BASELINE`: the three easing curves,
  the per-element duration table, the sub-300ms ceiling, the frequency gate
  ("the more often something is triggered, the less it animates"), and the
  plain-CSS recipes themselves. Chosen over the alternatives because it is
  plain-CSS-first by construction, which is the same constraint `STACK`
  imposes on generated projects. It also corrected a rule this package was
  already shipping: reduced motion means _fewer and gentler_, not none.
- **[LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill)**
  (MIT) — the four motion archetypes and their overshoot budgets, now the
  `feel.motion` field on every `ProductPalette`; the ambient numbers
  (breathing, floating, gradient drift, shimmer, parallax ratios) in
  `motion.ts`; the 65-75% exit ratio and the 500ms total-stagger cap. Its
  duration _values_ were not copied: its premium tier puts a standard
  transition at 500ms, which breaks the sub-300ms ceiling above.
- **[blader/humanizer](https://github.com/blader/humanizer)** (MIT) — the
  structural copy rules in `CONTENT`: not-X-but-Y, the closer that restates
  the section above it, the forced triad, the inflated send-off, and the
  safeguard against over-correcting into affectless prose. Its own
  vocabulary lists are encyclopedic in register and carry none of the
  SaaS-marketing words that actually show up in generated copy, so that list
  is this project's own, written in humanizer's format.
- **[AThevon/genjutsu](https://github.com/AThevon/genjutsu)** (MIT) — read
  and largely not ported: its `ui-ux-pro-max` tree is a verbatim vendored
  copy of the skill above, and most of the rest is Jetpack Compose and
  SwiftUI. Its motion-principles duration bands agree with what was taken
  from emilkowalski/skills.

Four more were read and rejected outright, recorded here so the question is
not reopened:
[greensock/gsap-skills](https://github.com/greensock/gsap-skills) (MIT) is
API reference for a library this stack does not ship, and instructs the
reader to recommend installing it — which would break `STACK` and
`PORTABILITY`;
[cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
(MIT) emits standalone HTML/SVG through an interactive, multi-turn pipeline,
and its "no shadows, max 6-10px radius" anti-patterns contradict the
`claymorphism`, `neumorphism` and `depth` presets;
[zanwei/design-dna](https://github.com/zanwei/design-dna) (MIT) is an
extraction-output schema whose colour model has no on-colour pairing, so it
is strictly weaker than `palettes.ts` for this job;
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(MIT) catalogues ~70 real companies' design languages — the licence is a
copyright grant and conveys no trademark rights, so shipping brand-named
presets is out for the same reason `style-presets.ts` already declines to
port Fluent, Polaris and Spectrum. Its shape/elevation/motion _structure_
informed `ProductPalette.feel`, and clustering it revealed the seven
archetypes that became the tokened style presets (see below); none of its
values or names are used.
[CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) has
no licence file at all, so nothing from it could be adopted regardless of
merit.

### The seven tokened archetypes

Clustering that corpus showed that its useful content is structural, not
nominal: "dark" is really four unrelated systems, and a warm paper ground
with a terracotta accent is its own thing rather than a tint of minimalism.
Those clusters are `warmTerminal`, `layeredVoid`, `acidDark`, `nightIndigo`,
`warmPaper`, `monoPress` and `polarityBands` — presets that carry a whole
colour system, font pairing and radius scale rather than only a sentence.

They fill a real hole. `buildUserPrompt` suppresses the product-type palette
whenever a style preset is chosen, so before these existed, picking a preset
meant getting no colour tokens at all. Their token names are identical to
`ProductPalette.colors`, so the `:root` block the prompt receives has one
shape whichever source produced it.

Every hex is authored here, not copied, and `contrast.ts` verifies all eight
text pairs per archetype at 4.5:1 in the test suite. That check is not
ceremony: several of the source corpus's own declared pairs fail it, because
it records real brands faithfully rather than vetting them.

Naming them after the companies is deliberately not done, and a test enforces
it — the id, chip name and caption are the surface a trademark claim attaches
to.

## Model selection

`DEFAULT_MODEL` exists so the adapter runs, and is **not** a selection. D10
reserves that for a measured bakeoff with an approved spending cap; the model,
effort and token ceiling are all constructor options so a bakeoff can sweep
them without touching this code.
