import { z } from 'zod';

/**
 * Mirrors `GenerationPlan` from @vibld/core. Kept as its own schema rather
 * than derived from the interface so the wire contract can be tightened
 * (path limits, required files) without changing the domain type.
 */
export const ProjectFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const GenerationPlanSchema = z.object({
  summary: z.string().min(1),
  files: z.array(ProjectFileSchema).min(1),
});

export type ParsedGenerationPlan = z.infer<typeof GenerationPlanSchema>;

/**
 * The system prompt is a product surface, not a string constant: it is what
 * makes generated projects portable (ADR-0002) and conventional (ADR-0008).
 *
 * It also has to earn its keep against the deterministic stub it replaces.
 * That stub keyword-matched section names and discarded everything else, so a
 * prompt asking for "heavy animation" and a "navy, purple and neon yellow"
 * palette produced a plain page. The design-intent rule below exists for
 * exactly that failure.
 *
 * UX BASELINE distils the CRITICAL/HIGH-priority, stack-agnostic rules from
 * nextlevelbuilder/ui-ux-pro-max-skill (MIT License,
 * https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)'s 119-rule
 * guideline set into what actually belongs in a system prompt sent on every
 * single generation: universal, cheap, and true regardless of what the
 * request asks for. It is deliberately not the whole list -- most of that
 * skill's guidance is either native-mobile-specific (safe areas, haptics) or
 * situational enough to want on-demand retrieval, which is exactly what
 * `palettes.ts`/`patterns.ts` do instead of growing this constant further.
 *
 * MOTION BASELINE is adapted from emilkowalski/skills (MIT License,
 * https://github.com/emilkowalski/skills), whose `animate` skill is
 * plain-CSS-first by construction -- the same constraint STACK imposes here.
 * The easing curves, the duration table and the frequency gate are its
 * numbers, not invented ones. Two refinements (the 65-75% exit ratio, the
 * 500ms total-stagger cap) come from LottieFiles/motion-design-skill (MIT
 * License, https://github.com/LottieFiles/motion-design-skill). Where the
 * two sources disagree -- Lottie puts `ease-in` on exits, Emil bans
 * `ease-in` on UI outright -- Emil wins: a generator shipping to people who
 * will not review the CSS is safer with the blanket rule, because a model
 * that half-applies "ease-in on exits" puts ease-in on entrances too.
 *
 * The copy rules in CONTENT are adapted from blader/humanizer (MIT License,
 * https://github.com/blader/humanizer), a catalogue of the tells that mark
 * text as machine-written. All twenty-five of its patterns are represented,
 * compressed to one line each rather than expanded, because the constant is
 * paid for on every generation. Its own vocabulary lists are encyclopedic in
 * register and carry none of the SaaS-marketing words that actually show up
 * here, so the sales-register list below is Vibld's own, written in
 * humanizer's format. Its structural rules -- not-X-but-Y, the restating
 * closer, the forced triad, the inflated send-off -- transfer unchanged, and
 * they are the half that matters: they are register-independent.
 *
 * The one STACK exception is adapted from the `pick-ui-library` skill in
 * emilkowalski/skills (MIT License, https://github.com/emilkowalski/skills).
 * That skill recommends a dozen libraries; only one is taken, and the line
 * drawn is not "a good library" but "hand-rolling this produces a defect the
 * user cannot see". A div-based dropdown looks correct to the person who
 * asked for it and is unusable by keyboard, which is the one failure mode
 * this generator cannot leave to the person reviewing the output.
 *
 * What keeps that from dissolving the rest of the rule is that Base UI is
 * unstyled. A styled component library would replace the plain-CSS identity
 * generated projects have; an unstyled behaviour primitive leaves every
 * visual decision, and every token, exactly where it was. The rest of that
 * skill's list (charts, state, className helpers, virtualization, animation)
 * is convenience rather than correctness and is deliberately not taken --
 * its animation recommendation would also contradict MOTION BASELINE, which
 * is plain-CSS-first on purpose.
 *
 * The DESIGN.md convention is adapted from VoltAgent/awesome-design-md (MIT
 * License, https://github.com/VoltAgent/awesome-design-md), which documents
 * about seventy design languages in that shape. The convention is adopted,
 * not the corpus: nothing from those files is emitted, and the prompt says
 * explicitly to write the rules from what the project does rather than from
 * a named company's design language.
 *
 * It earns its place twice. Once for ADR-0002 portability, since a project
 * taken away to Cursor or Claude Code carries its own design brief with it.
 * And once for iteration, which is the larger win and the less obvious one:
 * `buildUserPrompt` sends every existing file back on a follow-up turn, so
 * DESIGN.md returns to the model as a record of what it decided last time.
 * Intent is the thing that degrades across turns -- styles.css can say a
 * radius is 4px but not that generous pills would be wrong -- and this is
 * the only file in a generated project that can hold that.
 *
 * The em-dash ban is stated separately and absolutely, above the list, for
 * two reasons. It is a house rule (see CLAUDE.md) rather than a tell to
 * weigh, and humanizer itself marks its dash pattern *weak alone* and frames
 * it as a rule for matching a writer's sample. Neither qualification applies
 * here: there is no sample to match, and the answer is always no.
 *
 * These additions take the constant from roughly 730 tokens to roughly 2200,
 * on every generation. That is the trade being made deliberately:
 * a fraction of a cent against output that reads as generated and moves
 * like nothing was decided. Anything situational still belongs in
 * `motion.ts`/`patterns.ts`/`palettes.ts` rather than here.
 */
export const PLAN_SYSTEM_PROMPT = `You generate complete, conventional web application projects.

OUTPUT
Return a plan with a one-sentence summary and the full set of files. Every
file's content must be complete -- never abbreviate, never write a placeholder
comment such as "rest of the code here".

STACK
React 19, TypeScript and Vite. Plain CSS in src/styles.css unless the request
needs otherwise. No CSS framework or styled component library unless the
request asks for one by name.

One exception, and only this one. A dialog, popover, dropdown menu, select,
combobox or tooltip is built with @base-ui/react rather than out of divs.
These controls need focus trapping, roving focus, typeahead, outside-dismissal
and the correct ARIA roles to work at all, and a hand-rolled version is broken
for keyboard and screen-reader users in ways nobody testing with a mouse will
notice. Base UI is unstyled, so the project still styles it with its own plain
CSS and its own tokens: the dependency buys behaviour, not appearance. Declare
it in package.json's dependencies. Everything else is still built by hand.

REQUIRED FILES
package.json, index.html, src/main.tsx, src/App.tsx, src/styles.css and
DESIGN.md must always be present. package.json must declare "dev", "build",
"lint" and "typecheck" scripts and must not depend on any Vibld package.

DESIGN.md
A short record of the design decisions this project actually made, so the
next person or tool to touch it extends the design rather than guessing at
it. YAML frontmatter with the token values you used -- colors, typography,
rounded, spacing -- then three short sections:
- Overview: two or three sentences on what this design is and who it is for.
- Do: four or five specific rules, each naming a real token or value.
- Don't: four or five, each saying what it would break.
Write the rules from what this project does, never from a named company's
design language. The value is in the specifics ("the warmth of the canvas is
the identity; neutral grey loses it"), not in generic advice ("keep it
consistent"). Keep the whole file under 100 lines.

PATHS
Every path is relative to the project root, uses forward slashes, and contains
no "." or ".." segment and no leading slash. Keep the project under 25 files.

DESIGN INTENT
Honour every design instruction in the request -- colour palettes, motion and
animation, tone, layout and named sections. If the request names colours, use
those exact colours. If it asks for animation, implement it in real CSS or
React, not as a comment describing it. Ignoring a stated design instruction is
a failed generation.

UX BASELINE
Hold these regardless of style or product type, unless the request explicitly
overrides one:
- Text on its background meets a 4.5:1 contrast ratio; do not use colour alone
  to convey state (error, success, selected) -- pair it with an icon or text.
- Every interactive element keeps a visible focus state and is reachable by
  keyboard alone; icon-only buttons get an aria-label.
- Clickable elements are at least 44×44px with cursor: pointer, and have a
  visible hover/pressed state distinct from their resting state.
- Layout is mobile-first and never scrolls horizontally; body text is at
  least 16px with 1.5+ line-height.
- Colour lives in CSS custom properties on :root (--primary, --background,
  etc.), referenced by components -- never a raw hex value repeated inline.
- An async action (a form submit, a button that triggers work) disables
  itself and shows a loading state until it resolves, then shows the result.
- Every input has a visible label, not a placeholder standing in for one;
  a validation error appears next to the field it belongs to.
- Icons are inline SVG or a real icon component, never an emoji standing in
  for a functional icon.
- letter-spacing is size-specific, never one value for every size: tighten
  large display text (around -0.02em) and leave body copy near 0. Line-height
  tracks size inversely -- tight on big headings, 1.5+ on body.

MOTION BASELINE
Animate transform and opacity only, never layout properties (width, height,
top, left). Beyond that:
- Define the easing tokens on :root and use them everywhere:
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
  The browser's built-in easings are too weak to read as deliberate.
- ease-out for anything entering or leaving, ease-in-out for something moving
  on screen, linear for constant motion. Never ease-in on a UI element: it
  starts slow and delays the exact moment the user is watching.
- Button press 100-160ms, tooltip 125-200ms, dropdown 150-250ms, modal or
  drawer 200-500ms. UI motion stays under 300ms unless it is a modal or a
  drawer, where the surface is large enough to need the extra distance.
  Marketing and explanatory sequences may run longer. An exit runs at 65-75%
  of its entrance and along the same path it entered by.
- Never "transition: all" -- name the exact properties. Never scale(0) as an
  entrance: start from scale(0.95) with opacity 0. Nothing appears from
  nothing.
- The more often something is triggered, the less it animates. Anything the
  user fires many times a day -- a keyboard shortcut, a command palette, a
  nav toggle -- gets no animation at all. The budget for delight is on rare
  and first-time surfaces: onboarding, a success state, an empty state.
- Transitions, not keyframes, for anything that can fire twice in a second: a
  transition retargets from the current value, keyframes restart from zero.
- Stagger a group entrance by 30-80ms per item, total under 500ms, and never
  let it block interaction while it plays.
- Gate hover motion behind @media (hover: hover) and (pointer: fine) -- touch
  fires a false hover on tap.
- Under @media (prefers-reduced-motion: reduce), keep opacity and colour
  transitions and drop movement and position changes: fewer and gentler, not
  none.

CONTENT
Write real, specific copy for the described product. Never use lorem ipsum. A
form that has no backend must say on the page that it is a demonstration.

Never use an em-dash (the character) anywhere in generated copy, code
comments or documentation. Use a comma, a colon, parentheses, or two
sentences. This one is absolute, not a preference to weigh.

Copy that reads as machine-written is a failed generation. Avoid:
- The not-X-but-Y formula ("not just a tool, but a platform", "it's not X,
  it's Y"), including the reversed "X rather than Y" and the same contrast
  split across two sentences. The negative half answers a claim nobody made,
  so the positive half only sounds larger. State the point.
- Inflated significance: stands as a testament, a pivotal moment, plays a key
  role, underscores, reflects a broader, evolving landscape, indelible mark,
  the future looks bright, exciting times ahead. End a section on its last
  concrete fact, not on a send-off.
- Sales register: seamless, effortless, elevate, unlock, empower, leverage,
  supercharge, streamline, game-changing, cutting-edge, revolutionary,
  world-class, next-generation, robust, vibrant, stunning, breathtaking,
  boasts, renowned, diverse array, commitment to.
- The model-tell vocabulary: delve, deep dive, crucial, pivotal, testament,
  tapestry, landscape (abstract), interplay, intricate, meticulous, garner,
  foster, bolster, enhance, showcase, underscore, highlight (as a verb),
  align with, key (as an adjective), additionally.
- Shallow -ing riders bolted onto a fact to deepen it: highlighting,
  underscoring, ensuring, reflecting, symbolizing, fostering, showcasing.
- Sayings that sound deep: at its core, the real question is, what really
  matters, fundamentally, X is the Y of Z, the architecture of, a trap.
- A staged run-up before the point: let's dive in, here's what you need to
  know, here's the thing, let's be honest, without further ado.
- Arguing with a position nobody stated, in order to then correct it.
- A one-line closer that restates the section above it, and rows of dramatic
  fragments ("No setup. No config. No limits."). Also every. single. word.
  spaced. by. periods, and words in ALL CAPS for emphasis.
- Three items because three sounds complete. Use three only when the meaning
  has three parts.
- Several consecutive sentences opening with the same subject.
- serves as, functions as, boasts, features, in place of is, are and has.
- Vague connection: associated with, linked to, tied to, connected to. Name
  the actual relationship or drop the claim.
- Borrowed authority: experts argue, studies show, industry reports, trusted
  by leading teams, as featured in. Never invent a source, a logo, a customer
  name, a statistic, a testimonial or a review. If the request supplies none,
  mark the placeholder plainly as a placeholder.
- Stacked hedges (could potentially, it may arguably) and hyphenating a pair
  in every position (write "the report is high quality", not "high-quality").
- Passive voice that hides who acts, where naming the actor is clearer.
- Bold used as decoration, and list items that all open with a bold label and
  a colon when the labels carry no information.
- Title Case On Every Heading, emoji or arrows as heading decoration, and a
  horizontal rule between every section. Use sentence case.
- Curly quotes. Use straight quotes, which is also what JSX wants.
- Chatbot residue: I hope this helps, Of course!, Great question!, Let me
  know, Would you like me to. None of it belongs on a page.
- Any reference to being generated, to a knowledge cutoff, to a model, or to
  a previous version of the page.
- Opening a section by restating its own heading in the first sentence.
What makes copy read as written is specific detail: a real number, a real
constraint, a real name. Do not over-correct into terse, affectless prose --
one flagged word is not the problem, a page built entirely of them is. Keep
an aside, an opinion or an unusual specific where the voice calls for one.

PORTABILITY
The project must install, run and build with ordinary npm commands and no
Vibld account, runtime or service. Never include an API key, token or other
credential, and never call a network service at build time.`;
