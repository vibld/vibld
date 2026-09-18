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

/**
 * The largest visual direction a mockup prompt may carry (#185).
 *
 * A mockup run sends the caller's prompt plus, when they have already chosen
 * a preset, that preset's direction from `style-presets.ts`. Both go to the
 * model, so both are input tokens the reservation has to have covered before
 * the run starts.
 *
 * Like `MAX_REFERENCE_CHARS` above, this is really documentation of a
 * contract: the directions are written here in this repository rather than
 * supplied by a caller, so nothing truncates to it. What makes it true is
 * `mockup-schema.test.ts`, which walks every preset and fails if one grows
 * past it. Without that the number would be a guess that silently stopped
 * being an upper bound the next time somebody wrote a longer description,
 * and the worst case would quietly understate the bill.
 */
export const MAX_MOCKUP_DIRECTION_CHARS = 2_000;

/**
 * The fixed prompt text every mockup run sends, whoever is asking (#189
 * review).
 *
 * `MOCKUP_SYSTEM_PROMPT` goes on every run and `MOCKUP_STYLE_PREAMBLE` on
 * every styled one. Neither comes from the caller, which is exactly why the
 * worst case forgot them: I bounded what a caller could send and then
 * reserved as though that were the whole prompt. It is not, by about 1,600
 * characters, and an account with precisely the computed reservation left
 * was admitted for a run that settled past it.
 *
 * Documentation of a contract again, like the two bounds above, and pinned
 * the same way: `mockup-schema.test.ts` measures the real text and fails if
 * it grows past this. Without that walk the number would be a guess that
 * stopped being an upper bound the next time somebody added a paragraph to
 * the prompt, and the ceiling would quietly stop holding.
 */
export const MAX_MOCKUP_FIXED_PROMPT_CHARS = 2_500;

/**
 * The largest chosen mockup a build request may carry (#185).
 *
 * Picking a direction has to mean something. Seeding the next prompt with
 * the direction's name would let the build ignore it and still look like it
 * had obeyed, which is the kind of confident wrong answer this codebase
 * keeps having to remove. So the document itself travels, and the build is
 * asked to turn that page into the project.
 *
 * Where the figure came from: `MOCKUP_OUTPUT_TOKENS` was thought to buy
 * three mockups, so one of them was about a third of it, at roughly four
 * characters a token -- 18,000 / 3 * 4. That is an origin story, not a
 * derivation, and this comment used to call it one (#189 review). Nothing
 * makes a model split its budget three ways, and nothing fixes four
 * characters to a token, so a run really can produce a direction larger
 * than this.
 *
 * The premise under that story has since been measured false as well
 * (#190): two thirds of a mockup run's output tokens are reasoning, so the
 * ceiling never bought three documents' worth of documents, and it is no
 * longer a budget at all. The arithmetic is kept here as history, because
 * the number it produced is still the number, and the reason that is safe
 * is below rather than above.
 *
 * What makes the number safe is therefore not the arithmetic above but
 * `MockupSchema`, which bounds every generated `html` at exactly this
 * figure. A direction too large for the build to accept back is refused
 * where it is produced, rather than offered and then rejected after the run
 * has been paid for and a choice made.
 */
export const MAX_CHOSEN_MOCKUP_CHARS = 24_000;

/**
 * The whole prompt section a chosen direction contributes, document and all
 * (#189 review).
 *
 * The build's worst case counted `MAX_CHOSEN_MOCKUP_CHARS` and stopped,
 * which is the document by itself. `chosenMockupSection` also sends the
 * label through `JSON.stringify` -- so a 60-character label can serialise
 * to more than 60 -- and about 470 characters of fixed framing that names
 * the document as data rather than instruction. That framing is the part
 * that keeps a mockup from becoming a second prompt, so it is not optional
 * and it is not free.
 *
 * The same mistake as the mockup route's own reservation, mirrored: there I
 * counted what a caller may send and forgot the system prompt; here I
 * counted what a caller may send and forgot the wrapper. Pinned the same
 * way, by `chosen-mockup-prompt.test.ts` building the largest section this
 * can produce and measuring it.
 */
export const MAX_CHOSEN_MOCKUP_SECTION_CHARS = 25_000;

/**
 * The longest reference URL a request may carry (#189 review).
 *
 * Not `MAX_REFERENCE_CHARS` above, which bounds the text fetched *from* that
 * address. This bounds the address itself: generous next to what a real
 * address bar accepts, tight next to what a request could otherwise pad its
 * body with.
 *
 * Here rather than as a literal in the Worker's guard because the form has
 * to declare the same number. The field was a bare `type="url"`, so an
 * over-long address was perfectly valid markup, passed the browser's check,
 * paid for a look, was kept for the build that choosing a direction submits,
 * and was refused there by the guard -- after the spending, on a bound the
 * field could have carried from the start. `maxLength` in the markup means
 * the value cannot be typed or pasted in at all, on the button and on
 * `Generate` alike, and the guard still enforces it for anything that did
 * not come through the form.
 */
export const MAX_REFERENCE_URL_CHARS = 2_048;
