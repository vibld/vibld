/**
 * Motion recipes, retrieved on demand -- the same closed-set keyword match
 * `patterns.ts` uses for structure and `palettes.ts` uses for colour,
 * applied here to timing and technique.
 *
 * Adapted from emilkowalski/skills (MIT License,
 * https://github.com/emilkowalski/skills), whose `animate` skill ships
 * ready-to-build plain-CSS recipes rather than a motion-library API -- the
 * same constraint the STACK rule imposes on generated projects. The ambient
 * numbers (breathing, floating, gradient drift, shimmer, parallax ratios)
 * come from LottieFiles/motion-design-skill (MIT License,
 * https://github.com/LottieFiles/motion-design-skill), which is the only one
 * of the two that treats continuous background motion as a first-class case.
 *
 * What is *not* here is as deliberate as what is. Lottie's "always three
 * motion layers -- primary, secondary and ambient" would mandate ambient
 * motion on every element of every generated page, which is precisely the
 * over-animated output the system prompt's frequency gate exists to prevent;
 * the ambient entry below is opt-in by keyword for exactly that reason.
 * greensock/gsap-skills was read and not ported at all: it is API reference
 * for a library Vibld does not ship, and it instructs the reader to
 * recommend installing GSAP, which would break STACK and PORTABILITY.
 *
 * The four platform-capability entries (`scroll-driven`, `view-transition`,
 * `discrete-transition`, `anchor-position`) are adapted from the `css-native`
 * skill in AThevon/genjutsu (MIT License,
 * https://github.com/AThevon/genjutsu). They are here because each one
 * replaces a library with a platform feature, which is the same trade
 * STACK already makes. What is deliberately not carried over is that
 * skill's browser-support claims: it dates and version-stamps them because
 * they perish, and a perishable fact baked into a prompt goes stale
 * silently and is never corrected. The durable half is the discipline --
 * guard the feature, keep the content usable without it -- and that is
 * what these entries state instead.
 *
 * The universal rules -- easing tokens, duration bands, the frequency gate,
 * the reduced-motion posture -- live in `PLAN_SYSTEM_PROMPT` instead,
 * because they are true on every generation and cheap. This file holds only
 * what is worth paying for when the request actually names the component:
 * the specific CSS that is hard to derive from the rule alone.
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
      'The panel scales out of its trigger, not out of thin air: set transform-origin to the trigger edge, then transition opacity and transform together (200ms for a dropdown, 125ms for a tooltip, both --ease-out), from `opacity: 0; transform: scale(0.95)` to the resting state. Once one tooltip in a group is open, neighbours should open with transition-duration 0ms -- the initial delay prevents accidental activation, and skipping it afterwards makes the whole toolbar feel faster.',
  },
  {
    id: 'modal',
    name: 'Modal or dialog',
    triggers: ['modal', 'dialog', 'lightbox', 'confirmation popup'],
    guidance:
      'A modal is the one overlay that stays centred -- transform-origin: center, because it is not anchored to a trigger. Transition opacity and transform at 250ms --ease-out from `opacity: 0; transform: scale(0.96)`, and fade the backdrop opacity over the same duration so the two read as one surface arriving. Trap focus inside it, return focus to the trigger on close, and close on Escape.',
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
      "Hide it with `transform: translateY(100%)` (or translateX for a side panel) and transition transform at 500ms with --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1). The percentage matters -- it moves by the element's own height whatever the content, where a hardcoded pixel value breaks the moment the content changes. This is the one UI case that is allowed past the 300ms ceiling.",
  },
  {
    id: 'toast',
    name: 'Toast or notification',
    triggers: ['toast', 'snackbar', 'notification banner', 'flash message'],
    guidance:
      'Use a transition, never keyframes: a toast can fire twice in a second, and a transition retargets from the current value where keyframes restart from zero. Transition opacity and transform at 400ms `ease`, entering from `opacity: 0; transform: translateY(100%)` via @starting-style, and exit along the same path it entered by -- a toast that slides up from the bottom leaves through the bottom, which is what makes swipe-to-dismiss feel obvious.',
  },
  {
    id: 'accordion',
    name: 'Accordion or collapsible section',
    triggers: ['accordion', 'collapsible', 'expandable section', 'faq section'],
    guidance:
      'The one sanctioned exception to "never animate layout properties": there is no transform equivalent for revealing content. Set overflow: hidden and transition height and opacity at 200ms --ease-out. Keep it short -- this costs layout on every frame, so a long duration is expensive as well as sluggish. Measure the content height in JS rather than animating to `auto`, which does not transition.',
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
      'Offset each item by 30-80ms via animation-delay on nth-child, animating `opacity: 0; transform: translateY(8px)` to the resting state over 300ms --ease-out. Keep the total under 500ms however many items there are -- on a twenty-card grid a fixed per-item delay turns a flourish into a wait. Stagger is decorative, so it must never block interaction while it plays, and it belongs on a surface seen occasionally, not on a list scrolled past all day.',
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
      'Trigger with IntersectionObserver at `rootMargin: "0px 0px -20% 0px"` so it fires when the element is a fifth into the viewport, and unobserve after the first fire -- re-animating on every scroll-by is an interface fighting its reader. Reveal with `clip-path: inset(0 0 100% 0)` to `inset(0 0 0 0)` over 600ms --ease-in-out, which wipes the content in rather than sliding a whole block around. Marketing surfaces only: never do this to functional UI someone visits daily.',
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
      'parallax',
    ],
    guidance:
      'Ambient motion must be imperceptible at a glance and never compete with content. Breathing: scale between 0.98 and 1.02 over 2000-4000ms, sine-eased -- past about 5% it starts demanding attention. Floating: translateY within 5-15px over 3000-5000ms, and give each floater a different cycle length (for example 4000ms, 5500ms and 3500ms) or they visibly synchronise. Gradient drift: shift background-position by 10-20% over 8000-20000ms, linear. Shimmer: a 1500-2500ms sweep with a 2000-5000ms pause between sweeps. Parallax: foreground 1.0x, midground 0.5x, background 0.2x, total displacement under 100px, disabled on mobile, and never on text.',
  },
  {
    id: 'skeleton',
    name: 'Loading skeleton or placeholder',
    triggers: ['skeleton', 'loading placeholder', 'shimmer', 'content loading'],
    guidance:
      "Match the skeleton to the real content's shape and line count so nothing jumps when it resolves. Animate a gradient sweep across it -- 1500-2500ms per sweep with a 2000-5000ms pause -- rather than pulsing the whole block's opacity, which reads as broken rather than loading. Under prefers-reduced-motion drop the sweep and show a flat tinted block.",
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
      'Press: `transition: transform 160ms var(--ease-out)` with `:active { transform: scale(0.97) }`. scale() takes the label and icons with it, which is what makes it read as a physical press, and :active needs no gating because it is a real press on touch. Hover is different -- put any hover motion inside `@media (hover: hover) and (pointer: fine)`, because touch fires a false hover on tap and leaves the element stuck in its hover state.',
  },
  {
    id: 'tabs',
    name: 'Tab indicator',
    triggers: ['tabs', 'tab bar', 'segmented control', 'tab indicator'],
    guidance:
      'Timing individual colour transitions across a tab list never quite lands -- the text and the background arrive at different moments. Clip instead: duplicate the tab list, style the copy as the active state, and animate `clip-path: inset()` on the copy to sit over the active tab, 250ms --ease-in-out. The text and background change in perfect sync because they are one element being revealed, not two colours being interpolated.',
  },
  {
    id: 'hold-to-confirm',
    name: 'Hold to confirm',
    triggers: ['hold to confirm', 'press and hold', 'confirm destructive'],
    guidance:
      "For a destructive action a plain click fires too easily. Fill an overlay with `clip-path: inset(0 100% 0 0)` to `inset(0 0 0 0)` over 2s `linear` while :active -- linear is correct because the fill is a progress indicator and progress should not ease -- and snap it back at 200ms --ease-out on release. Asymmetric by design: slow on the part the user is deciding, immediate on the system's response.",
  },
  {
    id: 'scroll-driven',
    name: 'Scroll-linked animation',
    triggers: [
      'scroll-driven',
      'scroll driven',
      'scroll progress',
      'progress bar on scroll',
      'scroll linked',
      'animate with scroll',
    ],
    guidance:
      'CSS can drive an animation from scroll position with no JavaScript and no observer: `animation: grow linear both; animation-timeline: scroll(root block)` for page progress, or `animation-timeline: view(); animation-range: entry 0% entry 100%` for an element animating as it enters the viewport. Use `both`, never `forwards`, or the element locks into its end state when the reader scrolls back up. This is the part that matters: put the whole thing inside `@supports (animation-timeline: scroll())` and write the default styles so the content is fully visible and readable without it. Support is uneven across browsers, so an unguarded scroll-driven reveal leaves some readers looking at a blank page, which is a worse failure than having no animation at all.',
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
      'The View Transitions API animates between two DOM states without either state knowing about the animation. Wrap the state change in `document.startViewTransition(() => { /* update the DOM synchronously */ })`, and give the element that should appear to persist across the change a matching `view-transition-name` on both sides. Feature-detect before calling it (`if (!document.startViewTransition) { update(); return; }`) so the update still happens where the API is missing; the page then changes instantly instead of animating, which is the correct fallback. Do not give two visible elements the same `view-transition-name` at once, which fails the whole transition rather than degrading it.',
  },
  {
    id: 'discrete-transition',
    name: 'Animating in or out of display: none',
    triggers: [
      'fade in on mount',
      'animate in and out',
      'enter and exit animation',
      'popover',
      'native dialog',
    ],
    guidance:
      'An element going to `display: none` normally disappears instantly, which is why exit animations get faked with timers. CSS does it natively: list `display` in the transition with `allow-discrete` (`transition: opacity 300ms ease, display 300ms allow-discrete`), and use a `@starting-style` block to declare the from-state for the first render. Without `allow-discrete` the display change is skipped and the exit never plays. For `[popover]` and `<dialog>` add `overlay` to the same list, or the element leaves the top layer before its animation finishes and vanishes mid-fade.',
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
      'CSS can tether a floating element to its trigger with no positioning library and no scroll listener: `anchor-name: --trigger` on the trigger, then `position-anchor: --trigger` with `position-area: top center` on the panel. Always give it `position-try-fallbacks` pointing at an `@position-try` block with the opposite placement, or the panel clips off-screen whenever the trigger sits near an edge. Feature-detect with `@supports (anchor-name: --a)` and keep a plain absolutely-positioned fallback, since the panel must still be readable where this is unsupported.',
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
  return `This request involves motion these recipes cover. They assume the easing tokens from the motion baseline are already on :root. Where a recipe conflicts with an instruction in the request above, follow the request.

${sections}`;
}
