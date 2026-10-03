---
{
  "intent": "A minimal one-page site for the Long Table Food Festival, aimed at visitors planning a weekend, that presents the lineup, schedule, tickets and directions with quiet typographic clarity.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#FAFAF7",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1C1C1A",
        "use": "primary text"
      },
      {
        "name": "muted",
        "value": "#F3F1EC",
        "use": "subtle background for alternating rows or hover"
      },
      {
        "name": "muted-foreground",
        "value": "#6B6B66",
        "use": "secondary text, captions, timestamps"
      },
      {
        "name": "accent",
        "value": "#9A3412",
        "use": "links, buttons, focus ring, one accent"
      },
      {
        "name": "accent-foreground",
        "value": "#FFFFFF",
        "use": "text on accent background"
      },
      {
        "name": "border",
        "value": "#E5E5DF",
        "use": "hairline rules between rows and sections"
      },
      {
        "name": "ring",
        "value": "#9A3412",
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
          500,
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
        "size": "clamp(3.5rem, 8vw, 6.5rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h1",
        "size": "clamp(2.25rem, 5vw, 3.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "h2",
        "size": "clamp(1.75rem, 4vw, 2.25rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "h3",
        "size": "1.25rem",
        "lineHeight": "1.35",
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
      },
      {
        "name": "button",
        "size": "0.875rem",
        "lineHeight": "1.2",
        "letterSpacing": "0.05em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "section",
        "value": "96px"
      },
      {
        "name": "section-mobile",
        "value": "64px"
      },
      {
        "name": "container",
        "value": "1200px"
      }
    ],
    "radii": [
      {
        "name": "none",
        "value": "0px"
      },
      {
        "name": "focus",
        "value": "2px"
      }
    ],
    "effects": [
      {
        "name": "ring",
        "value": "0 0 0 2px var(--ring)"
      }
    ]
  },
  "sections": [
    {
      "id": "site-header",
      "purpose": "Persistent navigation with logo, anchor links to sections and a primary call to action.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 16px, flex row space-between on desktop, flex-col items-center gap-4 on mobile.",
      "copy": [
        {
          "role": "logo",
          "text": "The Long Table"
        },
        {
          "role": "nav link",
          "text": "Lineup"
        },
        {
          "role": "nav link",
          "text": "Schedule"
        },
        {
          "role": "nav link",
          "text": "Tickets"
        },
        {
          "role": "nav link",
          "text": "Directions"
        },
        {
          "role": "button",
          "text": "Get tickets"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "Introduce the festival, date, location and primary actions.",
      "layout": "max-width 720px, text left-aligned, padding-block 96px desktop and 64px mobile, padding-inline 24px mobile and 48px desktop.",
      "copy": [
        {
          "role": "eyebrow",
          "text": "June 7 and 8, 2025, Millbrook Park"
        },
        {
          "role": "heading",
          "text": "A weekend of food, fire and community"
        },
        {
          "role": "body",
          "text": "Thirty cooks, two stages, one long table under the trees. Join us for a weekend of tasting plates, live fire cooking and conversations about where our food comes from."
        },
        {
          "role": "button",
          "text": "Get tickets"
        },
        {
          "role": "link",
          "text": "See the lineup"
        }
      ]
    },
    {
      "id": "lineup",
      "purpose": "List the participating cooks and their dishes.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 96px desktop and 64px mobile; vendor rows separated by 1px border; one column mobile, two columns from md with gap-x 48px.",
      "copy": [
        {
          "role": "kicker",
          "text": "The cooks"
        },
        {
          "role": "heading",
          "text": "Lineup"
        },
        {
          "role": "body",
          "text": "Sample dishes from thirty independent cooks and small-batch producers across five regions."
        },
        {
          "role": "vendor name",
          "text": "Smoke & Thyme"
        },
        {
          "role": "vendor description",
          "text": "Live fire lamb, charred eggplant, and herb salad"
        },
        {
          "role": "vendor name",
          "text": "The Dumpling Cart"
        },
        {
          "role": "vendor description",
          "text": "Hand-folded pork and chive dumplings with black vinegar"
        },
        {
          "role": "vendor name",
          "text": "Arepa Linda"
        },
        {
          "role": "vendor description",
          "text": "Griddled corn arepas with slow-cooked beef and queso fresco"
        },
        {
          "role": "vendor name",
          "text": "Second Breakfast"
        },
        {
          "role": "vendor description",
          "text": "Wood-fired sourdough, cultured butter, and seasonal preserves"
        },
        {
          "role": "vendor name",
          "text": "Nightshade"
        },
        {
          "role": "vendor description",
          "text": "Charred tomato and pepper stew with smoked paprika"
        },
        {
          "role": "vendor name",
          "text": "The Oyster Shed"
        },
        {
          "role": "vendor description",
          "text": "Raw and grilled oysters with mignonette and brown butter"
        },
        {
          "role": "vendor name",
          "text": "Field & Fire"
        },
        {
          "role": "vendor description",
          "text": "Whole roasted vegetables, whipped ricotta, and salsa verde"
        },
        {
          "role": "vendor name",
          "text": "Little Fox Bakery"
        },
        {
          "role": "vendor description",
          "text": "Canelés, financiers, and a rotating fruit tart"
        }
      ]
    },
    {
      "id": "schedule",
      "purpose": "Show the two-day program with times and activities.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 96px desktop and 64px mobile; one column mobile, two columns from md for Saturday and Sunday with gap 64px; each time row separated by 1px border.",
      "copy": [
        {
          "role": "kicker",
          "text": "Two days"
        },
        {
          "role": "heading",
          "text": "Schedule"
        },
        {
          "role": "body",
          "text": "Gates open at 11:00 both days. Last pour at 21:00."
        },
        {
          "role": "day heading",
          "text": "Saturday, June 7"
        },
        {
          "role": "time",
          "text": "11:00"
        },
        {
          "role": "activity",
          "text": "Gates open, coffee service starts"
        },
        {
          "role": "time",
          "text": "12:00"
        },
        {
          "role": "activity",
          "text": "First fire: whole lamb on the spit"
        },
        {
          "role": "time",
          "text": "14:00"
        },
        {
          "role": "activity",
          "text": "Dumpling workshop"
        },
        {
          "role": "time",
          "text": "16:00"
        },
        {
          "role": "activity",
          "text": "Oyster shucking demo"
        },
        {
          "role": "time",
          "text": "18:00"
        },
        {
          "role": "activity",
          "text": "Long table dinner, ticketed"
        },
        {
          "role": "time",
          "text": "21:00"
        },
        {
          "role": "activity",
          "text": "Last pour"
        },
        {
          "role": "day heading",
          "text": "Sunday, June 8"
        },
        {
          "role": "time",
          "text": "11:00"
        },
        {
          "role": "activity",
          "text": "Gates open, coffee service starts"
        },
        {
          "role": "time",
          "text": "12:00"
        },
        {
          "role": "activity",
          "text": "Sourdough masterclass"
        },
        {
          "role": "time",
          "text": "14:00"
        },
        {
          "role": "activity",
          "text": "Pepper tasting"
        },
        {
          "role": "time",
          "text": "16:00"
        },
        {
          "role": "activity",
          "text": "Pie contest"
        },
        {
          "role": "time",
          "text": "18:00"
        },
        {
          "role": "activity",
          "text": "Fire feast, ticketed"
        },
        {
          "role": "time",
          "text": "21:00"
        },
        {
          "role": "activity",
          "text": "Last pour"
        }
      ]
    },
    {
      "id": "tickets",
      "purpose": "Present ticket tiers, prices and availability.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 96px desktop and 64px mobile; tiers stacked vertically with 1px border between rows, no cards.",
      "copy": [
        {
          "role": "kicker",
          "text": "Entry"
        },
        {
          "role": "heading",
          "text": "Tickets"
        },
        {
          "role": "body",
          "text": "Buy online until June 6, or at the gate if any remain."
        },
        {
          "role": "tier name",
          "text": "Day pass"
        },
        {
          "role": "price",
          "text": "$45"
        },
        {
          "role": "tier description",
          "text": "Entry for one day, all demos, one tasting token."
        },
        {
          "role": "tier name",
          "text": "Weekend pass"
        },
        {
          "role": "price",
          "text": "$80"
        },
        {
          "role": "tier description",
          "text": "Entry both days, all demos, two tasting tokens, long table waitlist priority."
        },
        {
          "role": "tier name",
          "text": "Long table dinner"
        },
        {
          "role": "price",
          "text": "$120"
        },
        {
          "role": "tier description",
          "text": "Saturday or Sunday evening seat at the shared table, five courses, paired pours."
        },
        {
          "role": "note",
          "text": "Children under 12 enter free with an adult."
        }
      ]
    },
    {
      "id": "directions",
      "purpose": "Tell visitors how to reach the venue by transit, car and bike.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 96px desktop and 64px mobile; one column mobile, two columns from md with address and transit left, parking right, gap 64px.",
      "copy": [
        {
          "role": "kicker",
          "text": "Getting here"
        },
        {
          "role": "heading",
          "text": "Directions"
        },
        {
          "role": "address",
          "text": "Millbrook Park, 1200 Lakeside Drive, Millbrook"
        },
        {
          "role": "transit",
          "text": "Bus 14 and 22 stop at Lakeside Drive and Park Gate. The park is a 10 minute walk from Millbrook Station."
        },
        {
          "role": "parking",
          "text": "Free parking in the west lot. Bike racks at both gates. Accessible drop-off at the main entrance."
        }
      ]
    },
    {
      "id": "site-footer",
      "purpose": "Close the page with festival identity, contact and copyright.",
      "layout": "max-width 1200px, padding-inline 24px mobile and 48px desktop, padding-block 48px, flex-col gap-16, text left.",
      "copy": [
        {
          "role": "logo",
          "text": "The Long Table Food Festival"
        },
        {
          "role": "body",
          "text": "June 7 and 8, 2025"
        },
        {
          "role": "body",
          "text": "Millbrook Park, 1200 Lakeside Drive"
        },
        {
          "role": "link",
          "text": "hello@longtablefest.com"
        },
        {
          "role": "copyright",
          "text": "© 2025 The Long Table Food Festival"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 639,
      "changes": [
        "Header becomes flex-col items-center gap-4; nav links wrap centered; CTA becomes full width.",
        "Hero padding-block 64px, padding-inline 24px.",
        "Lineup, schedule, tickets and directions remain single column with padding-block 64px.",
        "Footer padding-block 48px, items stack with gap 16px."
      ]
    },
    {
      "maxWidth": 767,
      "changes": [
        "Header becomes flex-row space-between; nav links visible in row with gap 32px.",
        "Hero padding-block 96px, padding-inline 48px.",
        "Section padding-block 96px."
      ]
    },
    {
      "maxWidth": 1023,
      "changes": [
        "Lineup becomes two-column grid with gap-x 48px; vendor rows keep bottom hairline.",
        "Schedule becomes two-column grid for Saturday and Sunday with gap 64px.",
        "Directions becomes two-column grid with address and transit left, parking right."
      ]
    },
    {
      "maxWidth": 1279,
      "changes": [
        "All sections and header/footer use max-width 1200px with margin-inline auto and padding-inline 48px."
      ]
    }
  ],
  "motion": [
    {
      "element": "Hero section container",
      "trigger": "load",
      "behaviour": "opacity 0 to 1",
      "timing": "150ms ease-out; reduced motion: opacity 1 without transition"
    },
    {
      "element": "Lineup section container",
      "trigger": "in view once",
      "behaviour": "opacity 0 to 1",
      "timing": "150ms ease-out; reduced motion: opacity 1 without transition"
    },
    {
      "element": "Schedule section container",
      "trigger": "in view once",
      "behaviour": "opacity 0 to 1",
      "timing": "150ms ease-out; reduced motion: opacity 1 without transition"
    },
    {
      "element": "Tickets section container",
      "trigger": "in view once",
      "behaviour": "opacity 0 to 1",
      "timing": "150ms ease-out; reduced motion: opacity 1 without transition"
    },
    {
      "element": "Directions section container",
      "trigger": "in view once",
      "behaviour": "opacity 0 to 1",
      "timing": "150ms ease-out; reduced motion: opacity 1 without transition"
    },
    {
      "element": "Header and footer links and buttons",
      "trigger": "hover",
      "behaviour": "opacity 1 to 0.85",
      "timing": "150ms ease-out; reduced motion: opacity stays 1"
    }
  ],
  "do": [
    "Use only tokens background, foreground, muted, muted-foreground, accent, accent-foreground, border and ring.",
    "Keep section padding 96px desktop and 64px mobile.",
    "Set display type with text-display, line-height 0.95, letter-spacing -0.03em.",
    "Use 1px hairline borders only to separate rows and sections.",
    "Animate opacity only, 150ms ease-out, no transforms and no stagger."
  ],
  "avoid": [
    "Do not add a second accent color, shadows, gradients or images: the design is typographic and quiet.",
    "Do not center hero text or content: left alignment keeps the minimal grid.",
    "Do not use transforms or stagger in motion: opacity only and one fade per section.",
    "Do not add decorative icons or illustrations: every mark carries meaning, focus ring and hairline.",
    "Do not add more than one border between content rows: too many rules add noise."
  ],
  "checks": [
    "Every text color pair has at least 4.5:1 contrast ratio.",
    "Page has no horizontal scroll at 375px and 1440px.",
    "Interactive elements show a visible focus ring on keyboard Tab.",
    "Motion animations only change opacity and last 150ms or less.",
    "Navigation links from the header jump to each section without page reload."
  ]
}
---

# Design

A minimal one-page site for the Long Table Food Festival, aimed at visitors planning a weekend, that presents the lineup, schedule, tickets and directions with quiet typographic clarity.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Hero section container | load | opacity 0 to 1 | 150ms ease-out; reduced motion: opacity 1 without transition |
| Lineup section container | in view once | opacity 0 to 1 | 150ms ease-out; reduced motion: opacity 1 without transition |
| Schedule section container | in view once | opacity 0 to 1 | 150ms ease-out; reduced motion: opacity 1 without transition |
| Tickets section container | in view once | opacity 0 to 1 | 150ms ease-out; reduced motion: opacity 1 without transition |
| Directions section container | in view once | opacity 0 to 1 | 150ms ease-out; reduced motion: opacity 1 without transition |
| Header and footer links and buttons | hover | opacity 1 to 0.85 | 150ms ease-out; reduced motion: opacity stays 1 |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use only tokens background, foreground, muted, muted-foreground, accent, accent-foreground, border and ring.
- Keep section padding 96px desktop and 64px mobile.
- Set display type with text-display, line-height 0.95, letter-spacing -0.03em.
- Use 1px hairline borders only to separate rows and sections.
- Animate opacity only, 150ms ease-out, no transforms and no stagger.

## Don't

- Do not add a second accent color, shadows, gradients or images: the design is typographic and quiet.
- Do not center hero text or content: left alignment keeps the minimal grid.
- Do not use transforms or stagger in motion: opacity only and one fade per section.
- Do not add decorative icons or illustrations: every mark carries meaning, focus ring and hairline.
- Do not add more than one border between content rows: too many rules add noise.

## Checks

- Every text color pair has at least 4.5:1 contrast ratio.
- Page has no horizontal scroll at 375px and 1440px.
- Interactive elements show a visible focus ring on keyboard Tab.
- Motion animations only change opacity and last 150ms or less.
- Navigation links from the header jump to each section without page reload.
