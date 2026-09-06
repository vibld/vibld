# ADR-0007: Durable generation, staged changes and revision-scoped context

- Status: Accepted
- Date: 2026-09-06
- Decision owner: Chris Brock
- Approval: D8(c), D9(a), D10(a), D11(a), D12(a), D13(c), D18(a)
- Refines: ADR-0002 and ADR-0003

## Context

Generation can fail after changing files or completing a remote operation. Blind retries can duplicate commits or overwrite a user's edits. Repository retrieval can also return stale or unauthorized content. M1 needs a controlled first build and a durable checkpoint before M2 broadens editing.

## Decision

Use a persisted state machine with stages for planning, context selection, staged edits, installation, validation, bounded repair, checkpoint promotion and result delivery. Record run ID, base revision, template/model versions, policy snapshot and safe diagnostics. One implementation agent holds the project writer lease at a time; use fencing or conditional revision checks so an expired writer cannot promote a stale result. Distinct planning/review prompts do not require a multi-agent scheduler.

Stage file operations against a known base hash. Enforce canonical paths and file limits, validate the staged project, then promote via a compare-and-set of the accepted revision. Keep the prior checkpoint on failure or conflict. Persist accepted code and its history outside the sandbox before declaring the save successful.

Use stable operation identifiers and recorded results for external side effects. After an ambiguous GitHub response, inspect remote state before retrying. Workflows retries alone do not provide exactly-once commits, PR creation or deployment. Make cancellation, timeout, replay and interrupted promotion test cases explicit.

Put AI SDK behind Vibld-owned structured request/response and event types. Configure the intended provider rather than relying on an implicit gateway/default. Use a fake provider in normal CI; gate real integrations behind explicit credentials and budgets. Select an initial model through a fixture-based bakeoff and validate a second real provider before making broad independence claims.

Combine exact file/symbol search with semantic retrieval. Scope every chunk and lookup to authorized tenant, project and revision; invalidate changed or deleted content. Treat retrieved instructions as untrusted input, and exclude secrets from indexing. A PostgreSQL/pgvector implementation is the initial candidate under the selected storage architecture; the embedding provider remains open. Disclose source processing by embedding providers before indexing user repositories.

GitHub uses a scoped App connection. M1 supports branches and PRs for Vibld-generated repositories, with user-approved destinations, revocation and conflict handling. Verify webhook signatures and deduplicate delivery. Do not silently force-push, merge, publish a repository or change its visibility. Arbitrary repository import and broad bidirectional editing remain later work.

## Consequences

Checkpoint recovery, writer conflicts, stale indexing and duplicate side effects become release tests. Broad autonomy operates within service-enforced grants from ADR-0006. M1 scope includes initial repair; conversational editing and its larger regression suite remain M2.

Evaluation measures first-pass and post-repair success, independent export/build, failure recovery and cost including failed runs. Proposed initial repair limits and numeric targets belong in the implementation plan and must be calibrated before making reliability claims.

## Alternatives considered

- A single unbounded chat loop: lacks explicit recovery and authorization boundaries.
- Direct in-place writes: risks exposing partial or invalid changes as accepted work.
- Whole-repository context on every request: unnecessary cost and avoidable disclosure.
- Semantic retrieval alone: weak on exact identifiers and stale-revision handling.
- GitHub as the only backup: prevents durable standalone projects when disconnected.

## References

- [Cloudflare Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Supabase pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
