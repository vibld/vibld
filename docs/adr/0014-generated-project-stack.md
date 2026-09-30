# ADR-0014: Generate on Tailwind v4, shadcn/ui, Lucide and Motion, with expressive motion by default

- Status: Accepted (Chris, 2026-09-30, D92). Generated projects are a Vite single-page app, and this supersedes D29's React Router framework mode and static prerendering for them.
- Date: 2026-09-26
- Decision owners: maintainers
- Supersedes: the "only when the generated site needs them" clause of ADR-0008
- Refines: ADR-0002, D15
- Supersedes: D29, for generated projects

## Context

Generated projects were React, TypeScript and Vite with plain CSS in `src/styles.css`, one unstyled dependency (`@base-ui/react`) for dialogs and menus, inline SVG icons, and a motion baseline that was restrained by construction. The prompt said "No CSS framework or styled component library unless the request asks for one by name."

The examples generated for vibld.com/examples looked too alike: the same layouts and too little variety in type. The maintainer asked for output that reads as current design tools produce it: current CSS, animation, pointer-following movement and modern iconography. On 2026-09-26 the maintainer chose:

- Scope: the generator and the examples, not only the examples.
- Libraries: Lucide icons, Motion, Tailwind CSS and shadcn/ui components.
- Motion: expressive by default.
- Primitives under shadcn/ui: Radix.
- Per-run output reserve: raised from $1.60 to $3.20.

D29 and ADR-0008 already named Tailwind and "selected shadcn/ui, Radix or icon components". The plain-CSS rule was the prompt's, not a recorded decision.

## Decision

Generated projects use, at the versions in `packages/ai/src/stack.ts`:

- Tailwind CSS v4 through `@tailwindcss/vite`, configured in CSS. `src/styles.css` holds the imports, the `:root` tokens under shadcn/ui's names, and an `@theme inline` block that maps them into Tailwind (`packages/ai/src/theme-css.ts`).
- shadcn/ui components written as source files in `src/components/ui/`, on Radix through the `radix-ui` package, with `cn()` in `src/lib/utils.ts` and variants from `class-variance-authority`. There is no CLI step, because the sandbox reaches only the package registry (L11). A dialog, sheet, popover, dropdown menu, select, combobox, tooltip, tabs or accordion is always the shadcn/ui component, never divs.
- `lucide-react` for icons.
- Motion (`motion`, imported from `motion/react`) for animation, with `tw-animate-css` for the enter and exit classes shadcn/ui components use.

Motion is expressive by default. The system prompt's MOTION section asks for:

- a composed hero entrance;
- reveals as sections scroll into view;
- one pointer-responsive element;
- ambient movement where the style allows;
- scroll-linked depth where it helps;
- a response on every interactive element.

The frequency gate and the reduced-motion posture stay: `<MotionConfig reducedMotion="user">`, a read of `useReducedMotion()` for scroll- and pointer-linked values, and `motion-reduce:animate-none` on CSS animation.

The prompt also gains a LAYOUT AND TYPE section. It rules out the default of a centred hero, three identical cards and a system or Inter display face, and asks for current CSS where it earns its place.

Versions are named in the prompt. A model choosing its own picks ranges that disagree, and an install that fails buys a paid repair. `stack.ts` is the one list: the prompt, the fake scaffold and the eval's stub plan all read it. CI builds the stub, so a set that stops installing or compiling together fails there first.

The per-run output reserve is $3.20.

The design checks read the stack before the prompt asks for it:

- colours drawn by utilities and opacity modifiers;
- Motion's animation, for the reduced-motion check;
- `oklch()` and `.dark` tokens, for contrast;
- shadcn's own `<input {...props}>`, for the label check.

The eval's portability check now refuses three things:

- `@tailwindcss/vite` that the Vite config never adds;
- an `@/` import without both the tsconfig path and the Vite alias;
- a stylesheet import without Vite's client types.

## Consequences

Measured on 2026-09-26 with the packages at the versions in `stack.ts`:

| Measurement                                             | Result                 |
| ------------------------------------------------------- | ---------------------- |
| Cold `npm install --ignore-scripts`                     | 20 seconds, 162 MB     |
| `lucide-react` alone, unpacked                          | 35 MB                  |
| Build                                                   | 2 seconds              |
| Prototype page JavaScript (dialog, icons, pointer glow) | 421 KB, 133 KB gzipped |
| Prototype page CSS                                      | 15 KB                  |

All of this is inside `build-limits.ts` (5 minutes install, 5 minutes compile). A repair installs twice from cold.

Projects are larger. shadcn/ui components are files of their own, so the prompt's file limit rises from 25 to 40. The system prompt grows from about 13,000 to about 18,000 characters, and each style direction by about 900. `MAX_MOCKUP_DIRECTION_CHARS` rises from 2,000 to 3,200 to keep its bound true.

The $3.20 reserve doubles the output ceiling on the dearest models (50 micro-USD a token) from 32,000 to 64,000 tokens. On Claude Opus 5.5, the default model, it moves from 80,000 to 128,000.

A first build on Opus 5.5 reserves about $2.88 in all, up from $1.92. A reservation has to fit inside one bucket of the caller's balance, either the monthly allowance or the top-up balance, and the two are not summed. So the reserve decides which accounts can start a run on which model. The Free allowance defaults to $1 a month and the signup credit to $1; a deployment can override the Free allowance.

The local mock preview (`apps/web/src/generation/preview.ts`) inlines `src/styles.css` without running Tailwind. It shows structure without the utilities' styling. The sandbox preview builds the project and is unaffected.

Mockups stay HTML and inline CSS, so they cannot show pointer or scroll motion. Their tokens are carried into the spec and then into `@theme`.

Tailwind's default palette values are not held by the design checks. A spec colour the page may be drawing from a palette utility (`bg-slate-900`) is reported as a warning rather than an error.

D15 ("begin with curated dependencies") has no allowlist in code. This ADR names the set the prompt asks for; nothing enforces it at install time.

## Licence facts

These are what each package's own licence file says. Whether to adopt them is the maintainer's decision.

| Package                                             | Licence                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tailwindcss`, `@tailwindcss/vite`                  | MIT                                                                                                                                 |
| `motion` (and `framer-motion`, which it depends on) | MIT; copyright Motion B.V.                                                                                                          |
| `radix-ui`                                          | MIT                                                                                                                                 |
| `clsx`, `tailwind-merge`, `tw-animate-css`          | MIT                                                                                                                                 |
| `class-variance-authority`                          | Apache License 2.0                                                                                                                  |
| `lucide-react`                                      | ISC. The same LICENSE file carries an MIT notice, copyright Cole Bemis, for a listed set of icons derived from the Feather project. |
| `cmdk` (only for a combobox)                        | MIT, per its registry metadata                                                                                                      |
| `shadcn` (the CLI package, not used at build time)  | MIT, per its registry metadata                                                                                                      |

The shadcn/ui component source the model writes comes from the shadcn/ui registry. Its licence was not read for this record.

## Alternatives considered

- **Keep plain CSS and add richer presets.** This leaves the stack as it was. The maintainer asked for the libraries by name.
- **Base UI under shadcn/ui.** It keeps today's primitive guidance, but model output drifts toward Radix, which is shadcn's default and its most published form. The maintainer chose Radix.
- **Restrained motion by default, expressive on request.** This is the old posture. The maintainer chose expressive by default.
- **Let the model choose versions.** Ranges that disagree fail the install, and every such failure is a paid repair.
- **Keep the $1.60 reserve and measure first.** Cheaper per run. The maintainer chose $3.20.
