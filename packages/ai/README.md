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

## Model selection

`DEFAULT_MODEL` exists so the adapter runs, and is **not** a selection. D10
reserves that for a measured bakeoff with an approved spending cap; the model,
effort and token ceiling are all constructor options so a bakeoff can sweep
them without touching this code.
