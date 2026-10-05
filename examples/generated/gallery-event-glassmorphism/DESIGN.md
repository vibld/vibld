---
{
  "intent": "Promote a weekend food festival, informing visitors about vendors, schedule, tickets, and location with a modern glassmorphism aesthetic.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#1a0b2e",
        "use": "page background, deep purple for contrast with light glass panels"
      },
      {
        "name": "foreground",
        "value": "#ffffff",
        "use": "primary text on background"
      },
      {
        "name": "primary",
        "value": "#ff6b35",
        "use": "accent color for buttons, links, highlights"
      },
      {
        "name": "primary-foreground",
        "value": "#1a1a1a",
        "use": "text on primary-colored elements"
      },
      {
        "name": "muted",
        "value": "rgba(255,255,255,0.65)",
        "use": "secondary text on background"
      },
      {
        "name": "muted-foreground",
        "value": "#f0e6ff",
        "use": "text on muted backgrounds"
      },
      {
        "name": "accent",
        "value": "#ffd166",
        "use": "secondary accent for highlights, badges"
      },
      {
        "name": "border",
        "value": "rgba(255,255,255,0.2)",
        "use": "default border color"
      },
      {
        "name": "ring",
        "value": "#ffd166",
        "use": "focus ring color"
      },
      {
        "name": "glass",
        "value": "rgba(255,255,255,0.12)",
        "use": "background of frosted glass panels"
      },
      {
        "name": "glass-border",
        "value": "rgba(255,255,255,0.25)",
        "use": "border of frosted glass panels"
      },
      {
        "name": "glass-shadow",
        "value": "0 8px 32px rgba(0,0,0,0.2)",
        "use": "shadow beneath glass panels"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Bungee",
        "fallback": "cursive",
        "weights": [
          400
        ]
      },
      {
        "role": "body",
        "family": "Nunito",
        "fallback": "sans-serif",
        "weights": [
          400,
          600,
          700
        ]
      }
    ],
    "type": [
      {
        "name": "hero",
        "size": "clamp(3.5rem, 8vw, 6rem)",
        "lineHeight": "1.05",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h1",
        "size": "clamp(2.5rem, 5vw, 4rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h2",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "h3",
        "size": "clamp(1.5rem, 2.5vw, 2rem)",
        "lineHeight": "1.3",
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
        "name": "section-padding",
        "value": "clamp(3rem, 8vw, 6rem)"
      },
      {
        "name": "card-padding",
        "value": "24px"
      }
    ],
    "radii": [
      {
        "name": "glass-radius",
        "value": "16px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "glass",
        "value": "background: rgba(255,255,255,0.12); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 8px 32px rgba(0,0,0,0.2);"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce festival name, dates, location, and primary call to action.",
      "layout": "Full viewport height, content centered, glass panel containing headline and CTA, max-width 800px",
      "copy": [
        {
          "role": "heading",
          "text": "Fork & Flame Weekend"
        },
        {
          "role": "subheading",
          "text": "Two days of flavor, fire, and community."
        },
        {
          "role": "body",
          "text": "June 14-15, 2025 · Downtown Portland"
        },
        {
          "role": "button",
          "text": "Get tickets"
        },
        {
          "role": "link",
          "text": "See lineup"
        }
      ]
    },
    {
      "id": "lineup-preview",
      "purpose": "Showcase a few featured vendors to entice visitors to view full lineup.",
      "layout": "Two-column grid on desktop, cards with glass background, max-width 1200px, centered",
      "copy": [
        {
          "role": "heading",
          "text": "Taste the lineup"
        },
        {
          "role": "body",
          "text": "Over 40 vendors serving street food, craft drinks, and dessert."
        },
        {
          "role": "card-title",
          "text": "Smoke & Ember BBQ"
        },
        {
          "role": "card-body",
          "text": "Slow-smoked brisket and maple bourbon glaze."
        },
        {
          "role": "card-title",
          "text": "Curry Up Now"
        },
        {
          "role": "card-body",
          "text": "Indian street food with a Pacific Northwest twist."
        },
        {
          "role": "card-title",
          "text": "Sweet & Glazed"
        },
        {
          "role": "card-body",
          "text": "Handcrafted doughnuts and seasonal fruit fillings."
        },
        {
          "role": "link",
          "text": "Full lineup"
        }
      ]
    },
    {
      "id": "schedule-preview",
      "purpose": "Highlight key events across the two days.",
      "layout": "Single column list with time and event details, max-width 800px, centered",
      "copy": [
        {
          "role": "heading",
          "text": "Two days of flavor"
        },
        {
          "role": "body",
          "text": "From live cooking demos to late-night bites."
        },
        {
          "role": "time",
          "text": "Sat 11:00 AM"
        },
        {
          "role": "event",
          "text": "Opening ceremony & chef welcome"
        },
        {
          "role": "time",
          "text": "Sat 2:00 PM"
        },
        {
          "role": "event",
          "text": "Live fire cooking demo"
        },
        {
          "role": "time",
          "text": "Sun 1:00 PM"
        },
        {
          "role": "event",
          "text": "Chili cook-off finals"
        },
        {
          "role": "link",
          "text": "Full schedule"
        }
      ]
    },
    {
      "id": "tickets-cta",
      "purpose": "Encourage ticket purchase with clear pricing and deadline.",
      "layout": "Centered glass panel with ticket options and button, max-width 600px",
      "copy": [
        {
          "role": "heading",
          "text": "Join the feast"
        },
        {
          "role": "body",
          "text": "Early bird tickets available until May 15."
        },
        {
          "role": "price",
          "text": "$45 weekend pass"
        },
        {
          "role": "button",
          "text": "Buy tickets"
        },
        {
          "role": "note",
          "text": "Kids under 12 free with adult"
        }
      ]
    },
    {
      "id": "directions-teaser",
      "purpose": "Provide basic location info and a link to detailed directions.",
      "layout": "Simple text block with address and map link, max-width 800px, centered",
      "copy": [
        {
          "role": "heading",
          "text": "Get there"
        },
        {
          "role": "body",
          "text": "Pioneer Courthouse Square, 701 SW 6th Ave, Portland, OR"
        },
        {
          "role": "link",
          "text": "Directions & parking"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "Hero text reduces to text-hero size",
        "lineup-preview becomes single column",
        "schedule-preview items stack with less padding",
        "tickets-cta panel width full"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "Nav collapses into mobile menu",
        "card padding reduces to 16px",
        "section padding reduces"
      ]
    }
  ],
  "motion": [
    {
      "element": "All glass panels",
      "trigger": "in view",
      "behaviour": "backdrop-filter blur from 0 to 20px, scale from 0.98 to 1, opacity from 0 to 1",
      "timing": "250ms ease-out"
    },
    {
      "element": "Hero heading text",
      "trigger": "load",
      "behaviour": "rise 16px and fade in with stagger",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "Buttons",
      "trigger": "hover",
      "behaviour": "scale 1.02",
      "timing": "200ms ease-out"
    },
    {
      "element": "Buttons",
      "trigger": "tap",
      "behaviour": "scale 0.97",
      "timing": "100ms ease-out"
    }
  ],
  "do": [
    "Use glass effect on panels over saturated background",
    "Keep text on glass panels dark (muted-foreground) for readability",
    "Use Bungee for display headings and Nunito for body",
    "Add backdrop-filter blur and scale materialization to panels on enter",
    "Ensure interactive elements have visible focus states"
  ],
  "avoid": [
    "Stacking two light translucent glass panels on top of each other",
    "Using raw hex colors in class names; always use CSS variables",
    "Allowing horizontal scroll on mobile",
    "Using emojis as icons; use lucide-react icons",
    "Placing color directly on translucent foreground; color belongs on the solid background layer"
  ],
  "checks": [
    "All glass panels have backdrop-filter blur and light border",
    "Main navigation links are visible and clickable on mobile",
    "Text on glass panels has sufficient contrast (at least 4.5:1)",
    "No horizontal scroll at 375px viewport width",
    "Hero headline stays on one line at 1440px"
  ]
}
---

# Design

Promote a weekend food festival, informing visitors about vendors, schedule, tickets, and location with a modern glassmorphism aesthetic.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| All glass panels | in view | backdrop-filter blur from 0 to 20px, scale from 0.98 to 1, opacity from 0 to 1 | 250ms ease-out |
| Hero heading text | load | rise 16px and fade in with stagger | spring stiffness 120 damping 20 |
| Buttons | hover | scale 1.02 | 200ms ease-out |
| Buttons | tap | scale 0.97 | 100ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use glass effect on panels over saturated background
- Keep text on glass panels dark (muted-foreground) for readability
- Use Bungee for display headings and Nunito for body
- Add backdrop-filter blur and scale materialization to panels on enter
- Ensure interactive elements have visible focus states

## Don't

- Stacking two light translucent glass panels on top of each other
- Using raw hex colors in class names; always use CSS variables
- Allowing horizontal scroll on mobile
- Using emojis as icons; use lucide-react icons
- Placing color directly on translucent foreground; color belongs on the solid background layer

## Checks

- All glass panels have backdrop-filter blur and light border
- Main navigation links are visible and clickable on mobile
- Text on glass panels has sufficient contrast (at least 4.5:1)
- No horizontal scroll at 375px viewport width
- Hero headline stays on one line at 1440px
