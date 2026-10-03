---
{
  "intent": "A candle storefront for a small maker, where visitors browse products, view details, and manage a cart stored locally in the browser.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#0b0714",
        "use": "page background, very dark plum"
      },
      {
        "name": "foreground",
        "value": "#f5f1ea",
        "use": "primary text on dark background"
      },
      {
        "name": "primary",
        "value": "#f59e0b",
        "use": "amber, main accent, buttons, links, focus ring"
      },
      {
        "name": "primary-foreground",
        "value": "#0b0714",
        "use": "text on primary background"
      },
      {
        "name": "muted",
        "value": "#1e1429",
        "use": "solid background behind glass, slightly lighter dark"
      },
      {
        "name": "muted-foreground",
        "value": "#a89bb0",
        "use": "secondary text, less important text"
      },
      {
        "name": "accent",
        "value": "#fbbf24",
        "use": "lighter amber for hover states"
      },
      {
        "name": "border",
        "value": "rgba(255,255,255,0.15)",
        "use": "hairline border on glass panels"
      },
      {
        "name": "ring",
        "value": "#f59e0b",
        "use": "focus ring color"
      },
      {
        "name": "glass",
        "value": "rgba(255,255,255,0.08)",
        "use": "glass panel background"
      },
      {
        "name": "glass-strong",
        "value": "rgba(255,255,255,0.14)",
        "use": "glass panel hover background"
      },
      {
        "name": "shadow",
        "value": "rgba(0,0,0,0.3)",
        "use": "soft shadow on glass panels"
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
        "family": "Inter",
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
        "name": "hero",
        "size": "clamp(3.5rem, 10vw, 6rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "section-title",
        "size": "clamp(2.5rem, 6vw, 3.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "subsection-title",
        "size": "1.75rem",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "body-lg",
        "size": "1.125rem",
        "lineHeight": "1.6",
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
        "letterSpacing": "0.01em"
      },
      {
        "name": "button",
        "size": "0.9375rem",
        "lineHeight": "1",
        "letterSpacing": "0.02em"
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
        "name": "card-gap",
        "value": "16px"
      },
      {
        "name": "inner-gap",
        "value": "12px"
      }
    ],
    "radii": [
      {
        "name": "card",
        "value": "16px"
      },
      {
        "name": "pill",
        "value": "999px"
      },
      {
        "name": "button",
        "value": "8px"
      },
      {
        "name": "dialog",
        "value": "20px"
      }
    ],
    "effects": [
      {
        "name": "glass",
        "value": "background: var(--glass); backdrop-filter: blur(18px); border: 1px solid var(--border); box-shadow: 0 8px 32px var(--shadow);"
      },
      {
        "name": "glass-hover",
        "value": "background: var(--glass-strong); box-shadow: 0 12px 40px var(--shadow);"
      },
      {
        "name": "glow",
        "value": "box-shadow: 0 0 20px rgba(245,158,11,0.4);"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the brand and lead to product browsing",
      "layout": "centered, min-height 80vh, max-width 1200px, padding gutter, flex column justify center",
      "copy": [
        {
          "role": "heading",
          "text": "Hand-poured candles for quiet moments"
        },
        {
          "role": "body",
          "text": "Small-batch soy wax candles with natural scents, made in small batches in our studio."
        },
        {
          "role": "button",
          "text": "Shop candles"
        }
      ]
    },
    {
      "id": "featured",
      "purpose": "Showcase three best-selling candles",
      "layout": "max-width 1200px, margin auto, padding gutter, grid 3 columns on desktop",
      "copy": [
        {
          "role": "heading",
          "text": "Featured"
        },
        {
          "role": "product-name",
          "text": "Amber Glow"
        },
        {
          "role": "product-price",
          "text": "$18"
        },
        {
          "role": "product-description",
          "text": "Warm amber and vanilla, like a sunset."
        },
        {
          "role": "product-name",
          "text": "Cedar & Sage"
        },
        {
          "role": "product-price",
          "text": "$20"
        },
        {
          "role": "product-description",
          "text": "Woodsy and clean, for focus."
        },
        {
          "role": "product-name",
          "text": "Lavender Dusk"
        },
        {
          "role": "product-price",
          "text": "$19"
        },
        {
          "role": "product-description",
          "text": "Calming lavender with a hint of musk."
        }
      ]
    },
    {
      "id": "all-products",
      "purpose": "Display all available candles",
      "layout": "max-width 1200px, margin auto, padding gutter, grid 3 columns on desktop",
      "copy": [
        {
          "role": "heading",
          "text": "All candles"
        },
        {
          "role": "product-name",
          "text": "Amber Glow"
        },
        {
          "role": "product-price",
          "text": "$18"
        },
        {
          "role": "product-description",
          "text": "Warm amber and vanilla, like a sunset."
        },
        {
          "role": "product-name",
          "text": "Cedar & Sage"
        },
        {
          "role": "product-price",
          "text": "$20"
        },
        {
          "role": "product-description",
          "text": "Woodsy and clean, for focus."
        },
        {
          "role": "product-name",
          "text": "Lavender Dusk"
        },
        {
          "role": "product-price",
          "text": "$19"
        },
        {
          "role": "product-description",
          "text": "Calming lavender with a hint of musk."
        },
        {
          "role": "product-name",
          "text": "Sea Salt & Driftwood"
        },
        {
          "role": "product-price",
          "text": "$22"
        },
        {
          "role": "product-description",
          "text": "Fresh ocean breeze with a woody base."
        },
        {
          "role": "product-name",
          "text": "Fig & Honey"
        },
        {
          "role": "product-price",
          "text": "$21"
        },
        {
          "role": "product-description",
          "text": "Sweet fig with a touch of golden honey."
        },
        {
          "role": "product-name",
          "text": "Pumpkin Spice"
        },
        {
          "role": "product-price",
          "text": "$18"
        },
        {
          "role": "product-description",
          "text": "Classic autumn spices, cozy and warm."
        }
      ]
    },
    {
      "id": "about",
      "purpose": "Share the maker's story and process",
      "layout": "max-width 800px, margin auto, padding gutter, text left",
      "copy": [
        {
          "role": "heading",
          "text": "From our studio"
        },
        {
          "role": "body",
          "text": "We hand-pour every candle in small batches using 100% soy wax and cotton wicks. Each scent is blended from natural essential oils and phthalate-free fragrance oils. Our candles burn clean for 40 to 50 hours, filling your space with a subtle, true-to-life aroma."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Provide site footer with cart storage note",
      "layout": "max-width 1200px, margin auto, padding gutter, flex space between items",
      "copy": [
        {
          "role": "note",
          "text": "Your cart is stored locally in your browser. No data leaves your device."
        }
      ]
    },
    {
      "id": "cart-items",
      "purpose": "List items in the cart with quantity controls and removal",
      "layout": "max-width 800px, margin auto, padding gutter, flex column gap card-gap",
      "copy": [
        {
          "role": "heading",
          "text": "Your cart"
        },
        {
          "role": "empty",
          "text": "Your cart is empty."
        },
        {
          "role": "remove",
          "text": "Remove"
        }
      ]
    },
    {
      "id": "cart-summary",
      "purpose": "Show order total and checkout note",
      "layout": "max-width 400px, margin auto, padding gutter, card",
      "copy": [
        {
          "role": "heading",
          "text": "Summary"
        },
        {
          "role": "subtotal",
          "text": "Subtotal"
        },
        {
          "role": "button",
          "text": "Checkout unavailable"
        },
        {
          "role": "note",
          "text": "Your cart is stored locally in your browser. No data leaves your device."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 375,
      "changes": [
        "single column layout, reduced padding, nav shows only logo and cart icon"
      ]
    },
    {
      "maxWidth": 640,
      "changes": [
        "product grid becomes 2 columns, featured grid becomes 2 columns"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "product grid becomes 3 columns, featured grid becomes 3 columns, nav links become visible"
      ]
    },
    {
      "maxWidth": 1440,
      "changes": [
        "container max-width 1200px, centered with auto margins"
      ]
    }
  ],
  "motion": [
    {
      "element": "hero heading, paragraph, button",
      "trigger": "load",
      "behaviour": "stagger in, rise 20px, opacity 0 to 1",
      "timing": "stagger 0.06s, spring stiffness 120 damping 20"
    },
    {
      "element": "product card",
      "trigger": "in view",
      "behaviour": "materialize: blur 0 to 18px, scale 0.95 to 1, opacity 0 to 1",
      "timing": "250ms ease-out, stagger 0.05s"
    },
    {
      "element": "dialog overlay and panel",
      "trigger": "open",
      "behaviour": "backdrop-filter blur 0 to 18px, panel scale 0.95 to 1, opacity 0 to 1",
      "timing": "250ms ease-out"
    },
    {
      "element": "cart item",
      "trigger": "remove",
      "behaviour": "exit: opacity 1 to 0, x 0 to -20px",
      "timing": "200ms ease-out"
    },
    {
      "element": "product card (hover)",
      "trigger": "hover",
      "behaviour": "scale 1.02, shadow increase",
      "timing": "150ms ease-out"
    },
    {
      "element": "button (tap)",
      "trigger": "press",
      "behaviour": "scale 0.97",
      "timing": "100ms ease-out"
    }
  ],
  "do": [
    "Use glass effect only on panels that need it, with sufficient contrast for text",
    "Ensure all interactive elements have visible focus states and are keyboard reachable",
    "Store cart in localStorage with try/catch and validation",
    "Use lucide-react icons for cart, close, remove, etc.",
    "Use amber primary color (#f59e0b) consistently for buttons, links, and focus rings"
  ],
  "avoid": [
    "Stacking translucent surfaces (one glass panel on another)",
    "Using raw hex colors in className; use CSS custom properties via Tailwind theme",
    "Making text unreadable over glass by insufficient contrast",
    "Overusing blur; apply only to panels, not entire page",
    "Using emojis as functional icons"
  ],
  "checks": [
    "All text on glass panels has a contrast ratio of at least 4.5:1",
    "Cart persists after page reload and new browser session",
    "Cart note is visible on the page",
    "Focus is visible on all interactive elements (buttons, links, inputs)",
    "No horizontal scroll at any breakpoint"
  ]
}
---

# Design

A candle storefront for a small maker, where visitors browse products, view details, and manage a cart stored locally in the browser.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| hero heading, paragraph, button | load | stagger in, rise 20px, opacity 0 to 1 | stagger 0.06s, spring stiffness 120 damping 20 |
| product card | in view | materialize: blur 0 to 18px, scale 0.95 to 1, opacity 0 to 1 | 250ms ease-out, stagger 0.05s |
| dialog overlay and panel | open | backdrop-filter blur 0 to 18px, panel scale 0.95 to 1, opacity 0 to 1 | 250ms ease-out |
| cart item | remove | exit: opacity 1 to 0, x 0 to -20px | 200ms ease-out |
| product card (hover) | hover | scale 1.02, shadow increase | 150ms ease-out |
| button (tap) | press | scale 0.97 | 100ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use glass effect only on panels that need it, with sufficient contrast for text
- Ensure all interactive elements have visible focus states and are keyboard reachable
- Store cart in localStorage with try/catch and validation
- Use lucide-react icons for cart, close, remove, etc.
- Use amber primary color (#f59e0b) consistently for buttons, links, and focus rings

## Don't

- Stacking translucent surfaces (one glass panel on another)
- Using raw hex colors in className; use CSS custom properties via Tailwind theme
- Making text unreadable over glass by insufficient contrast
- Overusing blur; apply only to panels, not entire page
- Using emojis as functional icons

## Checks

- All text on glass panels has a contrast ratio of at least 4.5:1
- Cart persists after page reload and new browser session
- Cart note is visible on the page
- Focus is visible on all interactive elements (buttons, links, inputs)
- No horizontal scroll at any breakpoint
