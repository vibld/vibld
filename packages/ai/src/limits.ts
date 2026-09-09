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
 * the request guard, and the measured 24-file project was about 120 KB, so
 * this is headroom rather than a limit anyone should meet. It exists because
 * a budget nobody states is a budget nobody can check.
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
