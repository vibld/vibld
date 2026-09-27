---
{
  "intent": "A browser-only recipe box for home cooks that saves recipes with ingredients and numbered steps, lets them search by name or ingredient, scale servings with quantities following, and mark favourites, all stored locally.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#FFF8E7",
        "use": "app background"
      },
      {
        "name": "foreground",
        "value": "#1A1A1A",
        "use": "primary text"
      },
      {
        "name": "card",
        "value": "#FFFFFF",
        "use": "dialog and form card background"
      },
      {
        "name": "card-foreground",
        "value": "#1A1A1A",
        "use": "text on card background"
      },
      {
        "name": "popover",
        "value": "#FFFFFF",
        "use": "popover background"
      },
      {
        "name": "popover-foreground",
        "value": "#1A1A1A",
        "use": "popover text"
      },
      {
        "name": "primary",
        "value": "#FF5A1F",
        "use": "primary buttons, block color, focus ring"
      },
      {
        "name": "primary-foreground",
        "value": "#FFFFFF",
        "use": "text on primary blocks"
      },
      {
        "name": "secondary",
        "value": "#0057FF",
        "use": "secondary buttons, block color"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "text on secondary blocks"
      },
      {
        "name": "muted",
        "value": "#F0E6D2",
        "use": "muted background"
      },
      {
        "name": "muted-foreground",
        "value": "#5A4A3A",
        "use": "muted text, placeholder"
      },
      {
        "name": "accent",
        "value": "#FFD600",
        "use": "header background, accent block"
      },
      {
        "name": "accent-foreground",
        "value": "#1A1A1A",
        "use": "text on accent"
      },
      {
        "name": "destructive",
        "value": "#D32F2F",
        "use": "destructive actions, error text"
      },
      {
        "name": "destructive-foreground",
        "value": "#FFFFFF",
        "use": "text on destructive"
      },
      {
        "name": "border",
        "value": "#1A1A1A",
        "use": "every border and outline"
      },
      {
        "name": "input",
        "value": "#FFFFFF",
        "use": "input background"
      },
      {
        "name": "ring",
        "value": "#FF5A1F",
        "use": "focus ring"
      },
      {
        "name": "block-orange",
        "value": "#FF5A1F",
        "use": "recipe card background"
      },
      {
        "name": "block-blue",
        "value": "#0057FF",
        "use": "recipe card background"
      },
      {
        "name": "block-yellow",
        "value": "#FFD600",
        "use": "recipe card background with dark text"
      },
      {
        "name": "block-green",
        "value": "#00C853",
        "use": "recipe card background"
      },
      {
        "name": "block-pink",
        "value": "#FF2E92",
        "use": "recipe card background"
      },
      {
        "name": "block-purple",
        "value": "#7C3AED",
        "use": "recipe card background"
      },
      {
        "name": "block-teal",
        "value": "#00B8A9",
        "use": "recipe card background"
      },
      {
        "name": "overlay",
        "value": "rgba(0,0,0,0.48)",
        "use": "dialog overlay"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fredoka",
        "fallback": "Trebuchet MS, sans-serif",
        "weights": [
          400,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "Nunito",
        "fallback": "system-ui, sans-serif",
        "weights": [
          400,
          600,
          700
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(3rem, 8vw, 5.5rem)",
        "lineHeight": "1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "heading",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "title",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "0"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.5",
        "letterSpacing": "0"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.4",
        "letterSpacing": "0"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "section-y",
        "value": "64px"
      }
    ],
    "radii": [
      {
        "name": "sharp",
        "value": "0"
      }
    ],
    "effects": [
      {
        "name": "overlay",
        "value": "background: rgba(0,0,0,0.48)"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "brand and primary action",
      "layout": "max-width 1280px, flex row, justify-between, align center, padding 24px, border-bottom 2px solid --border, background --accent",
      "copy": [
        {
          "role": "heading",
          "text": "Recipe Box"
        },
        {
          "role": "button",
          "text": "Add recipe"
        }
      ]
    },
    {
      "id": "search-panel",
      "purpose": "search and filter",
      "layout": "max-width 1280px, flex column on mobile, row on sm, gap 16px, align end, margin bottom 32px",
      "copy": [
        {
          "role": "label",
          "text": "Search by name or ingredient"
        },
        {
          "role": "placeholder",
          "text": "Type to search"
        },
        {
          "role": "label",
          "text": "Favourites only"
        }
      ]
    },
    {
      "id": "recipe-grid",
      "purpose": "display recipes as colour blocks",
      "layout": "max-width 1280px, grid: 1 column below 768px, 2 columns 768-1279px, 3 columns 1280px+, gap 24px",
      "copy": [
        {
          "role": "heading",
          "text": "Ingredients"
        },
        {
          "role": "heading",
          "text": "Steps"
        },
        {
          "role": "label",
          "text": "Servings"
        },
        {
          "role": "button aria-label",
          "text": "Add to favourites"
        },
        {
          "role": "button aria-label",
          "text": "Remove from favourites"
        },
        {
          "role": "button aria-label",
          "text": "Edit recipe"
        },
        {
          "role": "button aria-label",
          "text": "Delete recipe"
        },
        {
          "role": "button aria-label",
          "text": "Decrease servings"
        },
        {
          "role": "button aria-label",
          "text": "Increase servings"
        }
      ]
    },
    {
      "id": "empty-state",
      "purpose": "message when no recipes match",
      "layout": "centred, padding 64px 0",
      "copy": [
        {
          "role": "heading",
          "text": "No recipes yet. Add your first one!"
        },
        {
          "role": "heading",
          "text": "No recipes match your search."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "storage disclosure",
      "layout": "max-width 1280px, centred, padding 24px, border-top 2px solid --border",
      "copy": [
        {
          "role": "body",
          "text": "Everything is stored in your browser. Nothing leaves this device."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 639,
      "changes": [
        "header stacks vertically with gap 16px",
        "search panel stacks vertically with full width input and filter aligned left",
        "recipe grid single column full width cards"
      ]
    },
    {
      "maxWidth": 767,
      "changes": [
        "recipe grid switches from single column to two columns, cards become equal height blocks"
      ]
    },
    {
      "maxWidth": 1279,
      "changes": [
        "recipe grid switches from two columns to three columns, header and search panel remain row layout"
      ]
    }
  ],
  "do": [
    "use border-2 border-border on every interactive element, card, and section divider",
    "use Fredoka for all headings with letter-spacing -0.02em",
    "use spring transitions with stiffness 300 and damping 25 for all entrance and hover animations",
    "use bg-block-orange, bg-block-blue, bg-block-yellow, bg-block-green, bg-block-pink, bg-block-purple, and bg-block-teal for recipe card backgrounds",
    "use hard edges: radius 0 on every component"
  ],
  "avoid": [
    "do not use any gradients or shadows; they would break the flat block aesthetic",
    "do not use rounded corners on any element; the design language is sharp blocks",
    "do not use an em-dash in any copy, comment, or documentation",
    "do not show placeholders as the only label for an input; every input has a visible label",
    "do not cause horizontal scrolling; layout adapts from 375px to 1440px without overflow"
  ],
  "checks": [
    "footer displays the sentence 'Everything is stored in your browser. Nothing leaves this device.' exactly",
    "scaling servings up or down changes every ingredient quantity proportionally and updates the displayed amount",
    "search filters recipes by name or by any ingredient name, case-insensitive",
    "favourite star toggles between filled and outlined and filters with the Favourites only checkbox",
    "no computed style on any element includes a gradient, box-shadow, or border-radius greater than 0",
    "keyboard tab reaches every interactive element and shows a visible focus ring",
    "dialog for add/edit traps focus and closes with Escape or the close button"
  ]
}
---

# Design

A browser-only recipe box for home cooks that saves recipes with ingredients and numbered steps, lets them search by name or ingredient, scale servings with quantities following, and mark favourites, all stored locally.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- use border-2 border-border on every interactive element, card, and section divider
- use Fredoka for all headings with letter-spacing -0.02em
- use spring transitions with stiffness 300 and damping 25 for all entrance and hover animations
- use bg-block-orange, bg-block-blue, bg-block-yellow, bg-block-green, bg-block-pink, bg-block-purple, and bg-block-teal for recipe card backgrounds
- use hard edges: radius 0 on every component

## Don't

- do not use any gradients or shadows; they would break the flat block aesthetic
- do not use rounded corners on any element; the design language is sharp blocks
- do not use an em-dash in any copy, comment, or documentation
- do not show placeholders as the only label for an input; every input has a visible label
- do not cause horizontal scrolling; layout adapts from 375px to 1440px without overflow

## Checks

- footer displays the sentence 'Everything is stored in your browser. Nothing leaves this device.' exactly
- scaling servings up or down changes every ingredient quantity proportionally and updates the displayed amount
- search filters recipes by name or by any ingredient name, case-insensitive
- favourite star toggles between filled and outlined and filters with the Favourites only checkbox
- no computed style on any element includes a gradient, box-shadow, or border-radius greater than 0
- keyboard tab reaches every interactive element and shows a visible focus ring
- dialog for add/edit traps focus and closes with Escape or the close button
