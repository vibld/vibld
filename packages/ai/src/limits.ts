/**
 * Budgets on what a single request may send to the model.
 *
 * They live in their own module because three places need them and only one
 * of those may import a provider SDK: the provider enforces them, the Worker's
 * request guard refuses a request that would exceed them before a run is paid
 * for, and the browser sizes its own inputs by them. Importing them from the
 * package barrel would carry the Anthropic SDK into the browser bundle -- a
 * mistake already made once, which doubled it.
 *
 * They are constants rather than configuration because they describe what the
 * prompt can hold, not a policy anyone should tune per deployment.
 */

/**
 * The largest base project that will be sent with a follow-up request.
 *
 * Generated projects are capped at 25 files by the system prompt and 50 by
 * the request guard, and the measured 24-file project was about 120 KB. It
 * exists because a budget nobody states is a budget nobody can check.
 *
 * This used to say the figure was "headroom rather than a limit anyone
 * should meet", and that is no longer true, so it is corrected here rather
 * than left to mislead the next reader. A run may now emit up to
 * `maxTokensFor(model)` tokens, which on the production model is 252000 and
 * was 64000 before #179. Even the old ceiling could produce a project past
 * this cap; the current one clears it several times over. What that should
 * mean is open in #181, which also covers the separate problem that this
 * constant is a model-context budget yet currently gates `/api/preview` and
 * `/api/publish`, where nothing reaches a model.
 *
 * Until that is settled, treat this as a limit that is genuinely reachable:
 * a project can be generated that a follow-up request cannot carry. The
 * refusal is explicit on both sides (`request-guard.ts` returns 413,
 * `plan-provider.ts` throws `ProviderContextError`) and neither truncates,
 * so the failure costs a user their next edit, never their work.
 */
export const MAX_BASE_CONTENT_CHARS = 160_000;

/**
 * The largest set of standing instructions a project can carry.
 *
 * Standing instructions are prose a person writes once and stops thinking
 * about -- "keep it dark, no rounded corners" -- so they are short by nature.
 * The cap exists because they are sent on every turn: unbounded, they would
 * be a cost that grows quietly and never gets re-read.
 */
export const MAX_KNOWLEDGE_CHARS = 2_000;

/**
 * The largest extracted-text excerpt a reference URL may contribute to a
 * prompt.
 *
 * The fetch that fills this (`apps/web/worker/reference-fetch.ts`) already
 * truncates to this figure before the text ever reaches a provider, so this
 * constant is really documentation of that contract plus the number the
 * worst-case cost estimate in `apps/web/worker/index.ts` adds in -- a page
 * someone points at could be enormous, and nothing downstream should have to
 * guess how much of it might arrive.
 */
export const MAX_REFERENCE_CHARS = 6_000;
