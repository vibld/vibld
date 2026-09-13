# @vibld/eval

Repeatable evidence that generation works, and that it fails safely.

```sh
pnpm --filter @vibld/eval run eval                      # the set, against the stub
pnpm --filter @vibld/eval run eval -- --case vibld-marketing   # one case
pnpm --filter @vibld/eval test                          # the same checks, as a CI gate
```

## What it measures

**The versioned prompt set** (`src/cases.ts`). Five prompts, each with stated expectations: files the accepted project must contain, and content it must mention. A project that builds cleanly but never mentions coffee is not a coffee roaster's site, and that is a failure a compiler cannot see.

The set is versioned because a score means nothing without knowing what was asked. Changing a prompt, adding one, or changing what counts as success changes the number -- so `PROMPT_SET_VERSION` moves with it, and every report carries it. Comparing runs across versions is comparing different exams.

**Portability** (`src/portability.ts`). Accepted output is checked for the properties ADR-0002 promises: conventional scripts, the files a person needs to install and understand it, no `.vibld/` directory, no dependency on a Vibld package. A run that produces an unportable project has not succeeded, whatever it rendered.

**Injected failures** (`src/scenarios.ts`). The easy half is proving things work. These prove what happens when they don't -- a staged file escaping the project root, a provider dying mid-run, a second writer landing first, a sandbox evicted with work in flight, output that would tie the project to Vibld. Every one asserts both that the run reached a terminal state and that **the checkpoint the user already had is still there afterwards**. Losing accepted work to a failed run is the outcome that would make the product untrustworthy, so it is the thing most worth proving.

**Cost, including failures.** A refusal or a truncation still spends tokens. A tally that counted only successes would under-report the bill by exactly what the failures cost, so failed runs are counted too.

## What it does not measure

**Generation quality** by default. CI runs this against a deterministic stub, not a model -- so `5/5 accepted` says the machinery and the failure paths work, and says nothing about whether a model writes a good website. The report states this wherever it prints a score, because a number that looks like a quality measure will be read as one unless it is contradicted in place.

A real baseline needs a provider and an approved spend cap ([#9](https://github.com/vibld/vibld/issues/9), [#18](https://github.com/vibld/vibld/issues/18)). The proposed gate in [#10](https://github.com/vibld/vibld/issues/10) -- 10 prompts × 3 runs, at least 27/30 within two repair attempts -- is a target to calibrate against that baseline, not a reliability guarantee, and not something a stub can be measured against.

**Post-repair success.** There is no repair loop yet ([#16](https://github.com/vibld/vibld/issues/16)). Reporting a post-repair figure before one exists would be reporting a number nobody earned, so the report gives first-pass results only.

**Expired grants.** There is no permission system to expire yet ([#15](https://github.com/vibld/vibld/issues/15)). A scenario for it would report a pass for something nobody built.

## Running against a real model

The stub proves the machinery and says nothing about whether a model writes a
good website. This is how to find out:

```sh
VIBLD_EVAL_LIVE=1 \
VIBLD_EVAL_MODELS=claude-opus-5,claude-sonnet-5,gpt-5.6-luna \
VIBLD_EVAL_OUT=./candidates \
pnpm --filter @vibld/eval run eval -- --case vibld-marketing
```

Each model runs the selected cases independently and gets its own report, so
the comparison reads side by side instead of as one pooled score that hides
which model earned what. `VIBLD_EVAL_OUT` writes each accepted project to
`<out>/<model>/<case>/`, because the point of measuring generation is to look
at what came out.

Spend is measured from the usage each provider reports, priced from the
catalogue, and printed in cents. Cents rather than dollars because the
cheapest model in the catalogue finishes a case for well under a cent, and a
dollar figure rounded to two places prints that as `$0.00`.

**`VIBLD_EVAL_LIVE` is the only thing that starts spending.** A key in the
environment is never enough on its own, because this same command runs in CI.
A live run is refused before it costs anything if it names no model, names a
model the catalogue does not have, or names one whose provider key is not set.

## The `vibld-marketing` case

The other cases are plausible briefs nobody can grade beyond "does it mention
coffee". This one describes the site that is live at vibld.com, so its output
can be held against a real page with real copy. It is deliberately a brief
rather than a design: what the page must say and do, with every visual
decision left to the model, because the design is the thing being measured.

It is also the only case that requires `DESIGN.md` and `src/styles.css`. A run
that renders something handsome but records none of its decisions has not
produced anything portable, and the tokens are the portable part.

## Adding a case

Add it to `CASES` with expectations that could actually fail, and raise `PROMPT_SET_VERSION`. A case whose `expects` is empty passes unconditionally and makes the score worse than useless -- `test/harness.test.ts` refuses one.
