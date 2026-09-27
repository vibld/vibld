/**
 * Motion recipes, retrieved on demand -- the same closed-set keyword match
 * `patterns.ts` uses for structure and `palettes.ts` uses for colour,
 * applied here to timing and technique.
 *
 * Generated projects animate with Motion (the `motion` package, imported
 * from "motion/react"), and motion is expressive by default (ADR-0014): the
 * system prompt's MOTION section sets the choreography every page gets, and
 * these recipes add the specific technique when the request names a
 * component or an effect. Every API named below was type-checked against
 * the installed package on 2026-09-26 rather than recalled; `stagger()` in
 * particular replaced `staggerChildren`, which the package now marks
 * deprecated.
 *
 * The timing numbers are still the ones adapted from emilkowalski/skills
 * (MIT License, https://github.com/emilkowalski/skills) and
 * LottieFiles/motion-design-skill (MIT License,
 * https://github.com/LottieFiles/motion-design-skill): durations, the exit
 * ratio, the stagger cap, and the ambient cycles. What changed is the
 * technique that carries them.
 *
 * The four platform-capability entries (`scroll-driven`, `view-transition`,
 * `discrete-transition`, `anchor-position`) are adapted from the `css-native`
 * skill in AThevon/genjutsu (MIT License, https://github.com/AThevon/genjutsu)
 * and stay: they are the current CSS the page should reach for where it
 * earns its place, with the discipline that keeps the content usable where
 * a browser lacks them. Browser-support claims are still deliberately left
 * out, because they perish and a prompt does not correct itself.
 *
 * The set is closed, and that is the security property, not a convenience:
 * `selectMotion` only ever returns entries from this file, so nothing a
 * caller types can become a recipe.
 */

export interface MotionRecipe {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /** Appended to the request when this recipe matches. */
  guidance: string;
}

export const MOTION_RECIPES: readonly MotionRecipe[] = [
  {
    id: 'overlay',
    name: 'Dropdown, popover, menu or tooltip',
    triggers: [
      'dropdown',
      'popover',
      'context menu',
      'tooltip',
      'select menu',
      'combobox',
    ],
    guidance:
      "The panel grows out of its trigger, not out of thin air. shadcn/ui's content parts already carry it: `data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95` and the matching `animate-out` classes, with `origin-(--radix-dropdown-menu-content-transform-origin)` (or the popover, select or tooltip variable) so it scales from the trigger's edge. Keep that, keep it short (150-200ms, tooltips 125ms), and add `motion-reduce:animate-none` beside it.",
  },
  {
    id: 'modal',
    name: 'Modal or dialog',
    triggers: ['modal', 'dialog', 'lightbox', 'confirmation popup'],
    guidance:
      'A modal is the one overlay that stays centred, because it is not anchored to a trigger. On the shadcn Dialog, fade the Overlay (`data-[state=open]:fade-in-0`) and zoom the Content from 95% over the same 200-250ms so the two read as one surface arriving, with `motion-reduce:animate-none` on both. For content that changes size inside an open dialog, give the inner wrapper Motion `layout` so it resizes smoothly instead of jumping.',
  },
  {
    id: 'drawer',
    name: 'Drawer, sheet or side panel',
    triggers: [
      'drawer',
      'bottom sheet',
      'side panel',
      'slide-out',
      'off-canvas',
    ],
    guidance:
      'Build it as shadcn\'s Sheet (the Dialog primitive sliding from an edge): `data-[state=open]:slide-in-from-bottom` (or -right) with a 400-500ms duration and `ease-[cubic-bezier(0.32,0.72,0,1)]`, the one UI case allowed past 300ms because the surface travels so far. The slide is by the panel\'s own size, so it holds whatever the content. For a swipe-to-dismiss bottom sheet use a Motion `drag="y"` panel with `dragConstraints={{ top: 0 }}` and close past a velocity or a third of its height.',
  },
  {
    id: 'toast',
    name: 'Toast or notification',
    triggers: ['toast', 'snackbar', 'notification banner', 'flash message'],
    guidance:
      'Render toasts in a Motion `<AnimatePresence>` list: each enters from `{ opacity: 0, y: 24, scale: 0.96 }` with a spring (stiffness 400, damping 30) and exits along the same path, and `layout` on each item lets the stack close the gap smoothly when one leaves. A toast can fire twice in a second, and a spring retargets from wherever it is, where a CSS keyframe restarts from zero. Give the region role="status" (or aria-live="polite") so it is announced.',
  },
  {
    id: 'accordion',
    name: 'Accordion or collapsible section',
    triggers: ['accordion', 'collapsible', 'expandable section', 'faq section'],
    guidance:
      "On the shadcn Accordion, animate the Content with tw-animate-css's `data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up`, which reads the height Radix measures, so nothing animates to `auto`. Rotate the trigger's lucide ChevronDown 180deg on `[&[data-state=open]>svg]:rotate-180` with a 200ms transition. Keep it short: height costs layout on every frame.",
  },
  {
    id: 'stagger',
    name: 'Staggered group entrance',
    triggers: [
      'stagger',
      'staggered',
      'cards animate in',
      'items fade in',
      'grid animates',
    ],
    guidance:
      'Motion variants: the parent `variants={{ show: { transition: { delayChildren: stagger(0.05) } } }}` with `initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.25 }}`, each child `{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }` on a spring (stiffness 260, damping 24). `stagger` is imported from "motion/react"; `staggerChildren` is deprecated. Keep the whole group under about 600ms however many items there are, and never block interaction while it plays.',
  },
  {
    id: 'scroll-reveal',
    name: 'Scroll-triggered reveal',
    triggers: [
      'scroll animation',
      'scroll reveal',
      'reveal on scroll',
      'animate on scroll',
      'fade in on scroll',
    ],
    guidance:
      'Motion\'s `whileInView` with `viewport={{ once: true, amount: 0.3 }}`: reveal once, as the section is a third in, because re-animating on every scroll-by is an interface fighting its reader. Vary the reveal by what is revealed rather than fading everything up: headings rise 24px, images unmask with `clipPath: "inset(0 0 100% 0)"` to `"inset(0 0 0% 0)"`, stats count up, cards stagger. Keep functional UI someone uses daily still.',
  },
  {
    id: 'pointer',
    name: 'Pointer-following effect',
    triggers: [
      'mouse',
      'cursor',
      'pointer',
      'spotlight',
      'follows the mouse',
      'magnetic',
      'tilt',
      'glow effect',
    ],
    guidance:
      "Drive it with motion values, never React state, so it moves at frame rate without re-rendering: `const x = useMotionValue(0)` set in onPointerMove from `e.clientX - rect.left`, smoothed with `useSpring(x, { stiffness: 150, damping: 20, mass: 0.4 })`. Spotlight: `background: useMotionTemplate\\`radial-gradient(420px at ${x}px ${y}px, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)\\`` on the section. Magnetic button: translate it 20-30% of the pointer's offset from its centre and spring back on leave. Tilt card: `rotateX`/`rotateY` within 6-8deg from `useTransform`, with `perspective` on the parent. Run it only where `matchMedia('(pointer: fine)').matches` and `useReducedMotion()` is false; touch has no hover to follow.",
  },
  {
    id: 'parallax',
    name: 'Scroll-linked parallax or progress',
    triggers: [
      'parallax',
      'scroll progress',
      'progress bar on scroll',
      'scroll linked',
      'sticky scroll',
      'scrollytelling',
    ],
    guidance:
      "`const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })`, then `useTransform(scrollYProgress, [0, 1], [60, -60])` into `style={{ y }}` on the media, never on text. Layers move at different rates (background about 0.2x, midground 0.5x), total displacement under about 100px. A reading-progress bar is `scaleX` from the page's `scrollYProgress` with `origin-left`. For a sticky story, a tall section with a `sticky top-0` child whose content swaps on `useMotionValueEvent(scrollYProgress, 'change', ...)`. When `useReducedMotion()` is true, pass the static value instead: MotionConfig does not stop scroll-linked values.",
  },
  {
    id: 'ambient',
    name: 'Ambient background motion',
    triggers: [
      'animated background',
      'ambient',
      'floating elements',
      'animated gradient',
      'living background',
      'aurora',
      'mesh gradient',
      'marquee',
      'logo strip',
    ],
    guidance:
      'Ambient motion must be imperceptible at a glance and never compete with content. Aurora or mesh: two to four large blurred blobs (`blur-3xl`, `mix-blend-mode` where it suits the ground) drifting 5-15% with Motion `animate={{ x: [...], y: [...] }}` on 12-24s loops of different lengths so they never synchronise. Floating: translateY within 5-15px over 3-5s. Marquee: duplicate the row and animate `x` from `0%` to `-50%` linearly over 25-40s with `repeat: Infinity`, pause on hover, and mask the edges with `mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent)`. Under reduced motion these stop outright: they carry no information.',
  },
  {
    id: 'text',
    name: 'Headline and number reveals',
    triggers: [
      'text animation',
      'headline animation',
      'word by word',
      'typewriter',
      'counter',
      'count up',
      'animated numbers',
      'stats',
    ],
    guidance:
      "Words, not letters: split the headline into words in spans, each rising from `{ opacity: 0, y: '0.4em' }` with `delayChildren: stagger(0.04)`, `overflow: hidden` on a wrapper per line if the words should appear to rise out of a baseline. Keep the full sentence in the DOM (the spans are the same text), so it is read once and not word by word. Numbers count up once when in view: `animate(count, target, { duration: 1.2, ease: [0.23, 1, 0.32, 1] })` from `useInView`, rendered with `tabular-nums` so the width holds still.",
  },
  {
    id: 'skeleton',
    name: 'Loading skeleton or placeholder',
    triggers: ['skeleton', 'loading placeholder', 'shimmer', 'content loading'],
    guidance:
      "Match the skeleton to the real content's shape and line count so nothing jumps when it resolves, and cross-fade to the content with AnimatePresence. Sweep a gradient across it (1.5-2.5s per sweep, a pause between) rather than pulsing the whole block's opacity, which reads as broken rather than loading. Under reduced motion show a flat tinted block.",
  },
  {
    id: 'press',
    name: 'Button press and hover feedback',
    triggers: [
      'button animation',
      'hover effect',
      'press animation',
      'micro-interaction',
      'micro interaction',
    ],
    guidance:
      "Motion's `whileTap={{ scale: 0.97 }}` for a press (`motion.button`, or `asChild` on a shadcn Button around one) and `whileHover={{ y: -2 }}` or a 1.02 scale for lift, both on a stiff spring (stiffness 400, damping 25). scale() takes the label and icon with it, which is what reads as physical. An icon inside can nudge on hover (`group-hover:translate-x-0.5` on a lucide ArrowRight). Tailwind v4's `hover:` variant already applies only where the device can hover.",
  },
  {
    id: 'tabs',
    name: 'Tab indicator',
    triggers: ['tabs', 'tab bar', 'segmented control', 'tab indicator'],
    guidance:
      'Render the active indicator as one Motion element with `layoutId="tab-indicator"` inside the active trigger. Motion moves it between tabs as a shared element, so the pill slides from one tab to the next instead of two colours interpolating out of step. A spring (stiffness 500, damping 35) keeps it quick. Put the label above it with `relative z-10`.',
  },
  {
    id: 'hold-to-confirm',
    name: 'Hold to confirm',
    triggers: ['hold to confirm', 'press and hold', 'confirm destructive'],
    guidance:
      "For a destructive action a plain click fires too easily. Fill an overlay with `clip-path: inset(0 100% 0 0)` to `inset(0 0 0 0)` over 2s `linear` while :active -- linear is correct because the fill is a progress indicator and progress should not ease -- and snap it back at 200ms ease-out on release. Asymmetric by design: slow on the part the user is deciding, immediate on the system's response.",
  },
  {
    id: 'scroll-driven',
    name: 'Scroll-driven CSS animation',
    triggers: [
      'scroll-driven',
      'scroll driven',
      'animation-timeline',
      'animate with scroll',
    ],
    guidance:
      'CSS can drive an animation from scroll position with no JavaScript: `animation: grow linear both; animation-timeline: scroll(root block)` for page progress, or `animation-timeline: view(); animation-range: entry 0% entry 100%` for an element animating as it enters. Use `both`, never `forwards`, or the element locks into its end state when the reader scrolls back up. Put the whole thing inside `@supports (animation-timeline: scroll())` and write the default styles so the content is fully visible without it, because an unguarded scroll-driven reveal leaves some readers looking at a blank page.',
  },
  {
    id: 'view-transition',
    name: 'View transition between states or pages',
    triggers: [
      'view transition',
      'page transition',
      'route transition',
      'morph between',
      'shared element transition',
    ],
    guidance:
      'The View Transitions API animates between two DOM states without either state knowing about the animation. Wrap the state change in `document.startViewTransition(() => { /* update the DOM synchronously */ })`, and give the element that should persist across the change a matching `view-transition-name` on both sides. Feature-detect first (`if (!document.startViewTransition) { update(); return; }`) so the update still happens where the API is missing. Within one React tree, Motion `layoutId` does the same job and is the simpler choice.',
  },
  {
    id: 'discrete-transition',
    name: 'Animating in or out of display: none',
    triggers: [
      'fade in on mount',
      'animate in and out',
      'enter and exit animation',
      'native dialog',
    ],
    guidance:
      'In React, AnimatePresence gives an element an exit animation before it unmounts: wrap the conditional, give the child a `key` and an `exit` state. Without React in the way, CSS does it natively: list `display` in the transition with `allow-discrete` (`transition: opacity 300ms ease, display 300ms allow-discrete`) and use a `@starting-style` block for the first render. For `[popover]` and `<dialog>` add `overlay` to the same list, or the element leaves the top layer mid-fade.',
  },
  {
    id: 'anchor-position',
    name: 'Positioning a tooltip or popover against its trigger',
    triggers: [
      'anchor positioning',
      'position tooltip',
      'floating panel',
      'attach to button',
    ],
    guidance:
      'Radix positions its own content (Popover, Tooltip, DropdownMenu, Select), so use those for controls. For a decorative element tethered to another, CSS anchor positioning needs no library: `anchor-name: --trigger` on the anchor, `position-anchor: --trigger` with `position-area: top center` on the panel, and `position-try-fallbacks` for the opposite placement so it never clips off-screen. Feature-detect with `@supports (anchor-name: --a)` and keep an absolutely positioned fallback.',
  },
];

/**
 * The recipes relevant to this request, matched by keyword. Capped at
 * `limit` for the same reason `selectPatterns` is: a request that names
 * several components should not turn the prompt into the whole catalogue.
 */
export function selectMotion(
  promptText: string,
  limit = 2,
): readonly MotionRecipe[] {
  const lower = promptText.toLowerCase();
  const matched = MOTION_RECIPES.filter((recipe) =>
    recipe.triggers.some((trigger) => lower.includes(trigger)),
  );
  return matched.slice(0, limit);
}

export function findMotionRecipe(id: string): MotionRecipe | null {
  return MOTION_RECIPES.find((recipe) => recipe.id === id) ?? null;
}

/**
 * The guidance appended to a request for the recipes it matched, or null
 * when nothing matched. Subordinate to the request in the same way every
 * other retrieved guidance in this package is.
 */
export function motionGuidance(promptText: string): string | null {
  const recipes = selectMotion(promptText);
  if (recipes.length === 0) return null;
  const sections = recipes
    .map((recipe) => `${recipe.name}: ${recipe.guidance}`)
    .join('\n\n');
  return `This request involves motion these recipes cover, on top of the MOTION defaults. Where a recipe conflicts with an instruction in the request above, follow the request.

${sections}`;
}
