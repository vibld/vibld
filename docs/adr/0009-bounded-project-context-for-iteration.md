# ADR-0009: Send the whole generated project when iterating on it

- Status: Proposed
- Date: 2026-09-09
- Decision owner: Chris Brock
- Refines: ADR-0007

## Context

ADR-0007 lists "whole-repository context on every request" among the
alternatives it declines, for "unnecessary cost and avoidable disclosure", and
prescribes exact search combined with semantic retrieval, scoped to tenant,
project and revision. That is issue #12, and it needs storage and an embedding
provider that Vibld does not yet have.

In the meantime `buildUserPrompt` sent the base project's file **paths** and
asked the model to "return the complete set of files for the updated project,
preserving anything the request does not ask you to change".

That instruction cannot be obeyed. A model cannot preserve content it has
never been shown. The generation machine replaces the project's file set with
whatever the plan returns, so every follow-up request rewrote the project from
scratch, and the second prompt -- the one iteration exists for -- silently threw
the first away. The shell now presents runs as a conversation, which makes the
gap between what the interface implies and what the engine does worse rather
than better.

## Decision

When a request carries a base project, send its files' contents, not only
their paths, bounded by a stated budget.

- The budget is `MAX_BASE_CONTENT_CHARS` (160,000), declared in `@vibld/ai`
  beside the prompt it bounds. Generated projects are capped at 25 files by the
  system prompt and 50 by the request guard; the measured 24-file project was
  about 120 KB. The budget is headroom, not a limit anyone should meet.
- A project over the budget is **refused, never truncated**. A truncated
  project would be returned as though it were the whole one, and every file
  that did not fit would be deleted on promotion -- losing the user's work in
  order to save tokens.
- The request guard refuses it first, so an oversized project costs nothing;
  the provider refuses it too, so the rule holds for any caller.
- The project is sent as JSON, in the same shape the model must return. A
  delimited format would let a file whose contents contain the delimiter
  appear to end the data and begin an instruction.
- The prompt states that the returned file set _is_ the project, so a file
  left out is deleted.
- The worst-case spend ceiling counts prompt **and** project. Counting the
  prompt alone under-stated the input side of a follow-up by roughly forty
  times.

## Consequences

Iteration works: a follow-up request edits the project instead of replacing
it. Input cost per follow-up rises with project size -- at list price a 120 KB
project is about 30,000 input tokens, roughly $0.15 -- and the ceiling now
accounts for it rather than under-reporting.

This is **not** a general answer to repository context and does not reduce the
need for #12. It applies only to a project Vibld generated in this session,
inside the file cap, that the user is actively editing: there is no third
party's code and nothing to disclose. Arbitrary repository import, which
ADR-0007 also defers, still requires retrieval before it can be considered.

The budget is a wall rather than a gradient. A project that grows past it
stops being editable, with a legible error rather than silent damage, until
retrieval lands.

## Alternatives considered

- **Leave it as paths only.** Honest about cost, but ships an iterative
  builder that does not iterate, and an instruction the model cannot follow.
- **Truncate to fit.** Silently deletes the files that did not fit. The worst
  option available: it fails without saying so, and the failure destroys work.
- **Wait for retrieval (#12).** The right long-term answer, and unavailable:
  it needs storage and an embedding provider that have not been provisioned.
- **Send a diff of what changed.** Requires the model to have the prior
  content to apply it against, which is the thing being withheld.
- **Ask a cheap model for a search plan, then use exact search.** Found after
  this ADR was written, by reading open-lovable's `analyze-edit-intent` route:
  it sends a one-line summary per file and asks a small model for search terms
  and regex patterns rather than for file contents, then greps. This is the
  exact-search half of what ADR-0007 prescribes, working without the semantic
  half -- so it needs no vector store and no embedding provider, and it is a
  real option now rather than after #12. It costs one extra model call per
  turn, and it can silently miss a file the plan did not think to look for,
  which the decision above cannot. It should be measured against this decision
  rather than assumed better. See docs/lovable-gap-analysis.md.
