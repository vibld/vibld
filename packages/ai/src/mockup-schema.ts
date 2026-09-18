import { z } from 'zod';

import { MAX_CHOSEN_MOCKUP_CHARS } from './limits.ts';

/**
 * Three directions to look at before committing to a build (#185).
 *
 * Chris's question was whether to offer mockups before attempting the whole
 * thing, and the answer chosen was three cheap rendered HTML mockups rather
 * than images. Rendered rather than drawn is what makes them honest: an
 * image of a design is a promise the generator has not made, while a page
 * the browser lays out is the same kind of artefact the build produces, at
 * a smaller size.
 *
 * One self-contained document each. No external stylesheet, no script, no
 * font host: a mockup is shown in the same sandboxed frame a preview is
 * (ADR-0004), and one that needed the network would render differently
 * there than in the build it is supposed to be predicting.
 */
/**
 * The longest label a tile will carry, and the bound `parseChosenMockup`
 * enforces on the way back.
 *
 * Exported because the guard had its own `60` with a comment saying it
 * "matches `MockupSchema`'s own bound, so the two cannot disagree" -- which
 * was a claim about a number nothing was keeping in step (#189 review).
 * They cannot disagree now; before, they only happened to agree.
 */
export const MAX_MOCKUP_LABEL_CHARS = 60;

export const MockupSchema = z.object({
  /**
   * A short name for the direction, shown on its tile.
   *
   * Trimmed before the non-empty check, for the reason `html` below is:
   * `.min(1)` counts spaces and `parseChosenMockup` does not, so a label of
   * whitespace produced a nameless tile that could be chosen and then
   * refused, after the run was paid for (#189 review).
   *
   * The same fix twice in one file is worth naming rather than quietly
   * repeating: I fixed `html` when it was found and did not ask which other
   * field had the same shape.
   */
  label: z
    .string()
    .max(MAX_MOCKUP_LABEL_CHARS)
    .refine((label) => label.trim().length > 0, {
      message: 'A mockup needs a name, not whitespace.',
    }),
  /**
   * One sentence on what this direction is for. Not a description of it.
   *
   * Trimmed too, and this one is consistency rather than a defect:
   * `parseChosenMockup` never sees the rationale, because only the label
   * and the document travel into a build. A blank sentence would be a tile
   * with nothing under its name, which is worth refusing on its own.
   */
  rationale: z
    .string()
    .max(400)
    .refine((rationale) => rationale.trim().length > 0, {
      message: 'A direction needs a reason, not whitespace.',
    }),
  /**
   * One complete HTML document, bounded by what the build will accept back
   * (#189 review).
   *
   * The two numbers have to agree and nothing was making them: this schema
   * took any length, while `parseChosenMockup` refuses past
   * MAX_CHOSEN_MOCKUP_CHARS. A run could therefore offer a direction its
   * own build route would reject, after the person had paid for the run and
   * chosen it -- the worst moment to find out.
   *
   * My derivation of that cap assumed three mockups split the budget evenly
   * at four characters a token. Neither is guaranteed: a model can spend
   * most of its budget on one of them. So the bound is enforced here rather
   * than inferred, and a direction too large to build is never offered.
   */
  html: z
    .string()
    .max(MAX_CHOSEN_MOCKUP_CHARS)
    // Trimmed before the non-empty check, because `.min(1)` counts spaces
    // and `parseChosenMockup` does not (#189 review). A document of
    // whitespace renders as a blank tile, reads as a direction that failed,
    // and is then refused on the way back -- the same paid-run-then-
    // unbuildable failure the bound above exists to prevent.
    .refine((html) => html.trim().length > 0, {
      message: 'A mockup needs a document, not whitespace.',
    }),
});

/**
 * Two to four, though the prompt asks for exactly three.
 *
 * Strictness here would be paid for by the reader. The run is already spent
 * by the time this parses, and a set of two usable directions is still a
 * choice: discarding it to enforce a number the person never sees would
 * turn a partly-good answer into no answer and a second bill. The chooser
 * renders what arrived rather than assuming three.
 */
export const MockupSetSchema = z.object({
  mockups: z.array(MockupSchema).min(2).max(4),
});

export type ParsedMockup = z.infer<typeof MockupSchema>;
export type ParsedMockupSet = z.infer<typeof MockupSetSchema>;

/**
 * What a mockup run asks for, which is not a smaller version of a build.
 *
 * A build is asked for a working project. This is asked for three ways of
 * looking at the same request, and the value is in how far apart they are:
 * three tasteful variations on one idea is the failure mode, because it
 * gives the reader nothing to decide. So the instruction leads with
 * distinctness and names the axes that make directions genuinely different.
 *
 * Deliberately not the build's system prompt with a smaller ceiling. That
 * prompt carries the portability, convention, motion and copy rules a
 * shippable project needs (ADR-0002, ADR-0008); a mockup ships nothing, and
 * paying for those rules on every tile would spend the budget that is
 * supposed to make this cheap.
 */
export const MOCKUP_SYSTEM_PROMPT = `You produce three short visual directions for a website, as rendered HTML mockups, so a person can choose one before the real project is built.

Return JSON: { "mockups": [ { "label", "rationale", "html" } ] } with exactly three entries.

THE POINT IS THE DIFFERENCE
The three must be genuinely different answers to the request, not three finishes on one answer. Vary the things a person would actually choose between: the layout's structure, the typographic register, the colour temperature and contrast, the density, and how much the page relies on imagery versus type. If two of them could be described by the same sentence, one of them is wasted.

EACH MOCKUP
- label: two or three words naming the direction, in the reader's language, not a style-system term.
- rationale: one sentence on who or what this direction suits. Not a description of what is on the page, which they can see.
- html: one complete, self-contained document. Inline <style> only. No external stylesheet, no script, no web font, no image URL, no network reference of any kind.

WHAT A MOCKUP IS
The hero and enough of the page below it to show the direction: roughly one to two screens. Real words about the actual subject, never lorem or placeholder. Use CSS gradients, shapes and type for imagery rather than linking pictures. Keep each document small; this is a sketch that happens to be real HTML, not a first draft of the project.

Body text must stay legible against its background in every direction, including the dark ones.`;

/**
 * What a styled run says around the chosen preset's direction.
 *
 * Its own constant because the reservation has to count it (#189 review).
 * The worst case bounded the caller's prompt and the style direction and
 * nothing else, while every run also sends `MOCKUP_SYSTEM_PROMPT` and a
 * styled one sends this as well: about 1,600 characters of input that was
 * reserved for nobody. An account with exactly the computed reservation
 * left was admitted and then settled past it.
 */
/**
 * The user prompt a mockup run actually sends.
 *
 * Exported so the route can measure what was sent without rebuilding it
 * (#189 review). A cancelled run has to be settled from the real prompt,
 * and the only alternative was a second copy of this concatenation in
 * `handleMockups` -- which is the two-places-that-must-agree problem this
 * PR has tripped over repeatedly, in a place where disagreeing means
 * mischarging somebody.
 */
export function mockupUserPrompt(
  prompt: string,
  direction: string | null,
): string {
  return direction ? `${prompt}${MOCKUP_STYLE_PREAMBLE}${direction}` : prompt;
}

export const MOCKUP_STYLE_PREAMBLE =
  '\n\nStay within this visual direction; vary the three within it rather than against it.\n\n';
