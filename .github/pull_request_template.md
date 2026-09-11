<!--
Thank you for contributing. CONTRIBUTING.md has the full working
agreements; this template covers what a reviewer needs to evaluate the
change without reconstructing it from the diff.
-->

## Problem

<!-- What doesn't work, or doesn't exist, before this change. Link the
     issue it closes, if one exists. -->

## Approach

<!-- What you changed and why this approach, specifically if there was a
     simpler one you considered and rejected. If this touches a public
     contract, package boundary, security assumption or generated-project
     convention, say so explicitly and link the governing ADR or accepted
     decision (docs/decisions.md) -- CONTRIBUTING.md asks that those be
     discussed before implementation, not discovered in review. -->

## Validation

<!-- Exact commands run and their results -- `pnpm format:check`,
     `pnpm --filter <pkg> typecheck`, `test`, `build` -- not "tests pass."
     For a bug fix, show the failure reproduced before the fix and resolved
     after. Tests should cover behavior, not implementation detail. -->

## Security impact

<!-- Explicitly state "none" if that's genuinely true, rather than leaving
     this blank. If the change touches credentials, sandboxed execution,
     tenant isolation, permission enforcement, or anything else SECURITY.md
     names as an invariant, describe how this change preserves it. -->

## Follow-up

<!-- Anything scoped out of this PR on purpose, with an issue link if one
     exists. Leave empty if there is none -- don't invent follow-up to fill
     the section. -->

---

- [ ] Signed off under the [DCO](https://developercertificate.org/) (`git commit -s`)
- [ ] Reviewed any AI-assisted contributions in this PR for correctness, provenance and license compatibility
