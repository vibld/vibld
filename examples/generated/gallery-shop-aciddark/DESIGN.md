---
{
  "intent": "A storefront for a small candle maker targeting design-minded buyers, presenting a small catalog with prices and a persistent browser cart that plainly states it is a demo.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#E8FF52",
        "use": "Primary action color, the only saturated accent"
      },
      {
        "name": "primary-foreground",
        "value": "#0A0A0A",
        "use": "Text on primary buttons"
      },
      {
        "name": "secondary",
        "value": "#1A1A1A",
        "use": "Secondary button background"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "Text on secondary buttons"
      },
      {
        "name": "accent",
        "value": "#B9CC3F",
        "use": "Muted accent for focus rings or subtle states, not used as a second saturated color"
      },
      {
        "name": "accent-foreground",
        "value": "#0A0A0A",
        "use": "Text on accent elements"
      },
      {
        "name": "background",
        "value": "#0A0A0A",
        "use": "Page background"
      },
      {
        "name": "foreground",
        "value": "#FFFFFF",
        "use": "Primary text"
      },
      {
        "name": "card",
        "value": "#121212",
        "use": "Card background"
      },
      {
        "name": "card-foreground",
        "value": "#FFFFFF",
        "use": "Text on cards"
      },
      {
        "name": "muted",
        "value": "#1F1F1F",
        "use": "Muted background surfaces"
      },
      {
        "name": "muted-foreground",
        "value": "#9A9A9A",
        "use": "Secondary text"
      },
      {
        "name": "border",
        "value": "#2A2A2A",
        "use": "Borders and dividers"
      },
      {
        "name": "ring",
        "value": "#E8FF52",
        "use": "Focus ring color"
      },
      {
        "name": "destructive",
        "value": "#FF5C5C",
        "use": "Destructive actions, but not used decoratively"
      },
      {
        "name": "destructive-foreground",
        "value": "#0A0A0A",
        "use": "Text on destructive elements"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Space Grotesk",
        "fallback": "system-ui, sans-serif",
        "weights": [
          500,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "IBM Plex Sans",
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
        "size": "clamp(3rem, 8vw, 6rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "h1",
        "size": "clamp(2.25rem, 5vw, 3.75rem)",
        "lineHeight": "1.0",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h2",
        "size": "clamp(1.5rem, 3vw, 2.25rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
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
        "lineHeight": "1.4",
        "letterSpacing": "0.01em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "section-y",
        "value": "96px"
      },
      {
        "name": "stack-gap",
        "value": "16px"
      },
      {
        "name": "card-pad",
        "value": "16px"
      },
      {
        "name": "header-h",
        "value": "64px"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "4px"
      },
      {
        "name": "md",
        "value": "6px"
      },
      {
        "name": "lg",
        "value": "8px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "accent-glow",
        "value": "box-shadow: 0 0 12px rgba(232,255,82,.35)"
      },
      {
        "name": "card-shadow",
        "value": "box-shadow: 0 4px 12px rgba(0,0,0,.4)"
      },
      {
        "name": "sheet-shadow",
        "value": "box-shadow: -12px 0 32px rgba(0,0,0,.5)"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the brand, lead to products, and state the demo cart plainly.",
      "layout": "max-w-3xl mx-auto text-center px-gutter py-24, stacked elements with gap-6",
      "copy": [
        {
          "role": "heading",
          "text": "Candles for dark rooms."
        },
        {
          "role": "body",
          "text": "Small-batch soy candles, poured in Berlin. The cart stays in your browser, so add freely. Nothing is charged."
        },
        {
          "role": "button",
          "text": "Shop candles"
        },
        {
          "role": "status",
          "text": "Demo cart, keeps items in your browser"
        }
      ]
    },
    {
      "id": "products",
      "purpose": "Show the current catalog with prices and add-to-cart actions.",
      "layout": "max-w-6xl mx-auto px-gutter py-16, grid gap-6, 1 col mobile, 2 cols at md, 3 at lg",
      "copy": [
        {
          "role": "heading",
          "text": "Current pour"
        },
        {
          "role": "product-name",
          "text": "Night Shift"
        },
        {
          "role": "price",
          "text": "$28"
        },
        {
          "role": "notes",
          "text": "Smoked vetiver, black cardamom, cedar"
        },
        {
          "role": "button",
          "text": "Add to cart"
        },
        {
          "role": "product-name",
          "text": "Acid Test"
        },
        {
          "role": "price",
          "text": "$32"
        },
        {
          "role": "notes",
          "text": "Lime zest, white tea, ozone"
        },
        {
          "role": "button",
          "text": "Add to cart"
        },
        {
          "role": "product-name",
          "text": "Concrete"
        },
        {
          "role": "price",
          "text": "$26"
        },
        {
          "role": "notes",
          "text": "Wet stone, iris, sandalwood"
        },
        {
          "role": "button",
          "text": "Add to cart"
        },
        {
          "role": "product-name",
          "text": "Afterimage"
        },
        {
          "role": "price",
          "text": "$30"
        },
        {
          "role": "notes",
          "text": "Burnt sugar, tobacco leaf, amber"
        },
        {
          "role": "button",
          "text": "Add to cart"
        },
        {
          "role": "product-name",
          "text": "Low Light"
        },
        {
          "role": "price",
          "text": "$28"
        },
        {
          "role": "notes",
          "text": "Jasmine, cold air, musk"
        },
        {
          "role": "button",
          "text": "Add to cart"
        },
        {
          "role": "product-name",
          "text": "Voltage"
        },
        {
          "role": "price",
          "text": "$34"
        },
        {
          "role": "notes",
          "text": "Bergamot, electric mint, patchouli"
        },
        {
          "role": "button",
          "text": "Add to cart"
        }
      ]
    },
    {
      "id": "demo-note",
      "purpose": "Explain the browser-only cart in plain terms.",
      "layout": "max-w-3xl mx-auto px-gutter py-16 text-left",
      "copy": [
        {
          "role": "heading",
          "text": "The cart is a simulation."
        },
        {
          "role": "body",
          "text": "This store has no checkout. Items stay in your browser's local storage and clear when you close the site. Nothing leaves your device."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 650,
      "changes": [
        "Hero padding reduces to py-16",
        "Display size uses smaller clamp value",
        "Product grid remains 1 column",
        "Header condenses brand to icon"
      ]
    },
    {
      "maxWidth": 900,
      "changes": [
        "Product grid becomes 2 columns",
        "Section padding reduces to py-12"
      ]
    },
    {
      "maxWidth": 1200,
      "changes": [
        "Product grid becomes 3 columns",
        "Hero max width becomes 5xl"
      ]
    }
  ],
  "motion": [
    {
      "element": "Add to cart button",
      "trigger": "press",
      "behaviour": "Scale to 0.97",
      "timing": "120ms ease-out"
    },
    {
      "element": "Cart sheet",
      "trigger": "open or close",
      "behaviour": "Slide in from right 100 percent width, fade",
      "timing": "180ms ease-out"
    },
    {
      "element": "Cart count badge",
      "trigger": "cart count change",
      "behaviour": "Pulse accent glow twice",
      "timing": "150ms ease-out each, 150ms gap"
    },
    {
      "element": "Sheet overlay",
      "trigger": "open or close",
      "behaviour": "Fade in",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use only #E8FF52 for primary actions, never decorative",
    "Keep all UI grayscale with body text #FFFFFF and muted #9A9A9A",
    "Use Space Grotesk for headings and IBM Plex Sans for body",
    "Keep transitions between 100 and 180ms, except the two-step accent pulse",
    "Use border #2A2A2A for separation"
  ],
  "avoid": [
    "A second saturated color anywhere: it breaks the one-accent rule",
    "Animations longer than 180ms except the pulse: slow fades dilute the sharp feel",
    "Rounded corners above 8px: the design is square and technical",
    "Decorative motion like parallax or hover lift: motion is reserved for state feedback and cart interactions",
    "Raw hex values in components: always use utility classes"
  ],
  "checks": [
    "The only saturated color on the page is #E8FF52, used only on interactive elements",
    "Cart button shows item count and pulses when count changes",
    "Cart sheet opens from right with items, quantities, total, and a clear button",
    "The text 'The cart is a simulation.' appears on the home page",
    "Product grid shows 6 products with prices and add buttons",
    "Reloading the page restores the cart from localStorage"
  ]
}
---

# Design

A storefront for a small candle maker targeting design-minded buyers, presenting a small catalog with prices and a persistent browser cart that plainly states it is a demo.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Add to cart button | press | Scale to 0.97 | 120ms ease-out |
| Cart sheet | open or close | Slide in from right 100 percent width, fade | 180ms ease-out |
| Cart count badge | cart count change | Pulse accent glow twice | 150ms ease-out each, 150ms gap |
| Sheet overlay | open or close | Fade in | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use only #E8FF52 for primary actions, never decorative
- Keep all UI grayscale with body text #FFFFFF and muted #9A9A9A
- Use Space Grotesk for headings and IBM Plex Sans for body
- Keep transitions between 100 and 180ms, except the two-step accent pulse
- Use border #2A2A2A for separation

## Don't

- A second saturated color anywhere: it breaks the one-accent rule
- Animations longer than 180ms except the pulse: slow fades dilute the sharp feel
- Rounded corners above 8px: the design is square and technical
- Decorative motion like parallax or hover lift: motion is reserved for state feedback and cart interactions
- Raw hex values in components: always use utility classes

## Checks

- The only saturated color on the page is #E8FF52, used only on interactive elements
- Cart button shows item count and pulses when count changes
- Cart sheet opens from right with items, quantities, total, and a clear button
- The text 'The cart is a simulation.' appears on the home page
- Product grid shows 6 products with prices and add buttons
- Reloading the page restores the cart from localStorage
