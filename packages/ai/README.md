# @vibld/ai

The first real model adapter. It implements `ModelProvider` from
[`@vibld/core`](../core), so it is a drop-in peer of `FakeModelProvider` -- the
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
network and no key -- the tests supply their own `PlanClient`.

## What it guarantees

Structured outputs (`output_config.format`) make the response schema-valid by
construction rather than by asking for JSON in the prompt. On top of that the
provider turns three silent failures into explicit, typed errors:

| Error                     | Cause                                                        |
| ------------------------- | ------------------------------------------------------------ |
| `ProviderRefusalError`    | `stop_reason: refusal`, with the category preserved          |
| `ProviderTruncationError` | `stop_reason: max_tokens` -- the project is cut off mid-file |
| `ProviderShapeError`      | Response missing or not matching the plan schema             |

Truncation gets its own error deliberately. A silently truncated project looks
like a success and then fails at install or build time with a syntax error far
from the real cause -- the single most common broken-preview failure in the
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

## Not wired into the builder yet -- and why

The builder shell is a **static SPA served from a public URL**. A model key
placed in it would be readable by anyone who opens the page, which ADR-0006
forbids: provider credentials belong to a trusted service, never to code the
browser can read.

So using this from the deployed builder needs a server hop -- an endpoint that
holds the key and calls this adapter. That endpoint also needs an access
control decision before it exists, because an unauthenticated endpoint on a
public URL lets anyone spend the account's model budget.

## Design intelligence

`style-presets.ts` (23 named visual directions -- 16 surface treatments and
7 complete colour systems), `patterns.ts` (10 marketing
page types, 6 SaaS screens), `palettes.ts` (15 product-type colour, typography
and feel defaults), `motion.ts` (16 motion recipes) and `surfaces.ts` (5
painting techniques) are closed-set,
keyword-matched retrieval -- the same shape, for the same reason: a request's
own text selects a handful of relevant, concrete guidance to append to the
prompt, never an arbitrary string a caller supplies directly
(docs/decisions.md L50-L51). `plan-schema.ts`'s `PLAN_SYSTEM_PROMPT` carries
the universal "UX BASELINE", "MOTION BASELINE" and "CONTENT" sections
alongside these, for the rules that apply regardless of style or product
type.

A meaningful share of this content (the eight newer style presets, the UX
baseline, and every palette's values) is adapted from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
(MIT License) -- a much larger, actively-searched design-intelligence dataset
(89 styles, 192 product/palette pairs, 119 UX guidelines) meant to be queried
by a local Python tool at generation time. Neither the tool nor live
retrieval fits here yet (no Python runtime in a Worker, no retrieval
infrastructure until #12/D13 exists -- see `patterns.ts`'s own comment), so
what is ported is a hand-picked, adapted subset of the underlying values:
real hex tokens and real Google Fonts pairings, restated as plain CSS custom
properties to match this project's own default stack rather than the
source's Tailwind-oriented output.

Motion and copy voice were added later, from a second pass over eight more
MIT-licensed design skills. What was taken, and from where:

- **[emilkowalski/skills](https://github.com/emilkowalski/skills)** (MIT) --
  the bulk of `motion.ts` and of `MOTION BASELINE`: the three easing curves,
  the per-element duration table, the sub-300ms ceiling, the frequency gate
  ("the more often something is triggered, the less it animates"), and the
  plain-CSS recipes themselves. Chosen over the alternatives because it is
  plain-CSS-first by construction, which is the same constraint `STACK`
  imposes on generated projects. It also corrected a rule this package was
  already shipping: reduced motion means _fewer and gentler_, not none.
- **[LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill)**
  (MIT) -- the four motion archetypes and their overshoot budgets, now the
  `feel.motion` field on every `ProductPalette`; the ambient numbers
  (breathing, floating, gradient drift, shimmer, parallax ratios) in
  `motion.ts`; the 65-75% exit ratio and the 500ms total-stagger cap. Its
  duration _values_ were not copied: its premium tier puts a standard
  transition at 500ms, which breaks the sub-300ms ceiling above.
- **[blader/humanizer](https://github.com/blader/humanizer)** (MIT) -- the
  structural copy rules in `CONTENT`: not-X-but-Y, the closer that restates
  the section above it, the forced triad, the inflated send-off, and the
  safeguard against over-correcting into affectless prose. Its own
  vocabulary lists are encyclopedic in register and carry none of the
  SaaS-marketing words that actually show up in generated copy, so that list
  is this project's own, written in humanizer's format.
- **[AThevon/genjutsu](https://github.com/AThevon/genjutsu)** (MIT) -- its
  `css-native` skill is the source of four `motion.ts` entries
  (`scroll-driven`, `view-transition`, `discrete-transition`,
  `anchor-position`) and of all of `surfaces.ts`. Each replaces a library
  with a platform feature, which is the same trade `STACK` already makes.
  Its dated browser-support claims are deliberately not carried over: that
  skill version-stamps them because they perish, and a perishable fact baked
  into a prompt goes stale silently and is never corrected. The durable half
  is the discipline (guard the feature, keep the content usable without it),
  and a test asserts that no recipe names a browser. The rest of the repo is
  not ported: its `ui-ux-pro-max` tree is a verbatim vendored copy of the
  skill above, and most of the remainder is Jetpack Compose and SwiftUI. Its
  motion-principles duration bands agree with what was taken from
  emilkowalski/skills.

Three of the nine are not ported, on technical grounds only:

[greensock/gsap-skills](https://github.com/greensock/gsap-skills) (MIT) is
API reference for a library this stack does not ship, and its `gsap-core`
skill instructs the reader to recommend installing GSAP, which would break
`STACK` and `PORTABILITY`.

[CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) has
three.js API detail that has drifted roughly twenty releases and contains
several build-breaking errors: a `ContactShadows` import that does not exist
in three.js (it is a `@react-three/drei` component), `scene.add(transformControls)`
which throws since r169, and `uv2` for `aoMap`, renamed in r151. Separately, a
retrieval module for it could not be triggered safely: `selectMotion` does
substring matching, so a trigger of `3d` would fire on "3D card flip" and push
an npm dependency into a project that asked for a CSS transform. Its
repository states an MIT grant in its README with no LICENSE file present.

[zanwei/design-dna](https://github.com/zanwei/design-dna) (MIT) contributed
three things, though not its schema: its shape/elevation/motion sub-trees
informed `ProductPalette.feel`, its controlled-enum dimensions became
`style-dna.ts`, and its verification loop is what `contrast.ts` and the
validator's warnings implement. The schema itself is an extraction-output
format whose colour model has no on-colour pairing, so it is weaker than
`palettes.ts` for this job, and its `measure-colors.mjs` needs `sharp` and a
screenshot, neither of which exists in a Worker.

One licensing question was decided by the project owner rather than here.
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
catalogues about seventy real companies' design languages. MIT is a copyright
grant and conveys no trademark rights, which the cataloguer does not hold; on
that basis the owner directed that the archetypes drawn from it ship
de-named, which is what `style-presets.ts` does. A test enforces it on the id,
chip name and caption.

### Verified rather than asserted

`contrast.ts` is WCAG relative luminance and contrast ratio in about eighty
lines of arithmetic, with no dependency. It is used twice: the tests hold
every tokened archetype to 4.5:1 on all eight of its text pairs, and the
generation validator parses `:root` out of a generated stylesheet and reports
any declared `--x` / `--x-foreground` pair that falls below it.

The second of those is a warning, not an error, and deliberately. A page whose
muted text sits at 4.2:1 is a real defect and still a working project;
rejecting it would cost the user the generation and what it cost to produce,
to fix something they can see and decide about. `ValidationResult` and
`GenerationResult` grew an optional `warnings` channel for this, which is why
a run can be `accepted` and still have something to say.

Hairlines are not checked. WCAG's 3:1 is for interactive control boundaries,
not for a decorative rule between two surfaces, and holding a `--border` token
to it produces heavy-lined output no design system ships.

### The seven tokened archetypes

Clustering that corpus showed that its useful content is structural, not
nominal: "dark" is really four unrelated systems, and a warm paper ground
with a terracotta accent is its own thing rather than a tint of minimalism.
Those clusters are `warmTerminal`, `layeredVoid`, `acidDark`, `nightIndigo`,
`warmPaper`, `monoPress` and `polarityBands` -- presets that carry a whole
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
it -- the id, chip name and caption are the surface a trademark claim attaches
to.

## Model selection

`DEFAULT_MODEL` exists so the adapter runs, and is **not** a selection. D10
reserves that for a measured bakeoff with an approved spending cap; the model,
effort and token ceiling are all constructor options so a bakeoff can sweep
them without touching this code.
