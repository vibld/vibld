# @vibld/eval

Repeatable evidence that generation works, and that it fails safely.

```sh
pnpm --filter @vibld/eval run eval   # run the set and print a report
pnpm --filter @vibld/eval test       # the same checks, as a CI gate
```

## What it measures

**The versioned prompt set** (`src/cases.ts`). Five prompts, each with stated expectations: files the accepted project must contain, and content it must mention. A project that builds cleanly but never mentions coffee is not a coffee roaster's site, and that is a failure a compiler cannot see.

The set is versioned because a score means nothing without knowing what was asked. Changing a prompt, adding one, or changing what counts as success changes the number — so `PROMPT_SET_VERSION` moves with it, and every report carries it. Comparing runs across versions is comparing different exams.

**Portability** (`src/portability.ts`). Accepted output is checked for the properties ADR-0002 promises: conventional scripts, the files a person needs to install and understand it, no `.vibld/` directory, no dependency on a Vibld package. A run that produces an unportable project has not succeeded, whatever it rendered.

**Injected failures** (`src/scenarios.ts`). The easy half is proving things work. These prove what happens when they don't — a staged file escaping the project root, a provider dying mid-run, a second writer landing first, a sandbox evicted with work in flight, output that would tie the project to Vibld. Every one asserts both that the run reached a terminal state and that **the checkpoint the user already had is still there afterwards**. Losing accepted work to a failed run is the outcome that would make the product untrustworthy, so it is the thing most worth proving.

**Cost, including failures.** A refusal or a truncation still spends tokens. A tally that counted only successes would under-report the bill by exactly what the failures cost, so failed runs are counted too.

## What it does not measure

**Generation quality.** CI runs this against a deterministic stub, not a model — so `5/5 accepted` says the machinery and the failure paths work, and says nothing about whether a model writes a good website. The report states this wherever it prints a score, because a number that looks like a quality measure will be read as one unless it is contradicted in place.

A real baseline needs a provider and an approved spend cap ([#9](https://github.com/vibld/vibld/issues/9), [#18](https://github.com/vibld/vibld/issues/18)). The proposed gate in [#10](https://github.com/vibld/vibld/issues/10) — 10 prompts × 3 runs, at least 27/30 within two repair attempts — is a target to calibrate against that baseline, not a reliability guarantee, and not something a stub can be measured against.

**Post-repair success.** There is no repair loop yet ([#16](https://github.com/vibld/vibld/issues/16)). Reporting a post-repair figure before one exists would be reporting a number nobody earned, so the report gives first-pass results only.

**Expired grants.** There is no permission system to expire yet ([#15](https://github.com/vibld/vibld/issues/15)). A scenario for it would report a pass for something nobody built.

## Adding a case

Add it to `CASES` with expectations that could actually fail, and raise `PROMPT_SET_VERSION`. A case whose `expects` is empty passes unconditionally and makes the score worse than useless — `test/harness.test.ts` refuses one.
