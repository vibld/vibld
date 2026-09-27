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
 * was 64000 before internal PR 179. Even the old ceiling could produce a project past
 * this cap; the current one clears it several times over. What that should
 * mean is open in internal issue 181, which also covers the separate problem that this
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
 * How much of `MAX_REFERENCE_CHARS` the reference's measured CSS values may
 * take (`measureDesign`). The page's text gives up that much room, so the
 * reference's total never grows past the figure above.
 */
export const MAX_REFERENCE_MEASURE_CHARS = 1_500;

/**
 * The largest visual direction a mockup prompt may carry (internal issue 185).
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
 *
 * 3,200 since the directions carry the `@theme inline` block that maps
 * their tokens into Tailwind (ADR-0014): about 900 characters, which took
 * the longest (cinematic) to 2,919.
 */
export const MAX_MOCKUP_DIRECTION_CHARS = 3_200;

/**
 * The fixed prompt text every mockup run sends, whoever is asking (internal PR 189
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
 * The largest chosen mockup a build request may carry (internal issue 185).
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
 * derivation, and this comment used to call it one (internal PR 189 review). Nothing
 * makes a model split its budget three ways, and nothing fixes four
 * characters to a token, so a run really can produce a direction larger
 * than this.
 *
 * The premise under that story has since been measured false as well
 * (internal PR 190): two thirds of a mockup run's output tokens are reasoning, so the
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
 * (internal PR 189 review).
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
 *
 * The section now also carries the values `measureMockup` reads from the
 * document's CSS, bounded by `MAX_MOCKUP_MEASURE_CHARS` plus about 330
 * characters of framing, which is why this grew from 25,000.
 */
export const MAX_CHOSEN_MOCKUP_SECTION_CHARS = 28_500;

/**
 * Everything a build sends the model that nobody typed: the system prompt
 * and the guidance `buildUserPrompt` retrieves for the request (patterns,
 * motion, surfaces, diagrams, primitives, palette, style direction).
 *
 * None of it was in the build's reservation. The mockup route learned this
 * lesson in internal PR 189 (`MAX_MOCKUP_FIXED_PROMPT_CHARS`), the build never did, and
 * the spec added to `PLAN_SYSTEM_PROMPT` made the gap larger. Measured at
 * about 13,000 characters of system prompt and up to about 9,300 of
 * guidance; the bound leaves room for the catalogues to grow a little
 * without a silent under-reservation, and `mockup-reservation.test.ts` in
 * apps/web measures the real text against it, in both directions.
 */
export const MAX_BUILD_FIXED_PROMPT_CHARS = 32_000;

/**
 * The longest reference URL a request may carry (internal PR 189 review).
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

/**
 * How large a project is, in the unit every budget here is written in: each
 * file's path plus its content, in characters.
 *
 * One function because the question is asked in more than one place and the
 * answers have to agree. The request sizes a follow-up's reservation from it
 * and the run then measures the same project again (internal issue 209); two reducers that
 * drifted apart would reserve for one project and run against another.
 */
export function projectChars(
  files: readonly { path: string; content: string }[],
): number {
  return files.reduce(
    (sum, file) => sum + file.path.length + file.content.length,
    0,
  );
}

/**
 * Characters one output token carries, for an estimate rather than a count.
 *
 * Four is what this repository already estimates with everywhere a provider
 * omits its own usage numbers (`openai-client.ts`, `deepseek-client.ts`), so
 * it is written down once here rather than becoming a fourth literal that
 * can drift from the other three.
 */
export const CHARS_PER_OUTPUT_TOKEN = 4;

/**
 * The largest share of a run's output tokens ever measured reaching the
 * answer, the rest of them having gone to thinking.
 *
 * The answer's share rather than the thinking's, because that is the term it
 * is used in, and a subtraction is where a reader loses track of which end of
 * a range they are holding.
 *
 * Measured, not assumed (internal PR 190), and a range rather than a figure: on a
 * measured mockup run the thinking was between 57% and 68% of the output
 * tokens, which leaves the answer between 32% and 43%. That range is already
 * written down in `ProgressReport` (`generation-run.ts`), and this is the 43.
 *
 * The favourable end, so the estimate it feeds never overstates what a run
 * needed. It once drove a refusal and the far end would have turned away
 * runs that could have finished (internal PR 208 review); it now only explains a
 * truncation, where the same choice keeps the explanation from telling
 * somebody their project was further out of reach than it was.
 *
 * One sample on one kind of run. Re-measure when the catalogue or the
 * provider changes.
 */
export const LARGEST_OBSERVED_ANSWER_SHARE = 0.43;

/**
 * The smallest share of a run's output tokens ever measured reaching the
 * answer: the other end of the range `LARGEST_OBSERVED_ANSWER_SHARE` comes
 * from (internal PR 190), where thinking took 68%.
 *
 * Two constants because the same measurement is used in two directions, and
 * which end is the safe one flips between them (internal PR 210 review). Explaining a
 * failure after the fact must not overstate what a run needed, so it takes
 * the favourable end. Sizing a run before it starts must not *under*state
 * it, or the room reserved for carrying the project runs out partway and the
 * run truncates for exactly the reason the room was reserved to prevent. So
 * sizing takes this end.
 */
export const SMALLEST_OBSERVED_ANSWER_SHARE = 0.32;

/**
 * The output tokens to reserve for carrying a project back out, when sizing
 * a follow-up before it runs (internal issue 209).
 *
 * The same arithmetic as `outputTokensToRewrite`, at the other end of the
 * measured range, for the reason `SMALLEST_OBSERVED_ANSWER_SHARE` gives. Too
 * large costs a caller a larger reservation, which is settled back to what
 * the run really used; too small costs them the run.
 */
export function outputTokensToCarry(baseChars: number): number {
  const answer = Math.ceil(Math.max(0, baseChars) / CHARS_PER_OUTPUT_TOKEN);
  return Math.ceil(answer / SMALLEST_OBSERVED_ANSWER_SHARE);
}

/**
 * Roughly the output tokens a follow-up run needs to rewrite a project of a
 * given size, for explaining a truncation that has already happened.
 *
 * A follow-up is asked to "return the complete set of files", so the model
 * re-emits the whole project even to change one line of it (the alternative,
 * sending paths alone, made the instruction unfulfillable and threw the
 * user's work away -- see `existingProjectSection` in `plan-provider.ts`).
 * When such a run is cut off at its ceiling, this is the figure that makes
 * the failure legible: the project is this large, the run had this much
 * room, and a model with a larger output budget has more.
 *
 * An estimate, and used only where being roughly right is enough. Both of
 * its terms are estimates: four characters a token is a rule of thumb that
 * token-efficient content beats, and the share of output reaching the answer
 * rather than the thinking is one measured sample.
 *
 * It was written first as a refusal, to stop a doomed run before it spent
 * ten and a half minutes and a full charge, and that was wrong twice (internal PR 208
 * review). A product of two estimates proves nothing cannot fit. And a
 * follow-up may *shrink* a project -- "delete the blog", "cut it back to one
 * page" -- so the base is not even a lower bound on the output: refusing on
 * it would mean a project that outgrew a model's ceiling could never be
 * edited back down by that model.
 *
 * So it explains rather than decides. Sizing a run to the job it has, which
 * is what would actually have prevented that failure, is internal issue 209.
 */
export function outputTokensToRewrite(baseChars: number): number {
  const answer = Math.ceil(Math.max(0, baseChars) / CHARS_PER_OUTPUT_TOKEN);
  return Math.ceil(answer / LARGEST_OBSERVED_ANSWER_SHARE);
}

/** Most uploaded files one build's prompt lists (the account quota is 30). */
export const MAX_MEDIA_ENTRIES = 30;

/**
 * The largest media section a build sends: the fixed framing, and for each
 * of `MAX_MEDIA_ENTRIES` files its path, kind, poster path and up to 300
 * characters of alt text, JSON-quoted (so up to 600 when every character
 * needs escaping). `mockup-reservation.test.ts` in apps/web builds the
 * largest one and measures it against this.
 */
export const MAX_MEDIA_SECTION_CHARS = 24_000;
