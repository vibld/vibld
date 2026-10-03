---
{
  "intent": "A storefront for a small candle maker, aimed at customers who appreciate minimalist design and natural scents, with the single job of showcasing products and allowing cart management without a backend.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#FAFAF9",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1C1917",
        "use": "primary text"
      },
      {
        "name": "primary",
        "value": "#B45309",
        "use": "accent for buttons, links, focus rings"
      },
      {
        "name": "primary-foreground",
        "value": "#FFFFFF",
        "use": "text on primary buttons"
      },
      {
        "name": "muted",
        "value": "#F5F5F4",
        "use": "subtle backgrounds, hover states"
      },
      {
        "name": "muted-foreground",
        "value": "#78716C",
        "use": "secondary text, placeholders"
      },
      {
        "name": "border",
        "value": "#E7E5E4",
        "use": "card borders, dividers"
      },
      {
        "name": "ring",
        "value": "#B45309",
        "use": "focus ring color"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "Georgia, serif",
        "weights": [
          400,
          600
        ]
      },
      {
        "role": "body",
        "family": "Work Sans",
        "fallback": "system-ui, sans-serif",
        "weights": [
          400,
          500,
          600
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(3rem, 8vw, 5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h1",
        "size": "clamp(2.25rem, 5vw, 3rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "h2",
        "size": "clamp(1.5rem, 3vw, 2rem)",
        "lineHeight": "1.3",
        "letterSpacing": "0"
      },
      {
        "name": "h3",
        "size": "1.25rem",
        "lineHeight": "1.4",
        "letterSpacing": "0"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.6",
        "letterSpacing": "0"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "section",
        "value": "80px"
      },
      {
        "name": "section-mobile",
        "value": "40px"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "4px"
      }
    ],
    "effects": [
      {
        "name": "fade",
        "value": "opacity 150ms ease-out"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the brand and lead to the product grid.",
      "layout": "Full-width, centered text, max-width 720px, padding 80px 24px on desktop, 40px 24px on mobile.",
      "copy": [
        {
          "role": "heading",
          "text": "Candles with calm in mind"
        },
        {
          "role": "body",
          "text": "Small-batch, hand-poured candles made with natural wax and essential oils."
        },
        {
          "role": "button",
          "text": "Shop candles"
        }
      ]
    },
    {
      "id": "product-grid",
      "purpose": "Showcase available candles with name and price, linking to detail pages.",
      "layout": "Max-width 1200px, margin auto, padding 40px 24px, grid 1 column mobile, 2 columns tablet, 3 columns desktop, gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "Shop the collection"
        },
        {
          "role": "product-name",
          "text": "Cedar & Sage"
        },
        {
          "role": "product-price",
          "text": "$28"
        },
        {
          "role": "product-name",
          "text": "Amber Dusk"
        },
        {
          "role": "product-price",
          "text": "$32"
        },
        {
          "role": "product-name",
          "text": "Lavender Field"
        },
        {
          "role": "product-price",
          "text": "$30"
        },
        {
          "role": "product-name",
          "text": "Sea Salt"
        },
        {
          "role": "product-price",
          "text": "$34"
        },
        {
          "role": "product-name",
          "text": "Vanilla Oak"
        },
        {
          "role": "product-price",
          "text": "$26"
        },
        {
          "role": "product-name",
          "text": "Citrus Grove"
        },
        {
          "role": "product-price",
          "text": "$29"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "Product grid becomes 1 column",
        "Hero padding reduces to 40px",
        "Section padding reduces to 40px"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "Product grid becomes 2 columns",
        "Container max-width adjusts"
      ]
    }
  ],
  "motion": [
    {
      "element": "Page content on load",
      "trigger": "load",
      "behaviour": "fade in opacity from 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Product cards on scroll into view",
      "trigger": "in view",
      "behaviour": "fade in opacity from 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Buttons on hover",
      "trigger": "hover",
      "behaviour": "reduce opacity to 0.8",
      "timing": "150ms ease-out"
    },
    {
      "element": "Cart sheet overlay and panel",
      "trigger": "open",
      "behaviour": "fade in opacity from 0 to 1",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use generous whitespace: section padding 80px desktop, 40px mobile",
    "Use the accent color only for primary buttons, links, and focus rings",
    "Keep the type scale strict: use only the tokens defined (display, h1, h2, h3, body, small)",
    "Use borders only to separate cards and form fields",
    "Keep all motion opacity-only with 150ms ease-out"
  ],
  "avoid": [
    "No drop shadows or elevation effects; they add visual noise",
    "No transforms or movement other than opacity; it would break the quiet motion design",
    "No additional colors beyond the palette; they would dilute the accent",
    "No decorative elements without meaning; every element must serve a purpose"
  ],
  "checks": [
    "All text meets 4.5:1 contrast ratio",
    "Every interactive element has a visible focus state and is keyboard reachable",
    "Cart persists across page reloads and reads/writes localStorage safely",
    "Checkout button states that this is a demonstration and no order will be placed",
    "All motion is opacity only with 150ms ease-out"
  ]
}
---

# Design

A storefront for a small candle maker, aimed at customers who appreciate minimalist design and natural scents, with the single job of showcasing products and allowing cart management without a backend.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Page content on load | load | fade in opacity from 0 to 1 | 150ms ease-out |
| Product cards on scroll into view | in view | fade in opacity from 0 to 1 | 150ms ease-out |
| Buttons on hover | hover | reduce opacity to 0.8 | 150ms ease-out |
| Cart sheet overlay and panel | open | fade in opacity from 0 to 1 | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use generous whitespace: section padding 80px desktop, 40px mobile
- Use the accent color only for primary buttons, links, and focus rings
- Keep the type scale strict: use only the tokens defined (display, h1, h2, h3, body, small)
- Use borders only to separate cards and form fields
- Keep all motion opacity-only with 150ms ease-out

## Don't

- No drop shadows or elevation effects; they add visual noise
- No transforms or movement other than opacity; it would break the quiet motion design
- No additional colors beyond the palette; they would dilute the accent
- No decorative elements without meaning; every element must serve a purpose

## Checks

- All text meets 4.5:1 contrast ratio
- Every interactive element has a visible focus state and is keyboard reachable
- Cart persists across page reloads and reads/writes localStorage safely
- Checkout button states that this is a demonstration and no order will be placed
- All motion is opacity only with 150ms ease-out
