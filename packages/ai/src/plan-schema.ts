import { z } from 'zod';

import { DesignSpecReadSchema, DesignSpecSchema } from './design-spec.ts';
import { SCAFFOLD_SECTION } from './scaffold.ts';
import { stackVersionLine } from './stack.ts';

/**
 * Mirrors `GenerationPlan` from @vibld/core. Kept as its own schema rather
 * than derived from the interface so the wire contract can be tightened
 * (path limits, required files) without changing the domain type.
 */
export const ProjectFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

/**
 * What a model is asked to return: the summary, the design spec it is
 * building to, then the files.
 *
 * `spec` sits before `files` on purpose. Structured output is written in
 * schema order, so the spec is decided before the first line of code that
 * implements it, rather than reconstructed from the code afterwards.
 */
export const GenerationPlanSchema = z.object({
  summary: z.string().min(1),
  spec: DesignSpecSchema,
  files: z.array(ProjectFileSchema).min(1),
});

/**
 * What a reply is read with, which is looser than what is asked for.
 *
 * Anthropic and OpenAI constrain their output to `GenerationPlanSchema`, so
 * a spec always arrives. DeepSeek has JSON mode and no schema, and a reply
 * whose files are fine and whose spec is missing or malformed has still
 * built what the person asked for: failing that run, after they have paid
 * for it, over a design record would be the wrong trade. So a spec that
 * does not parse reads as absent, and the project is kept.
 */
export const GenerationPlanReadSchema = z.object({
  summary: z.string().min(1),
  spec: DesignSpecReadSchema.optional().catch(undefined),
  files: z.array(ProjectFileSchema).min(1),
});

export type ParsedGenerationPlan = z.infer<typeof GenerationPlanReadSchema>;

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
 * UX BASELINE holds the stack-agnostic rules that actually belong in a
 * system prompt sent on every single generation: universal, cheap, and true
 * regardless of what the request asks for. It is deliberately short.
 * Guidance that is native-mobile-specific (safe areas, haptics) does not
 * belong here, and guidance situational enough to want on-demand retrieval
 * is what `palettes.ts`/`patterns.ts` provide instead of growing this
 * constant further.
 *
 * MOTION's timing is adapted from emilkowalski/skills (MIT License,
 * https://github.com/emilkowalski/skills): the entrance curve, the duration
 * bands and the frequency gate are its numbers, not invented ones. Two
 * refinements (the 65-75% exit ratio, the stagger cap) come from
 * LottieFiles/motion-design-skill (MIT License,
 * https://github.com/LottieFiles/motion-design-skill). Where the two
 * disagree -- Lottie puts `ease-in` on exits, Emil bans `ease-in` on UI
 * outright -- Emil wins, because a model that half-applies "ease-in on
 * exits" puts ease-in on entrances too. What changed in ADR-0014 is the
 * default: the section used to be restrained by construction, and the
 * maintainer chose expressive motion by default, carried by Motion rather
 * than hand-written CSS. The frequency gate survives that change on
 * purpose: expressive belongs on the hero and the reveal, not on a control
 * pressed fifty times a day.
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
 * STACK names the whole generated stack (ADR-0014): Tailwind v4, shadcn/ui
 * on Radix, lucide-react and Motion, at the versions `stack.ts` holds. It
 * used to be plain CSS with one unstyled dependency, and every generated
 * page converged on the same look; the maintainer chose this stack so pages
 * can reach what current design tools produce. The rule that dialogs, menus
 * and the like are never hand-rolled rests on one test: a
 * div-based dropdown looks correct to the person who asked for it and is
 * unusable by keyboard, which is the one failure this generator cannot
 * leave to the person reviewing the output.
 *
 * LAYOUT AND TYPE exists for the same reason the stack changed: given no
 * direction, models reach for a centred hero, three cards and Inter, so the
 * section names that default and rules it out.
 *
 * DESIGN.md is a design-language document in a conventional shape. The
 * prompt says explicitly to write its rules from what the project does
 * rather than from a named company's design language.
 *
 * It earns its place twice. Once for ADR-0002 portability, since a project
 * taken away to another coding agent carries its own design brief with it.
 * And once for iteration, which is the larger win and the less obvious one:
 * `buildUserPrompt` sends every existing file back on a follow-up turn, so
 * DESIGN.md returns to the model as a record of what it decided last time.
 * Intent is the thing that degrades across turns -- the stylesheet can say a
 * radius is 4px but not that generous pills would be wrong -- and this is
 * the only file in a generated project that can hold that.
 *
 * DESIGN.md is no longer the model's to write. The model writes a SPEC
 * first, as structured output (`design-spec.ts`), and the provider renders
 * DESIGN.md from it: the frontmatter is the spec itself, as JSON. So the
 * record is exact rather than a retelling, the next turn sees the values
 * rather than a summary of them, and `design-checks.ts` can hold the build
 * to it. The SPEC section below is where the specificity comes from:
 * measured values ("rgba(2,10,18,.57)", "clamp(4.3rem, 8.8vw, 8.3rem)"),
 * copy verbatim, per-width changes, what not to add, and checks a person
 * can see.
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
const PROMPT_HEAD = `You generate complete, conventional web application projects.`;

const PLAN_OUTPUT_SECTION = `OUTPUT
Return a plan with a one-sentence summary, the design spec (see SPEC), and
the full set of files, in that order. Every file's content must be complete
-- never abbreviate, never write a placeholder comment such as "rest of the
code here".`;

const PLAN_SIZE_SECTION = `SIZE
The whole reply, spec and files together, has to fit in one response with
room to spare: aim for well under 40,000 tokens. A reply that runs out of
room is thrown away, and the person gets nothing at all.
- For a large request (a full company site, many pages, many features),
  build a strong first version: the home page with its full set of
  sections, and at most two further routes. Name the pages you left out in
  the summary as next steps the person can ask for.
- Write each piece of copy once, in the file that shows it. The spec's copy
  lists are for the home page's sections only.
- Reuse: a few shared components and a small set of shared Motion variants,
  not bespoke animation code for every element.`;

/**
 * STACK's opening, for a build whose model writes package.json itself: the
 * single-response build (`PLAN_SYSTEM_PROMPT`). A bounded build writes it
 * from `stack.ts` instead (D71), and says so in `BOUNDED_STACK_HEAD`.
 */
const PLAN_STACK_HEAD = `STACK
React 19, TypeScript and Vite, styled with Tailwind CSS v4, with shadcn/ui
components, lucide-react icons and Motion for animation, unless the request
names a different stack.
- Declare exactly these packages, at these ranges, and no others unless the
  request needs one:
${stackVersionLine()}
  dependencies hold the runtime ones; vite, the plugins, tailwindcss,
  tw-animate-css, typescript and the @types packages are devDependencies.`;

/**
 * STACK's opening for a bounded build, whose package.json, tsconfig.json
 * and the rest of FILES WRITTEN FOR YOU are templated (D71,
 * `scaffold.ts`). There is no "unless the request names a different
 * stack": the templates are this stack's.
 */
const BOUNDED_STACK_HEAD = `STACK
React 19, TypeScript and Vite, styled with Tailwind CSS v4, with shadcn/ui
components, lucide-react icons and Motion for animation.
- package.json is written for you (see FILES WRITTEN FOR YOU) and declares
  exactly these packages, at these ranges:
${stackVersionLine()}
  Import only these, and any package the plan's dependencies name.`;

const STACK_RULES = `- Tailwind v4 is configured in CSS, through the @tailwindcss/vite plugin.
  There is no tailwind.config.js and no postcss.config.js. src/styles.css
  opens with any font @import url(...), then @import "tailwindcss"; then
  @import "tw-animate-css";, then @custom-variant dark (&:is(.dark *));.
- shadcn/ui components are source files you write into src/components/ui/,
  as shadcn writes them, on Radix: \`import { Dialog as DialogPrimitive } from
  'radix-ui'\`. Merge classes with cn() from src/lib/utils.ts (clsx plus
  tailwind-merge) and make variants with class-variance-authority. Write only
  the components the page uses; there is no CLI step, the files are the
  components.
- A dialog, sheet, popover, dropdown menu, select, combobox, tooltip, tabs or
  accordion is always the shadcn/ui component on Radix, never divs. These
  controls need focus trapping, roving focus, typeahead, outside-dismissal
  and the correct ARIA roles to work at all, and a hand-rolled version is
  broken for keyboard and screen-reader users in ways nobody testing with a
  mouse will notice.
- Icons are lucide-react components imported by name (\`import { ArrowRight }
  from 'lucide-react'\`), sized with size-4, size-5 and so on. Never an emoji,
  and never a hand-drawn SVG for an icon Lucide has.
- lucide-react ships no brand logos: there is no Github, Twitter, Linkedin,
  Instagram, Facebook, Youtube, Slack or Figma export, and importing one
  fails the build. For a brand, draw its logo as an inline SVG with an
  aria-label, or use a generic Lucide icon (Globe, Mail, AtSign, Rss) beside
  the brand's name.
- Animation is Motion: \`import { motion } from 'motion/react'\` (the package
  is motion, not framer-motion).`;

const PLAN_TYPESCRIPT_HEAD = `TYPESCRIPT
You write this project's tsconfig.json, and the one npm create vite@latest
produces sets both isolatedModules and verbatimModuleSyntax. Write code that
compiles under both, whichever tsconfig you end up writing, and the build
survives either choice. Two rules follow, and breaking either one fails the
build before anything is bundled.`;

const BOUNDED_TYPESCRIPT_HEAD = `TYPESCRIPT
This project's tsconfig.json is written for you, and like the one npm create
vite@latest produces it sets both isolatedModules and verbatimModuleSyntax.
Two rules follow, and breaking either one fails the build before anything is
bundled.`;

const TYPESCRIPT_RULES = `Import a type with a type-only import:

  import type { ReactNode } from 'react';
  import { useState } from 'react';

Under verbatimModuleSyntax an ordinary named import of a type is a TS1484
error, because the import stays in the emitted file after the type is erased
and there is nothing left to import.

Re-export a type with a type-only re-export:

  export type { CardProps } from './components/Card.tsx';
  export { Card } from './components/Card.tsx';

isolatedModules requires this, because esbuild compiles one file at a time and
cannot tell from this file alone whether CardProps is a type or a value. The
same goes for a type imported alongside values: \`import { cva, type
VariantProps } from 'class-variance-authority'\`.

A Motion variants object written outside the JSX is typed Variants, with a
type-only import from 'motion/react', or is one of the shared variants in
src/lib/motion.ts. A cubic-bezier easing array anywhere else is \`as const\`:

  import type { Variants } from 'motion/react';
  const rise: Variants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] } },
  };
  const EASE_OUT = [0.23, 1, 0.32, 1] as const;

Left untyped, TypeScript widens the array to number[] and the object's
strings to string, and passing it to variants= fails the build with TS2322.
A typed variant holds only Motion's own camelCase values: backdropFilter,
never WebkitBackdropFilter or another vendor-prefixed key, which Variants
rejects with TS2353. A vendor prefix belongs in CSS, not in a variant.
A component that spreads its props onto motion.div types them
HTMLMotionProps<'div'> from 'motion/react', not HTMLAttributes<HTMLDivElement>,
whose onAnimationStart and onDrag clash with Motion's and fail with TS2322.`;

/**
 * The configuration and the required files, for the single-response build,
 * whose model writes all of them. A bounded build has `SCAFFOLD_SECTION`
 * in their place.
 */
const PLAN_REQUIRED_FILES = `tsconfig.json sets "types": ["vite/client", "node"], or the import of
src/styles.css fails to compile; "allowImportingTsExtensions": true with
"noEmit": true, so imports can name ./App.tsx; and maps "@/*" to "./src/*"
in "paths", with no "baseUrl": TypeScript 7 removed it, tsc stops at the
tsconfig with TS5102, and "paths" resolves from the tsconfig's own folder
without it.
vite.config.ts maps the same alias, with
\`resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }\`
and plugins [react(), tailwindcss()]. Both are needed: TypeScript reads one,
Vite the other.

REQUIRED FILES
package.json, index.html, vite.config.ts, tsconfig.json, src/main.tsx,
src/App.tsx, src/styles.css, src/lib/utils.ts and README.md must always be
present, and src/main.tsx imports ./styles.css. package.json must declare "dev", "build",
"lint" and "typecheck" scripts and must not depend on any Vibld package.
"build" runs the type check before it bundles (tsc --noEmit && vite build):
Vite strips types without checking them, so a build without tsc ships a type
error as a crash on load. Do
not write DESIGN.md: it is written for you from the spec.

README.md is what someone who has never heard of Vibld reads first: what the
project is, how to install it, how to run it, and how to build it, using the
scripts package.json actually declares. It is the portability promise in
practice (ADR-0002), so write it for a stranger with a terminal, not as a
summary of the request.`;

/** STACK, TYPESCRIPT and the files, for the single-response build. */
const PLAN_RULES_BEFORE_SPEC = [
  `${PLAN_STACK_HEAD}\n${STACK_RULES}`,
  PLAN_TYPESCRIPT_HEAD,
  TYPESCRIPT_RULES,
  PLAN_REQUIRED_FILES,
].join('\n\n');

/**
 * STACK, TYPESCRIPT and the files, for both steps of a bounded build: the
 * same rules for the code, with the configuration and the required files
 * replaced by what the templates hold (D71).
 */
const BOUNDED_RULES_BEFORE_SPEC = [
  `${BOUNDED_STACK_HEAD}\n${STACK_RULES}`,
  BOUNDED_TYPESCRIPT_HEAD,
  TYPESCRIPT_RULES,
  SCAFFOLD_SECTION,
].join('\n\n');

const PLAN_SPEC_SECTION = `SPEC
Before any file, write the spec: the design this project is built to, as
measured values rather than adjectives. "A deep navy glass nav" is not a
spec; "rgba(10,22,31,.37) fill, 1px rgba(255,255,255,.22) border, 50px
pill, blur(18px)" is. Every value in it is one the files actually use.
- intent: one sentence naming the subject, who it is for, and the page's
  single job.
- tokens.colors: every colour the page uses, including overlays and scrims,
  written exactly as the CSS writes it (#07121c, rgba(2,10,18,.57),
  oklch(...)). name is its custom property without the dashes (primary for
  --primary); use says what it is for.
- tokens.fonts: role (display, body, ...), the family as loaded, its
  fallback stack, and the weights loaded.
- tokens.type: each step of the scale with its size (clamp() for display
  sizes), line-height and letter-spacing. Declare each in @theme as
  --text-<name>, so a utility (text-display) and the spec name one value.
- tokens.space and tokens.radii: named values ("gutter" 24px, "pill" 999px).
- tokens.effects: blurs, shadows, gradients and overlays as full CSS values.
- sections: in page order. layout gives measurements (max width, alignment,
  spacing), and copy lists every visible string in the section, verbatim,
  with its role (heading, body, button, label, placeholder, status, link).
- breakpoints: each width where the layout changes and exactly what changes
  there. Use Tailwind's (sm 640, md 768, lg 1024, xl 1280, 2xl 1536) or
  declare your own as --breakpoint-<name> in @theme. Design for 375 and
  1440px as well as the widths between.
- motion: one row for everything that moves, in the order a visitor meets
  it: element (what moves), trigger (load, in view, hover, press, scroll,
  always), behaviour in values (rise 40px and fade in, 80ms stagger), and
  timing as numbers (spring stiffness 120 damping 20, or 200ms ease-out).
  Every row's reduced-motion form is its finished state. Empty only for a
  page with no motion at all. Build each row with exactly its numbers.
- do: four or five rules, each naming a real token or value.
- avoid: four or five things this design must not add, each with what it
  would break ("a second call to action: the email form is the page's one
  job").
- checks: acceptance checks a reviewer can confirm with the page open, each
  one observable fact ("the headline stays on one line at 1440px", "the
  form says it does not send yet").
Write the rules from what this project does, never from a named company's
design language. Then build the files to the spec exactly: every colour is a
custom property on :root with the spec's value (dark values in a .dark
block), mapped in \`@theme inline\` as --color-<name>: var(--<name>) so the
utilities use it (bg-primary, text-muted-foreground); every copy string
appears verbatim; every breakpoint is a responsive variant or @media at that
width. When the project already exists, return its spec updated for this
change.`;

const RULES_AFTER_SPEC = `PATHS
Every path is relative to the project root, uses forward slashes, and contains
no "." or ".." segment and no leading slash. Keep the project under 40 files,
counting the shadcn/ui components in src/components/ui/.

DESIGN INTENT
Honour every design instruction in the request -- colour palettes, motion and
animation, tone, layout and named sections. If the request names colours, use
those exact colours. If it asks for animation, implement it in real code, not
as a comment describing it. Ignoring a stated design instruction is a failed
generation.

LAYOUT AND TYPE
The page should look designed for this subject, not assembled from a
template. Where the request does not decide it:
- Choose the layout from the content. A split hero with the product in use,
  a bento grid of unequal cells, an editorial column with pull quotes, a
  full-bleed image or video with type over it, a sticky scroll story, a
  horizontally scrolling rail. Never default to a centred hero, three
  identical feature cards, a testimonial row and a call-to-action band.
- Vary rhythm: section widths, alignment and density change down the page.
  Let one element break the grid (an oversized numeral, an image bleeding
  off the edge, a heading that overlaps its image).
- Pick typefaces for this subject from Google Fonts: a display face with
  character paired with a readable text face, loaded with the weights used.
  Not Inter, Roboto, Arial, Space Grotesk or a bare system stack as the
  display face. Display type is large and tight: clamp() up to 5-8rem on a
  hero, letter-spacing around -0.03em.
- Use current CSS where it earns its place: oklch() colour and color-mix(),
  layered gradients and grain, backdrop-filter glass over imagery,
  mask-image fades, text-wrap: balance on headings, container queries
  (@container) for components that live in different widths, :has() for
  state, scroll-snap for rails.

UX BASELINE
Hold these regardless of style or product type, unless the request explicitly
overrides one:
- Text on its background meets a 4.5:1 contrast ratio; do not use colour alone
  to convey state (error, success, selected) -- pair it with an icon or text.
- Every interactive element keeps a visible focus state and is reachable by
  keyboard alone; icon-only buttons get an aria-label.
- Clickable elements are at least 44×44px with cursor-pointer (Tailwind v4
  resets buttons to the default cursor), and have a visible hover/pressed
  state distinct from their resting state.
- Layout is mobile-first and never scrolls horizontally; body text is at
  least 16px with 1.5+ line-height.
- Colour lives in CSS custom properties on :root with shadcn/ui's names
  (--background, --foreground, --primary, --primary-foreground, --muted,
  --muted-foreground, --accent, --border, --ring and so on), used through
  utilities (bg-primary, text-muted-foreground, bg-primary/80). Never a raw
  hex in a className or repeated inline.
- An async action (a form submit, a button that triggers work) disables
  itself and shows a loading state until it resolves, then shows the result.
- Data kept in the browser is read inside try/catch, and anything read back
  is checked before it is used: localStorage throws where a visitor blocks
  site data, and a stored value can be missing, malformed or an older shape.
  Either way the app starts from its empty or sample state instead of
  throwing, because a throw in a state initializer leaves a blank page.
  Writes are wrapped the same way, so a full or blocked store never breaks
  the page.
- Every input has a visible label, not a placeholder standing in for one;
  a validation error appears next to the field it belongs to.
- Icons are lucide-react components, never an emoji standing in for a
  functional icon. An icon-only button carries an aria-label, and a
  decorative icon beside text is aria-hidden.
- letter-spacing is size-specific, never one value for every size: tighten
  large display text (around -0.02em) and leave body copy near 0. Line-height
  tracks size inversely -- tight on big headings, 1.5+ on body.

MOTION
Motion is part of the design, and every page moves with intent unless the
request, the style or the product asks for stillness. Wrap the app in
<MotionConfig reducedMotion="user">. By default:
- The hero enters as a composed sequence: headline, supporting line, actions
  and media stagger in (delayChildren: stagger(0.06), from "motion/react")
  from opacity 0 and a 16-24px offset on a spring, done within about 700ms.
- Sections reveal once as they scroll into view (whileInView, viewport
  { once: true, amount: 0.3 }), each in a way that suits what it holds:
  images unmask, stats count up, cards stagger, headings rise.
- One pointer-responsive element on marketing pages: a spotlight glow
  following the cursor over the hero, a magnetic primary button, or cards
  that tilt and catch the light. Drive it with useMotionValue and useSpring,
  never React state, and only where matchMedia('(pointer: fine)') matches.
- Ambient life where the style allows: a slowly drifting gradient, aurora or
  mesh behind the hero, or a marquee of logos or phrases, on 12-40s loops of
  transform and opacity.
- Scroll-linked depth where it helps the story: parallax on hero media or a
  reading-progress bar, from useScroll and useTransform, never on text.
- Every interactive element answers: whileHover lift or a 1.02 scale,
  whileTap scale 0.97, icons that nudge. Lists and tabs animate with layout
  and layoutId, and items enter and leave through AnimatePresence.
Rules that hold everywhere:
- Animate transform and opacity (and clip-path, filter, background-position
  for ambient work), never width, height, top or left.
- Springs for interaction (stiffness 300-500, damping 25-35); ease-out
  (cubic-bezier(0.23, 1, 0.32, 1)) for entrances; never ease-in on UI.
  Nothing appears from scale(0): start from 0.95 with opacity 0. An exit
  runs at 65-75% of its entrance and along the same path.
- The more often something is triggered, the less it animates. Anything the
  user fires many times a day -- typing, a keyboard shortcut, a command
  palette, a nav toggle -- gets no more than a 150ms fade.
- Reduced motion keeps opacity and colour changes and drops movement: fewer
  and gentler, not none. MotionConfig covers declarative animation, but
  values linked to scroll or the pointer keep moving, so read
  useReducedMotion() and pass them their static value when it is true. CSS
  animation (tw-animate-css's animate-in, animate-spin, your own keyframes)
  gets motion-reduce:animate-none.

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

/**
 * The single-response build's system prompt, assembled from the sections
 * above (the comment over them is its comment). `PlanProvider` sends it; a
 * bounded build sends `OUTLINE_SYSTEM_PROMPT` and `GROUP_SYSTEM_PROMPT`,
 * which share every section but OUTPUT, SIZE and, for the file steps, SPEC.
 */
export const PLAN_SYSTEM_PROMPT = [
  PROMPT_HEAD,
  PLAN_OUTPUT_SECTION,
  PLAN_SIZE_SECTION,
  PLAN_RULES_BEFORE_SPEC,
  PLAN_SPEC_SECTION,
  RULES_AFTER_SPEC,
].join('\n\n');

/**
 * The files every project must have, as `REQUIRED FILES` above names them.
 *
 * Written out as data as well as prose because a bounded build
 * (`bounded-build.ts`) plans its files before writing any, and a plan that
 * forgot one of these is completed in code rather than found missing after
 * every file has been paid for. `bounded-build.test.ts` holds the prose and
 * this list to each other.
 *
 * A bounded build writes most of them itself (D71, `SCAFFOLD_PATHS`); the
 * model is asked only for the rest, src/App.tsx and src/styles.css.
 */
export const REQUIRED_PROJECT_FILES = [
  'package.json',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'src/main.tsx',
  'src/App.tsx',
  'src/styles.css',
  'src/lib/utils.ts',
  'README.md',
] as const;

/**
 * How many routes a bounded build plans at most.
 *
 * The single-response build had to stop at a home page and two further
 * routes, because the whole project had to fit in one reply (internal PR 289). A
 * bounded build writes a few files per reply, so the size of the project no
 * longer decides whether it arrives. What still bounds it is money and
 * time, and six routes is a full company site inside the output budget a
 * single-response build already reserved.
 */
export const MAX_PLANNED_ROUTES = 6;

const OUTLINE_OUTPUT_SECTION = `OUTPUT
This is the first step of several. Here you plan the project; its files are
written afterwards, a few at a time, by later steps that are given your plan
and nothing else you decided. Return a one-sentence summary, the title and
description, the design spec (see SPEC), the manifest, the dependencies and
the paths to delete, in that order, and no file content at all.
- title: the site's name as a browser tab shows it, a few words
  ("Crumb & Co. Bakery"). description: one sentence for search results.
  Both go into index.html and README.md, which are written for you. For a
  project that exists, repeat the ones its index.html has, exactly, and
  change them only when the request asks to rename or re-describe the
  site.
- manifest: the files to write, in the order they should be written:
  src/styles.css first, then src/lib, then the shadcn/ui components, then
  shared components and layout, then pages, then src/App.tsx. Never list a
  file from FILES WRITTEN FOR YOU. For each file give its path; its
  purpose, specific enough that someone writing it without seeing the other
  files produces one that fits (what it exports and what imports it, which
  spec sections and copy it carries, which route it serves); dependsOn, the
  manifest paths whose contents it needs to see, such as the files it
  imports; and size: small (up to about 80 lines), medium (up to about 250)
  or large (longer).
- Say in src/App.tsx's purpose how pages are routed and linked, and in each
  page's purpose which route it serves, so files written separately agree.
- Never list DESIGN.md: it is written for you from the spec.
- dependencies: each package outside STACK that a planned file will import,
  with the version range to declare (cmdk ^1.1.1 for a combobox). Usually
  empty: the stack covers a site.
- delete: paths of existing files to remove. Empty for a new project.`;

const OUTLINE_SIZE_SECTION = `SIZE
Each later step writes only a few files, so the project can be as large as
the request needs. For a large request (a full company site, many pages,
many features), plan every page it asks for, up to ${MAX_PLANNED_ROUTES} routes, each with its
full set of sections, and name anything past that in the summary as a next
step the person can ask for.
- Keep every file under about 400 lines: split a long page into section
  components.
- The spec's copy lists are for the home page's sections. The copy of every
  other page is written in that page's file, from its purpose.
- Reuse: a few shared components and one file of shared Motion variants
  (src/lib/motion.ts), not bespoke animation code for every element.`;

const GROUP_OUTPUT_SECTION = `OUTPUT
This is one step of several. The design spec and the manifest (the plan for
every file) were decided in an earlier step and are given to you, with the
files already written that the ones you are writing depend on. Return only
the files you are asked to write, each with its complete content -- never
abbreviate, never write a placeholder comment such as "rest of the code
here".
- Follow the manifest: import only from files it lists, files the project
  already has, FILES WRITTEN FOR YOU, the packages in STACK or the plan's
  dependencies, and use the exports each file's purpose names.
- Write every file you are asked for, and no other. Never write DESIGN.md
  or a file from FILES WRITTEN FOR YOU.`;

const GROUP_SPEC_SECTION = `SPEC
The spec is the design this project is built to, as measured values. Build
the files to it exactly: every colour is a custom property on :root with the
spec's value (dark values in a .dark block), mapped in \`@theme inline\` as
--color-<name>: var(--<name>) so the utilities use it (bg-primary,
text-muted-foreground); every copy string appears verbatim; every breakpoint
is a responsive variant or @media at that width. Use the spec's names for
tokens and type steps exactly: the files written in other steps do.`;

/**
 * The system prompt for a bounded build's first step: the spec and a
 * manifest of files, with no file content (`bounded-build.ts`).
 *
 * The same rules as `PLAN_SYSTEM_PROMPT`, section for section, with three
 * replaced. OUTPUT asks for a plan of the files rather than the files,
 * SIZE drops the single-response limit (internal PR 289), which existed only because
 * the whole project had to fit in one reply, and REQUIRED FILES is FILES
 * WRITTEN FOR YOU: the configuration, the entry point and the README are
 * templated (D71), so the model plans none of them.
 */
export const OUTLINE_SYSTEM_PROMPT = [
  PROMPT_HEAD,
  OUTLINE_OUTPUT_SECTION,
  OUTLINE_SIZE_SECTION,
  BOUNDED_RULES_BEFORE_SPEC,
  PLAN_SPEC_SECTION,
  RULES_AFTER_SPEC,
].join('\n\n');

const KEPT_SPEC_OUTLINE_OUTPUT_SECTION = `OUTPUT
This is the first step of several, and it plans a change to a project that
exists. Its files are written afterwards, a few at a time, by later steps
that are given your plan and nothing else you decided. Return a one-sentence
summary, the manifest, the dependencies and the paths to delete, in that
order, and no file content at all. There is no spec to write: the design is
fixed (see SPEC).
- manifest: the files to add or replace, in the order they should be
  written: src/styles.css first, then src/lib, then the shadcn/ui
  components, then shared components and layout, then pages, then
  src/App.tsx. Never list a file from FILES WRITTEN FOR YOU. For each file
  give its path; its purpose, saying what changes in it and what stays;
  dependsOn, the manifest paths whose contents it needs to see, such as the
  files it imports; and size: small (up to about 80 lines), medium (up to
  about 250) or large (longer).
- Never list DESIGN.md.
- dependencies: each package outside STACK that a planned file will import,
  with the version range to declare (cmdk ^1.1.1 for a combobox). Usually
  empty.
- delete: paths of existing files to remove.`;

const KEPT_SPEC_SECTION = `SPEC
The design spec is fixed: it is the project's DESIGN.md, whose frontmatter
is the spec as JSON, and this change does not alter it. Plan files that
hold to it exactly: every colour is a custom property on :root with the
spec's value, mapped in \`@theme inline\` as --color-<name>: var(--<name>);
every copy string appears verbatim; every breakpoint is a responsive variant
or @media at that width.`;

/**
 * The system prompt for the first step of a bounded build that keeps the
 * spec it has: a repair (`BoundedBuilderOptions.keepSpec`).
 *
 * A repair fixes a project against the spec it was built to, and its
 * DESIGN.md is put back afterwards whatever it says (`keepingRecordOf`).
 * Asked with `OUTLINE_SYSTEM_PROMPT`, it wrote the whole spec out again
 * (1,700 to 6,000 tokens of output, and the reasoning behind them) for
 * that to be thrown away. So this one asks for no spec at all: OUTPUT
 * without one, and SPEC saying the design is fixed rather than how to
 * write it.
 */
export const KEPT_SPEC_OUTLINE_SYSTEM_PROMPT = [
  PROMPT_HEAD,
  KEPT_SPEC_OUTLINE_OUTPUT_SECTION,
  OUTLINE_SIZE_SECTION,
  BOUNDED_RULES_BEFORE_SPEC,
  KEPT_SPEC_SECTION,
  RULES_AFTER_SPEC,
].join('\n\n');

/**
 * The system prompt for each later step of a bounded build, which writes a
 * few of the manifest's files and returns only those.
 *
 * No SIZE section: how much one step writes is decided by the partition
 * (`partitionManifest`), not by the model. SPEC says how to build to a spec
 * rather than how to write one, because the spec already exists.
 */
export const GROUP_SYSTEM_PROMPT = [
  PROMPT_HEAD,
  GROUP_OUTPUT_SECTION,
  BOUNDED_RULES_BEFORE_SPEC,
  GROUP_SPEC_SECTION,
  RULES_AFTER_SPEC,
].join('\n\n');

/** How large a file is expected to be, as an outline names it. */
export const MANIFEST_SIZES = ['small', 'medium', 'large'] as const;
export type ManifestSize = (typeof MANIFEST_SIZES)[number];

/** One file of a bounded build's plan. */
export const ManifestEntrySchema = z.object({
  path: z.string().min(1),
  purpose: z.string(),
  dependsOn: z.array(z.string()),
  size: z.enum(MANIFEST_SIZES),
});

/** A package beyond the stack that a planned file imports (D71). */
export const DependencySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

/**
 * What the first step of a bounded build is asked to return: the summary,
 * the title and description the templated files carry (D71), the spec, the
 * manifest of files to write, the packages beyond the stack its files
 * import, and the files to remove.
 *
 * `spec` before `manifest` for the reason `GenerationPlanSchema` gives:
 * structured output is written in schema order, so the design is decided
 * before the files that carry it are planned. `dependencies` after the
 * manifest, because which packages are needed follows from which files
 * there are.
 */
export const BuildOutlineSchema = z.object({
  summary: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  spec: DesignSpecSchema,
  manifest: z.array(ManifestEntrySchema),
  dependencies: z.array(DependencySchema),
  delete: z.array(z.string()),
});

/**
 * What the first step of a build that keeps its spec is asked to return
 * (`KEPT_SPEC_OUTLINE_SYSTEM_PROMPT`): `BuildOutlineSchema` without the
 * spec, and without the title and description, which only a new project's
 * templated files take. Read with `BuildOutlineReadSchema`, where all three
 * are optional already.
 */
export const KeptSpecOutlineSchema = z.object({
  summary: z.string().min(1),
  manifest: z.array(ManifestEntrySchema),
  dependencies: z.array(DependencySchema),
  delete: z.array(z.string()),
});

/**
 * What an outline is read with. Looser than what is asked for, in the way
 * `GenerationPlanReadSchema` is and for the same reason: DeepSeek's JSON
 * mode enforces no schema, and a manifest entry with an odd size or no
 * dependencies is still a file worth writing. A path is the one thing an
 * entry cannot do without.
 */
export const BuildOutlineReadSchema = z.object({
  summary: z.string().min(1),
  title: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  spec: DesignSpecReadSchema.optional().catch(undefined),
  manifest: z.array(
    z.object({
      path: z.string().min(1),
      purpose: z.string().catch(''),
      dependsOn: z.array(z.string()).catch([]),
      size: z.enum(MANIFEST_SIZES).catch('medium'),
    }),
  ),
  // Optional as well as caught: an outline stored by a run that started
  // before D71 has none, and is read back on a replay.
  dependencies: z
    .array(z.object({ name: z.string(), version: z.string() }))
    .optional()
    .catch(undefined),
  delete: z.array(z.string()).catch([]),
});

export type BuildOutline = z.infer<typeof BuildOutlineReadSchema>;
export type ManifestEntry = BuildOutline['manifest'][number];

/** What each later step of a bounded build returns: its own files. */
export const FileGroupSchema = z.object({
  files: z.array(ProjectFileSchema),
});
