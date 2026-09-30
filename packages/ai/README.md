# @vibld/ai

The model adapters. `BoundedPlanProvider` implements `ModelProvider` from
[`@vibld/core`](../core), so it is a drop-in peer of `FakeModelProvider` -- the
state machine, durable runner and builder shell are unchanged by it.
`MockupProvider` (Explore's looks and the draft preview) and `ChatProvider`
(one chat turn) use the same client seam; neither returns a project, so
neither is a `ModelProvider`.

## Boundary

```
@vibld/core          ModelProvider, GenerationPlan      Vibld-owned contracts
  ^
@vibld/ai            BoundedPlanProvider                policy: prompt, schema, errors
                     PlanClient                         the seam (no vendor types)
                     createPlanClient                   picks one of the three below
                     createAnthropicPlanClient          anthropic-client.ts
                     createOpenaiPlanClient             openai-client.ts
                     createDeepseekPlanClient           deepseek-client.ts
```

`anthropic-client.ts` is the **only** file in the repository that imports a
model vendor's SDK (ADR-0003). `openai-client.ts` and `deepseek-client.ts`
call their REST APIs with plain `fetch`. Everything above the clients speaks
`PlanRequest` / `PlanCompletion`, which is also what makes the providers
testable with no network and no key -- the tests supply their own
`PlanClient`.

## What it guarantees

Anthropic's structured outputs and OpenAI's strict JSON Schema make the
response schema-valid by construction. DeepSeek has JSON mode only, so its
shape is asked for in the prompt and checked afterwards. Whichever client
answers, the provider turns three silent failures into explicit, typed errors:

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

## Bounded builds

A build is never one response (docs/decisions.md, "Resolved 2026-09-29").
`bounded-build.ts` asks for an outline first (the spec and a manifest of
files), then writes the files a group at a time, each group in a call of at
most 32,000 output tokens that sees only the files it depends on. A group
that truncates is split and asked again, down to one file, so only a single
file too large for a response of its own can fail a build for size. A
follow-up is a patch: the outline names the files to add, replace and
delete, and every other file carries over.

The model writes the page, not the boilerplate (D71). `scaffold.ts` writes
`package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`,
`src/main.tsx`, `src/lib/utils.ts` and `README.md` from `stack.ts` and the
outline's title, description and dependencies, declaring every package the
files import; `applyBoundedPatch` puts them in place. The prompts' FILES
WRITTEN FOR YOU section describes them from the same constants.

`BoundedPlanProvider` runs every step in turn behind the `ModelProvider`
contract (the CLI below, the eval harness, the repair turn), and
`runBoundedBuild` takes the step runner as a hook, which is how the Worker
makes each call a durable Workflow step. `PlanProvider`, the single-response
provider, is still here and still tested. The Worker calls it only to finish
a run enqueued before bounded builds existed (`legacy` in
`apps/web/worker/generation-workflow.ts`); new runs never take it.

`createScriptedBuildClient` is a `PlanClient` that answers a bounded build
from a script, truncating any reply longer than the call's ceiling, so the
whole orchestration can be exercised with no network and no key.

## Trying it

`pnpm generate` at the repository root runs one real build with a key you
supply and nothing else: no account, database or Cloudflare. It is
`pnpm --filter @vibld/ai plan` (`bin/plan.ts`), and relative paths are read
from the repository root.

```
pnpm generate "<prompt>" [--out <dir>] [--build] [--base <dir>] [--style <preset id>]
```

The prompt is everything before the first flag (`src/cli-args.ts`).

```bash
DEEPSEEK_API_KEY=... pnpm generate "a landing page for a cybersecurity SaaS with pricing, an FAQ, heavy motion graphics, and a navy / dark purple / neon yellow palette"

# write the generated project out and build it like any npm project
DEEPSEEK_API_KEY=... pnpm generate "..." --out ./generated
cd generated && npm install && npm run build

# or let it build, and repair once with the compiler's output if it fails,
# as the hosted builder does (repairPromptFor, keepingRecordOf)
DEEPSEEK_API_KEY=... pnpm generate "..." --out ./generated --build

# with a style preset, as the builder sends one
DEEPSEEK_API_KEY=... pnpm generate "..." --style bentoGrid

# a follow-up to a project already on disk
DEEPSEEK_API_KEY=... pnpm generate "add a pricing page" --base ./generated --out ./generated-2
```

- `--out` writes the project to that directory. Without it the run prints
  what the model produced and writes nothing.
- `--build` needs `--out`. It runs `npm install` and `npm run build` in that
  directory, with the CLI's environment less every variable whose name ends
  in `KEY`, `TOKEN`, `SECRET`, `PASSWORD` or `CREDENTIAL(S)`
  (`buildEnvironment` in `src/cli-args.ts`), so the provider key never
  reaches code a model wrote. If the build fails it asks for one repair with
  the compiler's output, rewrites the project and builds once more.
- `--base` sends the project in that directory as the base, so the run is a
  follow-up patch. It prints what the patch kept, changed, added and
  removed.
- `--style` takes a preset id exactly as `STYLE_PRESETS` in
  `src/style-presets.ts` spells it: camelCase, so `bentoGrid`, `liquidGlass`
  and `warmTerminal`. An unknown id is refused before anything is spent.

With exactly one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and
`DEEPSEEK_API_KEY` set, that provider answers with its default model
(`DEFAULT_MODELS` in `src/select-client.ts`). `VIBLD_MODEL` names another from
the catalog, and `VIBLD_PROVIDER` chooses when more than one key is set;
with more than one and no `VIBLD_PROVIDER`, Anthropic answers.

Anthropic's default is `claude-opus-5-5`, whose catalog rates
(`src/model-catalogue.ts`) are about 13 times DeepSeek Flash's for input and
17 times for output, so a run on it costs far more than one on DeepSeek's
default, `deepseek-flash`. The DeepSeek runs measured on 2026-09-30 cost
$0.15 to $0.31 and took 7 to 17 minutes each.

Each step of the bounded build is printed as it starts, with the second it
started at, and the run ends with its token use per step.

The `--out` form is the portability check from ADR-0002: the output must build
with ordinary npm commands and no Vibld anything.
`.github/workflows/clean-clone.yml` runs it with `--build` weekly on a fresh
clone of the public repository with one key.

## In the builder

The builder shell is a static SPA served from a public URL, so it never holds
a model key (ADR-0006). A deployed builder reaches this package through its
Worker: `/api/plan` checks sign-in and the spend ledger, then runs the bounded
build as a durable Workflow, one step per call. Locally, `pnpm dev` serves no
`/api`, so the builder runs the deterministic fake instead.

## Design intelligence

`style-presets.ts` (24 named visual directions -- 16 surface treatments and
8 complete color systems), `patterns.ts` (10 marketing
page types, 6 SaaS screens), `palettes.ts` (15 product-type color, typography
and feel defaults), `motion.ts` (19 motion recipes), `surfaces.ts` (5
painting techniques), `diagrams.ts` (5 diagram types plus the connector
craft) and `primitives.ts` (6 interactive controls) are closed-set,
keyword-matched retrieval -- the same shape, for the same reason: a request's
own text selects a handful of relevant, concrete guidance to append to the
prompt, never an arbitrary string a caller supplies directly
(docs/decisions.md L50-L51). `plan-schema.ts`'s `PLAN_SYSTEM_PROMPT` carries
the universal "UX BASELINE", "MOTION" and "CONTENT" sections
alongside these, for the rules that apply regardless of style or product
type.

Every palette's values in `palettes.ts` are adapted from
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
(MIT License) -- a much larger, actively-searched design-intelligence dataset
(89 styles, 192 product/palette pairs, 119 UX guidelines) meant to be queried
by a local Python tool at generation time. Neither the tool nor live
retrieval fits here yet (no Python runtime in a Worker, no retrieval
infrastructure until internal issue 12/D13 exists -- see `patterns.ts`'s own comment), so
what is ported is a hand-picked, adapted subset of the underlying values:
real hex tokens and real Google Fonts pairings, restated as CSS custom
properties mapped into Tailwind v4's `@theme` (`theme-css.ts`) rather than the
source's Tailwind v3 config strings.

Motion and copy voice were added later, from a second pass over more
MIT-licensed design skills. What was taken, and from where:

- **[emilkowalski/skills](https://github.com/emilkowalski/skills)** (MIT) --
  the timing in `motion.ts` and in the prompt's `MOTION` section: the
  entrance curve, the per-element duration table, and the frequency gate
  ("the more often something is triggered, the less it animates"). The
  recipes were plain CSS until ADR-0014 moved generated projects to Motion
  and made motion expressive by default; the numbers carried over. It also
  corrected a rule this package was already shipping: reduced motion means
  _fewer and gentler_, not none.
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
  safeguard against over-correcting into affectless prose. The prompt's
  inflated-significance and model-tell phrase lists match humanizer's own
  lists. The sales-register list is this project's own, written in
  humanizer's format.
- **[AThevon/genjutsu](https://github.com/AThevon/genjutsu)** (MIT) -- its
  `css-native` skill is the source of four `motion.ts` entries
  (`scroll-driven`, `view-transition`, `discrete-transition`,
  `anchor-position`) and of all of `surfaces.ts`. Each replaces a library
  with a platform feature, which is the same trade `STACK` already makes.
  Its dated browser-support claims are deliberately not carried over: that
  skill version-stamps them because they perish, and a perishable fact baked
  into a prompt goes stale silently and is never corrected. The durable half
  is the discipline (guard the feature, keep the content usable without it),
  and a test asserts that no recipe names a browser.

One licensing question was decided by the project owner rather than here.
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
catalogs about seventy real companies' design languages. The owner directed
that the archetypes drawn from it ship without the companies' names, which is
what `style-presets.ts` does. A test enforces it on the id, chip name and
caption.

### The generated stack

Generated projects are built on Tailwind CSS v4, shadcn/ui on Radix,
lucide-react and Motion (ADR-0014), at the versions in `stack.ts`. The
prompt, the fake scaffold in `apps/web` and the eval's stub plan all read that
one list, and CI builds the stub, so a set that stops installing or compiling
together fails there before a user's generation finds out. Versions are named
because a model choosing its own picks ranges that disagree, and a failed
install buys a paid repair.

Tokens are emitted in one shape by `theme-css.ts`: shadcn's names on `:root`,
and an `@theme inline` block that maps them into Tailwind so `bg-primary`
and `rounded-md` mean this design's values.

A dialog, sheet, popover, dropdown menu, select, combobox, tooltip, tabs or
accordion is always the shadcn/ui component, never divs, and `primitives.ts`
carries the anatomy for each, because hand-rolling one produces a defect the
person who asked cannot see. The
Radix part names were read from the installed package's type declarations
rather than recalled.

### Diagrams

`diagrams.ts` is a deliberate capability rather than a rescue. A request that
says "show how the system fits together" otherwise gets a stack of styled
divs, an `<img>` pointing at a file that does not exist, or a charting library
added against `STACK`. Inline SVG in a React component fits the stack exactly;
the reason it was not already the answer is that the craft is unforgiving,
and a diagram is either legible or it is decoration.

Adapted from
[cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
(MIT). Its own deliverable is a standalone HTML file sized to a fixed viewBox,
produced through an interactive pipeline with a style-guide gate, a
confirm-before-drawing step and a Python geometry verifier. None of that
transfers to one-shot generation and none of it is ported. What is ported is
pure craft: the six connector rules, the elbow and hop path formulae, and the
layout grammar per diagram type. The formulae matter more than the rules they
serve, because "use rounded elbows" without the path data produces a
different curve every run, and usually a diagonal.

Two of its rules are deliberately left behind. It bans shadows outright and
caps corner radius at 6-10px. Those are house style for its own output, and as
general rules they would contradict the `claymorphism`, `neumorphism` and
`depth` presets shipped here, so the guidance defers to the project's own
tokens instead. A test asserts both bans stayed out.

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

### The eight tokened archetypes

Clustering that corpus showed that its useful content is structural, not
nominal: "dark" is really four unrelated systems, and a warm paper ground
with a terracotta accent is its own thing rather than a tint of minimalism.
Those clusters are `warmTerminal`, `layeredVoid`, `acidDark`, `nightIndigo`,
`warmPaper`, `monoPress` and `polarityBands` -- presets that carry a whole
color system, font pairing and radius scale rather than only a sentence.
`cinematic` (full-bleed footage, glass and a serif headline) carries the same
three and was added after them.

They fill a real hole. `buildUserPrompt` suppresses the product-type palette
whenever a style preset is chosen, so before these existed, picking a preset
meant getting no color tokens at all. Their token names are identical to
`ProductPalette.colors`, so the `:root` block the prompt receives has one
shape whichever source produced it.

`contrast.ts` verifies all eight text pairs per archetype at 4.5:1 in the
test suite. That check is not ceremony: several of the source corpus's own declared pairs fail it, because
it records real brands faithfully rather than vetting them.

Naming them after the companies is deliberately not done, and a test enforces
it -- the id, chip name and caption are the surface a trademark claim attaches
to.

## Model selection

`DEFAULT_MODEL` (`claude-opus-5-5`, in `plan-provider.ts`) and
`DEFAULT_MODELS` (one per provider, in `select-client.ts`) exist so the
providers run, and are **not** a selection. D10 reserves that for a measured
bakeoff with an approved spending cap; the model, effort and token ceiling
are all constructor options so a bakeoff can sweep them without touching
this code.
