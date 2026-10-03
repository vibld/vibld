---
{
  "intent": "An acid-dark website for Electric Fork Festival, a weekend food event, giving visitors clear access to lineup, schedule, tickets, and directions.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#E8FF52",
        "use": "acid yellow-green accent for primary actions, highlights, and focus rings"
      },
      {
        "name": "primary-foreground",
        "value": "#0A0A0A",
        "use": "text and icons on primary-colored elements"
      },
      {
        "name": "secondary",
        "value": "#1A1A1A",
        "use": "background for secondary buttons and hover states"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "text on secondary elements"
      },
      {
        "name": "accent",
        "value": "#B9CC3F",
        "use": "muted accent for subtle highlights, not used as primary"
      },
      {
        "name": "accent-foreground",
        "value": "#0A0A0A",
        "use": "text on accent elements"
      },
      {
        "name": "background",
        "value": "#0A0A0A",
        "use": "main page background"
      },
      {
        "name": "foreground",
        "value": "#FFFFFF",
        "use": "primary text color"
      },
      {
        "name": "card",
        "value": "#121212",
        "use": "background for cards and elevated surfaces"
      },
      {
        "name": "card-foreground",
        "value": "#FFFFFF",
        "use": "text on cards"
      },
      {
        "name": "muted",
        "value": "#1F1F1F",
        "use": "subtle background for muted areas"
      },
      {
        "name": "muted-foreground",
        "value": "#9A9A9A",
        "use": "secondary text and labels"
      },
      {
        "name": "border",
        "value": "#2A2A2A",
        "use": "default border color"
      },
      {
        "name": "ring",
        "value": "#E8FF52",
        "use": "focus ring color"
      },
      {
        "name": "destructive",
        "value": "#FF5C5C",
        "use": "error states, destructive actions"
      },
      {
        "name": "destructive-foreground",
        "value": "#0A0A0A",
        "use": "text on destructive elements"
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
        "name": "hero",
        "size": "clamp(3.5rem, 10vw, 7rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "h1",
        "size": "clamp(2rem, 5vw, 3.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h2",
        "size": "clamp(1.5rem, 3vw, 2.25rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h3",
        "size": "1.25rem",
        "lineHeight": "1.3",
        "letterSpacing": "-0.01em"
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
        "value": "48px"
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
        "name": "glow",
        "value": "0 0 20px rgba(232,255,82,0.3)"
      },
      {
        "name": "card-shadow",
        "value": "0 4px 12px rgba(0,0,0,0.4)"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the festival name, dates, location, and primary call-to-action.",
      "layout": "Full viewport height, flex column, justify-center items-center text-center, max width 800px, gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "Electric Fork Festival"
        },
        {
          "role": "subheading",
          "text": "Bold flavors. Acid beats. Two days of food that bites back."
        },
        {
          "role": "meta",
          "text": "August 23-24 / Portland, OR"
        },
        {
          "role": "button",
          "text": "Get Tickets"
        },
        {
          "role": "secondary-button",
          "text": "See Lineup"
        },
        {
          "role": "note",
          "text": "Weekend pass from $85"
        }
      ]
    },
    {
      "id": "about",
      "purpose": "Brief description of the festival and its scale.",
      "layout": "Two columns on desktop (text left, placeholder image right), one column on mobile, max width 1200px, gap 48px.",
      "copy": [
        {
          "role": "heading",
          "text": "What is Electric Fork?"
        },
        {
          "role": "body",
          "text": "A weekend of experimental cuisine, live music, and local vendors pushing the boundaries of taste. 40 chefs, 20 stages, one electric atmosphere."
        }
      ]
    },
    {
      "id": "lineup-preview",
      "purpose": "Showcase three featured chefs with a link to the full lineup.",
      "layout": "Three equal cards in a row on desktop, stacked on mobile, max width 1200px, gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "Chefs to watch"
        },
        {
          "role": "card-name",
          "text": "Chef Maya Nguyen"
        },
        {
          "role": "card-style",
          "text": "Fermentation & fire"
        },
        {
          "role": "card-name",
          "text": "Chef Darius Cole"
        },
        {
          "role": "card-style",
          "text": "Molecular gastronomy"
        },
        {
          "role": "card-name",
          "text": "Chef Elena Rossi"
        },
        {
          "role": "card-style",
          "text": "Modern Italian"
        },
        {
          "role": "link",
          "text": "Full lineup"
        }
      ]
    },
    {
      "id": "schedule-preview",
      "purpose": "Highlight the two-day schedule with a link to the full schedule.",
      "layout": "Two columns for day summaries, max width 800px, gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "Weekend Schedule"
        },
        {
          "role": "day-label",
          "text": "Saturday"
        },
        {
          "role": "day-summary",
          "text": "Gates at 11 AM, music starts at noon"
        },
        {
          "role": "day-label",
          "text": "Sunday"
        },
        {
          "role": "day-summary",
          "text": "Brunch takeover, closing set at 8 PM"
        },
        {
          "role": "link",
          "text": "Full schedule"
        }
      ]
    },
    {
      "id": "tickets-cta",
      "purpose": "Encourage ticket purchase with pricing information and a call to action.",
      "layout": "Centered text, max width 600px, background card, padding 40px.",
      "copy": [
        {
          "role": "heading",
          "text": "Get your pass"
        },
        {
          "role": "body",
          "text": "Weekend and single-day passes. Early bird ends July 15."
        },
        {
          "role": "button",
          "text": "Buy Tickets"
        },
        {
          "role": "price",
          "text": "Weekend: $120, Single day: $65"
        }
      ]
    },
    {
      "id": "directions-preview",
      "purpose": "Provide address and a link to full directions page.",
      "layout": "Centered text, max width 600px.",
      "copy": [
        {
          "role": "heading",
          "text": "Getting there"
        },
        {
          "role": "address",
          "text": "Portland Expo Center, 2060 N Marine Dr, Portland, OR 97217"
        },
        {
          "role": "link",
          "text": "Directions"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 768,
      "changes": [
        "Nav collapses to mobile menu with hamburger",
        "Hero text size reduces",
        "Sections stack vertically",
        "Card grid becomes single column"
      ]
    },
    {
      "maxWidth": 375,
      "changes": [
        "Gutter padding reduces to 16px",
        "Button sizes increase to full width",
        "Headings use smaller clamp values"
      ]
    }
  ],
  "motion": [
    {
      "element": "Hero heading",
      "trigger": "load",
      "behaviour": "Rise 20px and fade in",
      "timing": "150ms ease-out"
    },
    {
      "element": "Primary button",
      "trigger": "hover",
      "behaviour": "Scale 1.02",
      "timing": "120ms ease-out"
    },
    {
      "element": "Primary button",
      "trigger": "press",
      "behaviour": "Scale 0.98",
      "timing": "120ms ease-out"
    },
    {
      "element": "Accent elements (on state change: dialog open, tab switch)",
      "trigger": "state change",
      "behaviour": "Pulse glow (opacity 1 to 0.8 to 1)",
      "timing": "180ms ease-out"
    },
    {
      "element": "Cards and sections",
      "trigger": "in view",
      "behaviour": "Fade in and rise 16px",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use --primary (#E8FF52) exclusively for interactive elements, key highlights, and focus rings",
    "Keep all other elements in grayscale using --background, --foreground, --muted, --border",
    "Apply Space Grotesk for all headings with tight letter-spacing (-0.02em to -0.04em)",
    "Use sharp corners (radius 4px) for buttons and cards to maintain a technical feel",
    "Respect reduced motion by disabling transforms and keeping opacity/color fades"
  ],
  "avoid": [
    "Introducing a second saturated color anywhere, as it would break the monochrome discipline",
    "Using large border-radius or soft shadows; stick to 4-6px radii and subtle dark shadows",
    "Animating elements longer than 180ms or using spring animations; keep transitions sharp and quick",
    "Using decorative icons or emojis; functional icons only from lucide-react",
    "Placing text directly on the primary color without adequate contrast; use --primary-foreground"
  ],
  "checks": [
    "The primary color #E8FF52 appears only on buttons, links, focus rings, and key text",
    "All interactive elements have a visible hover and focus state",
    "All animations complete within 180ms",
    "Body text is at least 16px with 1.6 line-height",
    "Mobile navigation opens and closes with a single tap and is keyboard accessible",
    "Reduced motion users see no transforms, only opacity/color changes"
  ]
}
---

# Design

An acid-dark website for Electric Fork Festival, a weekend food event, giving visitors clear access to lineup, schedule, tickets, and directions.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Hero heading | load | Rise 20px and fade in | 150ms ease-out |
| Primary button | hover | Scale 1.02 | 120ms ease-out |
| Primary button | press | Scale 0.98 | 120ms ease-out |
| Accent elements (on state change: dialog open, tab switch) | state change | Pulse glow (opacity 1 to 0.8 to 1) | 180ms ease-out |
| Cards and sections | in view | Fade in and rise 16px | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use --primary (#E8FF52) exclusively for interactive elements, key highlights, and focus rings
- Keep all other elements in grayscale using --background, --foreground, --muted, --border
- Apply Space Grotesk for all headings with tight letter-spacing (-0.02em to -0.04em)
- Use sharp corners (radius 4px) for buttons and cards to maintain a technical feel
- Respect reduced motion by disabling transforms and keeping opacity/color fades

## Don't

- Introducing a second saturated color anywhere, as it would break the monochrome discipline
- Using large border-radius or soft shadows; stick to 4-6px radii and subtle dark shadows
- Animating elements longer than 180ms or using spring animations; keep transitions sharp and quick
- Using decorative icons or emojis; functional icons only from lucide-react
- Placing text directly on the primary color without adequate contrast; use --primary-foreground

## Checks

- The primary color #E8FF52 appears only on buttons, links, focus rings, and key text
- All interactive elements have a visible hover and focus state
- All animations complete within 180ms
- Body text is at least 16px with 1.6 line-height
- Mobile navigation opens and closes with a single tap and is keyboard accessible
- Reduced motion users see no transforms, only opacity/color changes
