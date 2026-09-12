/**
 * How to actually use the one dependency STACK allows, retrieved on demand.
 *
 * STACK carves out a single exception: the interactive controls that are
 * broken for keyboard and screen-reader users when hand-rolled get
 * `@base-ui/react`. This module is the other half of that. Naming a library
 * without its import shape and anatomy is how a model ends up inventing an
 * API and shipping a project that does not build, which is the failure this
 * package refused to import from a three.js skill whose own API detail had
 * drifted twenty releases.
 *
 * Adapted from the `pick-ui-library` skill in emilkowalski/skills (MIT
 * License, https://github.com/emilkowalski/skills). One library is taken from
 * its list of a dozen, on a specific test: hand-rolling this produces a
 * defect the person who asked cannot see. Charts, state management,
 * className helpers and virtualization are convenience and are not taken;
 * its animation recommendation is not taken either, because MOTION BASELINE
 * is plain-CSS-first on purpose.
 *
 * The anatomy below was read from the library's own current documentation
 * rather than recalled, and the package name and every subpath were checked
 * against the published package on the registry rather than assumed -- the
 * predecessor name `@base-ui-components/react` still exists and is stuck on
 * an old release candidate, so recalling it would have shipped a dependency
 * that installs and then does not match any of this.
 *
 * Its two date-fns peer dependencies are optional, so `npm install` stays a
 * single package with no prompts. That matters for PORTABILITY and was
 * checked, not assumed.
 *
 * What is deliberately absent is a version number: a pinned version in a
 * prompt goes stale silently, the same reason the browser-support claims in
 * `motion.ts` were left behind. The package name and the compositional shape
 * are the durable parts.
 *
 * Closed set, same security property as its siblings.
 */

export interface PrimitiveRecipe {
  id: string;
  name: string;
  /** Lowercase words/phrases matched against the request text. */
  triggers: readonly string[];
  /** Appended to the request when this recipe matches. */
  guidance: string;
}

/**
 * Stated once when any primitive matches, so two matches cannot drift apart
 * and the shared shape is not repeated.
 */
export const PRIMITIVE_BASICS = `Install @base-ui/react and import each component from its own subpath, for
example \`import { Dialog } from '@base-ui/react/dialog'\`. Every component
composes the same way: a Root holding state, a Trigger, a Portal, a
Positioner for anything anchored, and a Popup for the surface itself.

It ships no styles at all, which is the point: give each part a className and
style it in src/styles.css with the project's own tokens, exactly as any
hand-written element would be. Style open and closed states from the data
attributes the parts set rather than from React state, and pair that with the
motion baseline's easing tokens.`;

export const PRIMITIVE_RECIPES: readonly PrimitiveRecipe[] = [
  {
    id: 'dialog',
    name: 'Dialog or modal',
    triggers: ['modal', 'dialog', 'confirmation popup', 'lightbox'],
    guidance:
      "`import { Dialog } from '@base-ui/react/dialog'`. Compose Dialog.Root > Dialog.Trigger, then Dialog.Portal > Dialog.Backdrop > Dialog.Popup containing Dialog.Title, Dialog.Description and Dialog.Close. Title and Description are what give the dialog its accessible name, so include both rather than a plain heading. It traps focus, restores it to the trigger on close, closes on Escape and on a click outside, and marks the rest of the page inert: that list is exactly what a div-based version gets wrong. Use `open` with `onOpenChange` when something else needs to close it, such as a form submit.",
  },
  {
    id: 'menu',
    name: 'Dropdown menu',
    triggers: ['dropdown', 'dropdown menu', 'context menu', 'action menu'],
    guidance:
      "`import { Menu } from '@base-ui/react/menu'`. Compose Menu.Root > Menu.Trigger, then Menu.Portal > Menu.Positioner > Menu.Popup > Menu.Item. The Positioner is what keeps the panel on screen near an edge, so do not replace it with absolute positioning. Items are reached by arrow keys with typeahead and the roles are set for you. A menu is for actions; if the control picks a value that persists and shows, that is a Select, not a Menu.",
  },
  {
    id: 'select',
    name: 'Select',
    triggers: [
      'select menu',
      'dropdown select',
      'picker',
      'choose from a list',
    ],
    guidance:
      "`import { Select } from '@base-ui/react/select'`. Compose Select.Root > Select.Trigger > Select.Value, then Select.Portal > Select.Positioner > Select.Popup > Select.Item > Select.ItemText. Give Root a `name` and it submits inside a plain form like a native select, via a hidden input. Use `value` with `onValueChange` for a controlled one. Reach for a native `<select>` instead when nothing about it needs custom rendering: the dependency is worth it for a styled or grouped list, not for three plain options.",
  },
  {
    id: 'combobox',
    name: 'Combobox or autocomplete',
    triggers: [
      'combobox',
      'autocomplete',
      'type to search',
      'searchable select',
      'tag input',
    ],
    guidance:
      "`import { Combobox } from '@base-ui/react/combobox'`. Compose Combobox.Root > Combobox.InputGroup (Input, Trigger, Clear) then Combobox.Portal > Combobox.Positioner > Combobox.Popup > Combobox.List > Combobox.Item. Include Combobox.Empty for the no-results case, which is the state a hand-rolled one always forgets and which leaves a screen-reader user with silence. Combobox.Chips with Chip and ChipRemove gives multi-select tags. This is the control with the most ARIA to get wrong: the input, the list and the active option all have to stay in agreement as the user types.",
  },
  {
    id: 'popover',
    name: 'Popover or tooltip',
    triggers: ['popover', 'tooltip', 'hover card', 'info bubble'],
    guidance:
      "`import { Popover } from '@base-ui/react/popover'` for a panel the user opens, or `@base-ui/react/tooltip` for hover help on a control. Both compose Root > Trigger, then Portal > Positioner > Popup, with an optional Arrow inside the Popup. Tooltip additionally needs a Tooltip.Provider near the root of the app so a group of tooltips shares one delay. A tooltip must never hold the only copy of something important or anything interactive: it is unreachable on touch and disappears on the way to it.",
  },
];

export function selectPrimitives(
  promptText: string,
  limit = 2,
): readonly PrimitiveRecipe[] {
  const lower = promptText.toLowerCase();
  const matched = PRIMITIVE_RECIPES.filter((recipe) =>
    recipe.triggers.some((trigger) => lower.includes(trigger)),
  );
  return matched.slice(0, limit);
}

export function findPrimitive(id: string): PrimitiveRecipe | null {
  return PRIMITIVE_RECIPES.find((recipe) => recipe.id === id) ?? null;
}

export function primitiveGuidance(promptText: string): string | null {
  const recipes = selectPrimitives(promptText);
  if (recipes.length === 0) return null;
  const sections = recipes
    .map((recipe) => `${recipe.name}: ${recipe.guidance}`)
    .join('\n\n');
  return `This request needs one or more of the controls STACK allows a dependency for. Where any of this conflicts with an instruction in the request above, follow the request.

${PRIMITIVE_BASICS}

${sections}`;
}
