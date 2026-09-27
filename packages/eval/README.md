# @vibld/eval

Repeatable evidence that generation works, and that it fails safely.

```sh
pnpm --filter @vibld/eval run eval                      # the set, against the stub
pnpm --filter @vibld/eval run eval --case vibld-marketing   # one case
pnpm --filter @vibld/eval test                          # the same checks, as a CI gate
```

## What it measures

**The versioned prompt set** (`src/cases.ts`). Nine prompts, each with stated expectations: files the accepted project must contain, and content it must mention. A project that builds cleanly but never mentions coffee is not a coffee roaster's site, and that is a failure a compiler cannot see. An expectation can be a list of wordings, any one of which meets it, for a claim a page can make in more than one way.

The set is versioned because a score means nothing without knowing what was asked. Changing a prompt, adding one, or changing what counts as success changes the number -- so `PROMPT_SET_VERSION` moves with it, and every report carries it. Comparing runs across versions is comparing different exams.

**Portability** (`src/portability.ts`). Accepted output is checked for the properties ADR-0002 promises: conventional scripts, the files a person needs to install and understand it, no `.vibld/` directory, no dependency on a Vibld package. A run that produces an unportable project has not succeeded, whatever it rendered.

**Whether it builds** (`bin/build-candidates.ts`). Passing the eval's checks means the plan passed validation and mentions what was asked for; it never meant the project builds, and the stub's own project did not (internal PR 59). So CI writes one stub case out and runs `npm install` and `npm run build` on it, and the bakeoff runs the same script on every candidate in a separate job that holds no provider key, because a candidate's build config is code a model wrote. In the bakeoff a project that does not build is rejected, however well it did on the checks (see below). Portability also checks that each script's tool (`vite`, `tsc` and a few others) is a declared dependency. Candidates install with `--ignore-scripts`, so portability also refuses a project whose own install runs a lifecycle script, naming the script, rather than letting it fail its build for a reason that is not in its build.

**Injected failures** (`src/scenarios.ts`). The easy half is proving things work. These prove what happens when they don't -- a staged file escaping the project root, a provider dying mid-run, a second writer landing first, a sandbox evicted with work in flight, output that would tie the project to Vibld. Every one asserts both that the run reached a terminal state and that **the checkpoint the user already had is still there afterwards**. Losing accepted work to a failed run is the outcome that would make the product untrustworthy, so it is the thing most worth proving.

**Cost, including failures.** A refusal or a truncation still spends tokens. A tally that counted only successes would under-report the bill by exactly what the failures cost, so failed runs are counted too.

## What it does not measure

**Generation quality** by default. CI runs this against a deterministic stub, not a model -- so `9/9 accepted` says the machinery and the failure paths work, and says nothing about whether a model writes a good website. The report states this wherever it prints a score, because a number that looks like a quality measure will be read as one unless it is contradicted in place.

A real baseline needs a provider and an approved spend cap (internal issue 9, internal issue 18). The proposed gate in internal issue 10 -- 10 prompts × 3 runs, at least 27/30 within two repair attempts -- is a target to calibrate against that baseline, not a reliability guarantee, and not something a stub can be measured against.

**Post-repair success, outside the bakeoff.** `bin/eval.ts` reports first attempts only. The bakeoff adds one repair turn for a project that did not build, because the product has exactly that one (below); repairs the product does not make are not reported, since that would be a number nobody earned (internal issue 16).

**Expired grants.** There is no permission system to expire yet (internal issue 15). A scenario for it would report a pass for something nobody built.

## Running against a real model

The stub proves the machinery and says nothing about whether a model writes a
good website. This is how to find out:

```sh
VIBLD_EVAL_LIVE=1 \
VIBLD_EVAL_MODELS=claude-opus-5,claude-sonnet-5,gpt-5.6-luna \
VIBLD_EVAL_OUT=./candidates \
pnpm --filter @vibld/eval run eval --case vibld-marketing
```

Each model runs the selected cases independently and gets its own report, so
the comparison reads side by side instead of as one pooled score that hides
which model earned what. `VIBLD_EVAL_OUT` writes each accepted project to
`<out>/<model>/<case>/`, because the point of measuring generation is to look
at what came out.

### Repeated runs

One generation says whether a model can do a thing. It cannot say whether it
does it reliably, and the gate proposed in internal issue 10
is written in exactly those terms: 10 prompts, 3 runs each. `VIBLD_EVAL_RUNS`
is that multiplier.

```sh
VIBLD_EVAL_LIVE=1 \
VIBLD_EVAL_MODELS=claude-opus-5,gpt-5.6-luna \
VIBLD_EVAL_RUNS=3 \
VIBLD_EVAL_OUT=./candidates \
pnpm --filter @vibld/eval run eval --case vibld-marketing
```

Each model then prints a stability table under its report:

```
Stability
  vibld-marketing: 2/3 accepted (accepted, ignored the request, accepted)
```

Unanimous cases print the tally alone. The run-by-run outcomes are only
interesting where the runs disagreed, and printing them everywhere would bury
the rows that did.

With repeats, `VIBLD_EVAL_OUT` writes to `<out>/<model>/<case>/run-N/`. Each
repeat keeps its own directory, because otherwise the last run would clear and
replace the ones before it and the variance the repeats were paid for would
exist only in the printed tally.

It multiplies the bill by the same number it multiplies the runs, so the value
is read strictly: a whole number from 1 to 10, and nothing else. `1e2` is
refused rather than read as a hundred, and a count above ten is refused rather
than charged, since the difference between ten and a mistyped three hundred is
the whole budget. Raising the ceiling is an edit to `MAX_RUNS` in
`src/live.ts`.

Spend is measured from the usage each provider reports, priced from the
catalogue, and printed in cents. Cents rather than dollars because the
cheapest model in the catalogue finishes a case for well under a cent, and a
dollar figure rounded to two places prints that as `$0.00`.

**`VIBLD_EVAL_LIVE` is the only thing that starts spending.** A key in the
environment is never enough on its own, because this same command runs in CI.
A live run is refused before it costs anything if it names no model, names a
model the catalogue does not have, or names one whose provider key is not set.

## The bakeoff: two figures per model

`.github/workflows/bakeoff.yml` runs the live eval against several models and
reports, for each:

- **accepted as generated**: the first attempt passed the eval's checks, and
  `npm install` and `npm run build` succeeded;
- **accepted after one repair**: the above, plus the runs that passed the
  checks, failed to install or build, and then passed the checks and built
  after one repair turn.

A failed build is a rejection (Chris, 2026-09-27). Until then "accepted" meant
the checks alone, and the bakeoff that prompted the change scored a model 2/3
when one of the two did not build.

The repair is the product's repair (`src/repair.ts`). The model is sent the
exact build error, in the product's repair prompt (`repairPromptFor`, shared
from `@vibld/ai`, with the design findings the product also sends), and the
candidate's files as the project to edit, handed to the provider as
`request.base` by the same runner the product uses. Its DESIGN.md is held to
the first attempt's, as the product holds it. Only a failure that is the
project's buys one, as in the product: an install or a build that ran and
failed, not a timeout. The repaired project is held to the same checks as the
first attempt and then built the same way. A run that failed its checks is
never repaired: the repair is sent a build error, which is not what is wrong
with it.

Cost is reported per model as generation, repair and the total, each measured
from the usage the provider reported, failures included.

### Five jobs, and why they are split

| Job              | Holds keys | Does                                                                                                |
| ---------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `bakeoff`        | yes        | generates the candidates and writes `eval-results.json`                                             |
| `build`          | no         | installs and builds every candidate (`--results`)                                                   |
| `repair`         | yes        | one repair turn per candidate that passed the checks and did not build (`bin/repair-candidates.ts`) |
| `build-repaired` | no         | installs and builds what the repair wrote                                                           |
| `report`         | no         | joins the four result files into one table (`bin/bakeoff-report.ts`)                                |

The split follows one rule with no exceptions: code a model wrote only ever
runs in a job with no secrets, and a job that holds keys only ever reads a
candidate's files as text. A candidate's `package.json` and build config are
model-written code, and `npm install` and `npm run build` run them, so a build
in a keyed job would hand every provider key to whatever a model wrote. So the
two keyed jobs never install, build or execute a candidate, and the two build
jobs have no environment, no secrets and no persisted Git credential, and
build each candidate in a container of its own. Only files cross between
jobs, as artifacts. The build results come from a job that ran model code, so
the repair job reads them as data of a known shape and nothing more.

The `report` job is the gate. It fails unless every run was accepted after at
most one repair, which is how the bakeoff has always reported a rejected run,
applied to the final answer. The build jobs no longer fail for a candidate
that does not build: with `--results` that is a result, and they fail only
when they could not produce trustworthy results.

The files the jobs hand each other are described in `src/bakeoff.ts`, which
also joins them.

## The `vibld-marketing` case

The other cases are plausible briefs nobody can grade beyond "does it mention
coffee". This one describes the site that is live at vibld.com, so its output
can be held against a real page with real copy. It is deliberately a brief
rather than a design: what the page must say and do, with every visual
decision left to the model, because the design is the thing being measured.

It is also the only case that requires `DESIGN.md` and `src/styles.css`. A run
that renders something handsome but records none of its decisions has not
produced anything portable, and the tokens are the portable part.

Its portability claim can be made in any of several wordings ("portable", "no
lock-in", "take it with you", and so on; the list is in `src/cases.ts`). Until
prompt set 1.8.0 it had to be the word "portable", and in the 2026-09-27
bakeoff every model lost a run to a page that made the claim in other words.
Every wording on the list still has to mean the claim: a bare "export" is left
out because every component file says it.

## Adding a case

Add it to `CASES` with expectations that could actually fail (a wording in a list of alternatives has to be one that code does not contain by accident), give it a style preset no other case uses, and raise `PROMPT_SET_VERSION`. Each case asks for its own preset because that is how a real run is made, and with none every case converged on one look. A case whose `expects` is empty passes unconditionally and makes the score worse than useless -- `test/harness.test.ts` refuses one.
