/**
 * How to use the controls that are broken when hand-rolled, retrieved on
 * demand.
 *
 * STACK says a dialog, menu, select, combobox, popover or tooltip is always
 * the shadcn/ui component on Radix, never divs (ADR-0014). Since D206 those
 * components are written by the build (`ui-components.ts`), and every file
 * step is told what each exports (COMPONENTS WRITTEN FOR YOU). This module
 * is the other half: how a page composes them, and the one or two things
 * about each that a page gets wrong even with the component in hand (a
 * dialog without its title, a combobox without its empty state, a tooltip
 * holding something the visitor needs).
 *
 * The rule's test: getting this wrong produces a defect the person who
 * asked cannot see. A dialog without a title looks right to the person who
 * asked for it and has no name for a screen reader.
 *
 * Every part named here is an export of a templated component;
 * `primitives.test.ts` reads the sources to hold it to that.
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
export const PRIMITIVE_BASICS = `Each of these controls is a component written for you (see COMPONENTS
WRITTEN FOR YOU): import it from @/components/ui/<name>, never write its
file, and never build the control from divs. Restyle a part through its
className with the project's tokens, and put motion-reduce:animate-none
beside any animate-in or animate-out you add.`;

export const PRIMITIVE_RECIPES: readonly PrimitiveRecipe[] = [
  {
    id: 'dialog',
    name: 'Dialog or modal',
    triggers: ['modal', 'dialog', 'confirmation popup', 'lightbox', 'sheet'],
    guidance:
      'Dialog > DialogTrigger asChild > Button, then DialogContent > DialogHeader > DialogTitle and DialogDescription, then the body and DialogFooter. Title and Description give the dialog its accessible name, so include both (sr-only if the design shows no title). A panel sliding from an edge is Sheet, with SheetContent side and its own SheetTitle. Use open with onOpenChange when something else closes it, such as a form submit.',
  },
  {
    id: 'menu',
    name: 'Dropdown menu',
    triggers: ['dropdown', 'dropdown menu', 'context menu', 'action menu'],
    guidance:
      'DropdownMenu > DropdownMenuTrigger asChild > Button, then DropdownMenuContent > DropdownMenuItem, with DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem and DropdownMenuRadioGroup > DropdownMenuRadioItem where needed. It positions itself, so never wrap it in absolute positioning. A menu is for actions; a control that picks a value that persists and shows is a Select.',
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
      'Select > SelectTrigger > SelectValue placeholder, then SelectContent > SelectItem value. Give Select a name and it submits inside a plain form like a native select; use value with onValueChange for a controlled one. A native <select> styled with utilities is fine when nothing about the list needs custom rendering.',
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
      'shadcn\'s combobox is a Popover holding a Command: Popover > PopoverTrigger asChild > Button role="combobox" aria-expanded, showing the current value, then PopoverContent className="p-0" > Command > CommandInput, CommandList > CommandEmpty and CommandGroup > CommandItem onSelect. Include CommandEmpty for the no-results case, which a hand-rolled one always forgets and which leaves a screen-reader user with silence.',
  },
  {
    id: 'popover',
    name: 'Popover or tooltip',
    triggers: ['popover', 'tooltip', 'hover card', 'info bubble'],
    guidance:
      'Popover > PopoverTrigger asChild, PopoverContent for a panel the user opens, or Tooltip > TooltipTrigger asChild, TooltipContent for hover help on a control. A tooltip must never hold the only copy of something important or anything interactive: it is unreachable on touch and disappears on the way to it.',
  },
  {
    id: 'tabs',
    name: 'Tabs or accordion',
    triggers: ['tabs', 'tabbed', 'accordion', 'faq', 'collapsible'],
    guidance:
      'Tabs > TabsList > TabsTrigger value, and TabsContent per value; or Accordion type="single" collapsible > AccordionItem value > AccordionTrigger and AccordionContent, which already animates its height. Arrow keys, roles and aria-expanded are built in. Animate the active tab\'s indicator with Motion\'s layoutId.',
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
  return `This request needs one or more of the controls that are always a shadcn/ui component, never divs. Where any of this conflicts with an instruction in the request above, follow the request.

${PRIMITIVE_BASICS}

${sections}`;
}
