/**
 * How to build the controls that are broken when hand-rolled, retrieved on
 * demand.
 *
 * STACK says a dialog, menu, select, combobox, popover or tooltip is always
 * the shadcn/ui component on Radix, never divs (ADR-0014). This module is
 * the other half of that: the parts each one composes from. Naming a
 * component without its anatomy is how a model ends up inventing an API and
 * shipping a project that does not build.
 *
 * The rule's test: hand-rolling this produces a defect the person who asked
 * cannot see. A
 * div-based dropdown looks right to the person who asked for it and is
 * unusable by keyboard.
 *
 * The part names below were read from the installed `radix-ui` package's
 * type declarations on 2026-09-26, not recalled: `radix-ui` exports each
 * primitive as a namespace (`import { Dialog as DialogPrimitive } from
 * 'radix-ui'`), and shadcn/ui's components wrap those parts one to one. The
 * one component not on Radix is shadcn's Command, which is built on `cmdk`.
 *
 * Versions live in `stack.ts`, with every other package, rather than here.
 *
 * Closed set, same security property as its siblings.
 */

import { OPTIONAL_PACKAGES } from './stack.ts';

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
export const PRIMITIVE_BASICS = `Each control is a shadcn/ui component written as a source file in
src/components/ui/, wrapping the Radix primitive of the same name:
\`import { Dialog as DialogPrimitive } from 'radix-ui'\`. Keep shadcn's file
names and exports (dialog.tsx exports Dialog, DialogTrigger, DialogContent,
DialogTitle and so on), give each part a data-slot attribute, merge classes
with cn() from @/lib/utils, and style it with the project's tokens through
Tailwind utilities. Style open and closed states from the data attributes
Radix sets (data-[state=open]:animate-in), and add motion-reduce:animate-none
beside every animate-in and animate-out.`;

export const PRIMITIVE_RECIPES: readonly PrimitiveRecipe[] = [
  {
    id: 'dialog',
    name: 'Dialog or modal',
    triggers: ['modal', 'dialog', 'confirmation popup', 'lightbox', 'sheet'],
    guidance:
      'src/components/ui/dialog.tsx over DialogPrimitive: Root > Trigger, then Portal > Overlay > Content holding Title, Description and Close. Title and Description give the dialog its accessible name, so include both rather than a plain heading (visually hidden with sr-only if the design has no visible title). It traps focus, restores it to the trigger on close, closes on Escape and on a click outside, and hides the rest of the page from assistive technology: that list is exactly what a div-based version gets wrong. A sheet is the same primitive sliding from an edge. Use `open` with `onOpenChange` when something else needs to close it, such as a form submit.',
  },
  {
    id: 'menu',
    name: 'Dropdown menu',
    triggers: ['dropdown', 'dropdown menu', 'context menu', 'action menu'],
    guidance:
      "src/components/ui/dropdown-menu.tsx over DropdownMenu from 'radix-ui': Root > Trigger, then Portal > Content > Item, with Label, Separator, Group, CheckboxItem and RadioGroup > RadioItem where needed. Content positions itself and stays on screen near an edge, so do not replace it with absolute positioning. Items are reached by arrow keys with typeahead and the roles are set for you. A menu is for actions; if the control picks a value that persists and shows, that is a Select, not a menu.",
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
      "src/components/ui/select.tsx over Select from 'radix-ui': Root > Trigger > Value (with Icon holding a lucide ChevronDown), then Portal > Content > Viewport > Item > ItemText, with ItemIndicator for the check. Give Root a `name` and it submits inside a plain form like a native select. Use `value` with `onValueChange` for a controlled one. A native `<select>` styled with utilities is fine when nothing about the list needs custom rendering.",
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
    guidance: `shadcn's combobox is a Popover holding a Command: src/components/ui/popover.tsx over Popover from 'radix-ui', and src/components/ui/command.tsx over the cmdk package (add cmdk@${OPTIONAL_PACKAGES.cmdk} to dependencies). Compose Popover Root > Trigger (a button showing the current value, role="combobox", aria-expanded) > Content > Command > CommandInput, CommandList > CommandEmpty and CommandGroup > CommandItem. Include CommandEmpty for the no-results case, which a hand-rolled one always forgets and which leaves a screen-reader user with silence.`,
  },
  {
    id: 'popover',
    name: 'Popover or tooltip',
    triggers: ['popover', 'tooltip', 'hover card', 'info bubble'],
    guidance:
      "src/components/ui/popover.tsx over Popover from 'radix-ui' for a panel the user opens (Root > Trigger, then Portal > Content, optional Arrow), or src/components/ui/tooltip.tsx over Tooltip for hover help on a control (Provider near the root of the app, then Root > Trigger > Portal > Content). A tooltip must never hold the only copy of something important or anything interactive: it is unreachable on touch and disappears on the way to it.",
  },
  {
    id: 'tabs',
    name: 'Tabs or accordion',
    triggers: ['tabs', 'tabbed', 'accordion', 'faq', 'collapsible'],
    guidance:
      "src/components/ui/tabs.tsx over Tabs from 'radix-ui' (Root > List > Trigger, and Content per value), or src/components/ui/accordion.tsx over Accordion (Root type=\"single\" collapsible > Item > Header > Trigger, then Content). Arrow keys move between tabs and triggers and the roles and aria-expanded are set for you. Animate the accordion's height with tw-animate-css's accordion-down and accordion-up on data-[state], and animate the active tab's indicator with Motion's layoutId.",
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
  return `This request needs one or more of the controls STACK says are always a shadcn/ui component. Where any of this conflicts with an instruction in the request above, follow the request.

${PRIMITIVE_BASICS}

${sections}`;
}
