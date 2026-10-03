---
{
  "intent": "A literary, warm single-page site for a weekend food festival, for attendees planning their visit, with the job of presenting the lineup, schedule, tickets and directions in one calm scroll.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#B5533A",
        "use": "terracotta accent for primary buttons, links and key highlights"
      },
      {
        "name": "primary-foreground",
        "value": "#FFFFFF",
        "use": "text on primary"
      },
      {
        "name": "secondary",
        "value": "#E8E0D5",
        "use": "soft sand for secondary surfaces and hover states"
      },
      {
        "name": "secondary-foreground",
        "value": "#2A2825",
        "use": "text on secondary"
      },
      {
        "name": "accent",
        "value": "#2F6F62",
        "use": "green only for success or status indicators, not decorative"
      },
      {
        "name": "accent-foreground",
        "value": "#FFFFFF",
        "use": "text on accent"
      },
      {
        "name": "background",
        "value": "#FAF8F3",
        "use": "warm bone page background, never pure white"
      },
      {
        "name": "foreground",
        "value": "#1F1E1C",
        "use": "near-black warm text"
      },
      {
        "name": "card",
        "value": "#FFFFFF",
        "use": "white cards lifted off the page"
      },
      {
        "name": "card-foreground",
        "value": "#1F1E1C",
        "use": "text on cards"
      },
      {
        "name": "muted",
        "value": "#EFEAE1",
        "use": "muted section backgrounds and disabled states"
      },
      {
        "name": "muted-foreground",
        "value": "#5C5850",
        "use": "secondary text, intros and meta information"
      },
      {
        "name": "border",
        "value": "#DED7CA",
        "use": "hairline borders"
      },
      {
        "name": "ring",
        "value": "#B5533A",
        "use": "focus rings"
      },
      {
        "name": "destructive",
        "value": "#A63328",
        "use": "errors and destructive actions"
      },
      {
        "name": "destructive-foreground",
        "value": "#FFFFFF",
        "use": "text on destructive"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "Georgia, serif",
        "weights": [
          500,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "Source Sans 3",
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
        "size": "clamp(3.5rem, 8vw, 6.5rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "display",
        "size": "clamp(2.5rem, 5vw, 4rem)",
        "lineHeight": "1.05",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "title",
        "size": "2rem",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "heading",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "body",
        "size": "1.125rem",
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
        "name": "label",
        "size": "0.75rem",
        "lineHeight": "1.4",
        "letterSpacing": "0.08em"
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
        "name": "section-y-lg",
        "value": "120px"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "6px"
      },
      {
        "name": "md",
        "value": "10px"
      },
      {
        "name": "lg",
        "value": "16px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "card-shadow",
        "value": "0 1px 2px rgba(31,30,28,.04), 0 8px 24px rgba(31,30,28,.06)"
      },
      {
        "name": "soft-shadow",
        "value": "0 2px 8px rgba(31,30,28,.05)"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "Site header with logo, anchor navigation to page sections, and a primary tickets CTA.",
      "layout": "Full width, max 1200px centered, padding 24px 24px, flex row space-between. Logo left, nav links center (hidden below 768px), tickets button right.",
      "copy": [
        {
          "role": "logo",
          "text": "Ember Table"
        },
        {
          "role": "link",
          "text": "Lineup"
        },
        {
          "role": "link",
          "text": "Schedule"
        },
        {
          "role": "link",
          "text": "Tickets"
        },
        {
          "role": "link",
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
      "purpose": "Introduce the festival with its name, date, location and a short poetic line; primary actions to view lineup and get tickets.",
      "layout": "Full width, max 1200px centered, padding 80px 24px 96px; left-aligned text with max width 640px; decorative element to the right on large screens (optional, non-interactive).",
      "copy": [
        {
          "role": "eyebrow",
          "text": "October 18–19, 2025 · Riverside Park"
        },
        {
          "role": "heading",
          "text": "A weekend for slow food and long tables."
        },
        {
          "role": "body",
          "text": "Forty cooks, two days, one riverside lawn. The Ember Table Festival gathers the region's best kitchens for a weekend of fire, fermentation and shared plates."
        },
        {
          "role": "button",
          "text": "View lineup"
        },
        {
          "role": "button",
          "text": "Get tickets"
        }
      ]
    },
    {
      "id": "lineup",
      "purpose": "Show the chef and vendor lineup as a grid of cards, each with a name, cuisine and signature dish.",
      "layout": "Max 1200px centered, padding 96px 24px; section heading and intro; grid of 6 cards, single column mobile, 2 columns at 640, 3 columns at 1024; cards are white with shadow.",
      "copy": [
        {
          "role": "heading",
          "text": "The lineup"
        },
        {
          "role": "body",
          "text": "Chefs and makers from across the valley, each with one dish that tells a story."
        },
        {
          "role": "heading",
          "text": "Mama Rosa's Arepas"
        },
        {
          "role": "body",
          "text": "Colombian street food"
        },
        {
          "role": "body",
          "text": "Arepas stuffed with slow-braised beef and queso fresco."
        },
        {
          "role": "heading",
          "text": "The Salted Pig"
        },
        {
          "role": "body",
          "text": "Whole-animal butchery"
        },
        {
          "role": "body",
          "text": "Porchetta with salsa verde and charred lemon."
        },
        {
          "role": "heading",
          "text": "Butter & Bloom Bakery"
        },
        {
          "role": "body",
          "text": "Naturally leavened breads"
        },
        {
          "role": "body",
          "text": "Sourdough with brown butter and wildflower honey."
        },
        {
          "role": "heading",
          "text": "Uncle Bun's Dumplings"
        },
        {
          "role": "body",
          "text": "Hand-pleated dumplings"
        },
        {
          "role": "body",
          "text": "Pork and chive dumplings with black vinegar."
        },
        {
          "role": "heading",
          "text": "Fern & Ember"
        },
        {
          "role": "body",
          "text": "Wood-fired vegetables"
        },
        {
          "role": "body",
          "text": "Smoked carrots with tahini and dukkah."
        },
        {
          "role": "heading",
          "text": "Little River Oysters"
        },
        {
          "role": "body",
          "text": "Tide-to-table shellfish"
        },
        {
          "role": "body",
          "text": "Shucked oysters with cucumber mignonette."
        }
      ]
    },
    {
      "id": "schedule",
      "purpose": "Present the two-day schedule in two columns, each with time-stamped events.",
      "layout": "Max 1200px centered, padding 96px 24px; section heading and intro; two columns (Saturday and Sunday) side by side from 768px, stacked on mobile; each column a list of time and event.",
      "copy": [
        {
          "role": "heading",
          "text": "Schedule"
        },
        {
          "role": "body",
          "text": "Two days, three stages, and a long table that never empties."
        },
        {
          "role": "heading",
          "text": "Saturday, October 18"
        },
        {
          "role": "label",
          "text": "11:00"
        },
        {
          "role": "body",
          "text": "Gates open, coffee and pastries at the bakery tent."
        },
        {
          "role": "label",
          "text": "12:30"
        },
        {
          "role": "body",
          "text": "Fire stage: whole lamb roasted over oak, with chef Alma Ruiz."
        },
        {
          "role": "label",
          "text": "14:00"
        },
        {
          "role": "body",
          "text": "Fermentation workshop: kraut, kimchi and kombucha with The Brinery."
        },
        {
          "role": "label",
          "text": "16:00"
        },
        {
          "role": "body",
          "text": "Long table dinner: a shared four-course menu from six kitchens."
        },
        {
          "role": "label",
          "text": "19:00"
        },
        {
          "role": "body",
          "text": "Live music from the Riverside String Band."
        },
        {
          "role": "heading",
          "text": "Sunday, October 19"
        },
        {
          "role": "label",
          "text": "10:00"
        },
        {
          "role": "body",
          "text": "Morning market: preserves, bread and flowers."
        },
        {
          "role": "label",
          "text": "11:30"
        },
        {
          "role": "body",
          "text": "Dumpling masterclass with Uncle Bun."
        },
        {
          "role": "label",
          "text": "13:00"
        },
        {
          "role": "body",
          "text": "Oak-grilled fish demo with Little River Oysters."
        },
        {
          "role": "label",
          "text": "15:00"
        },
        {
          "role": "body",
          "text": "Pie competition and judging."
        },
        {
          "role": "label",
          "text": "17:00"
        },
        {
          "role": "body",
          "text": "Closing feast and bonfire."
        }
      ]
    },
    {
      "id": "tickets",
      "purpose": "Show ticket tiers with prices and a note that this is a demonstration; each select button opens a dialog explaining no payment is collected.",
      "layout": "Max 1200px centered, padding 96px 24px; section heading, intro note, three ticket cards in a row from 1024px, stacked on mobile; each card has a Select button.",
      "copy": [
        {
          "role": "heading",
          "text": "Tickets"
        },
        {
          "role": "body",
          "text": "Buy a day pass or the whole weekend. All tickets are a demonstration; no payment is taken."
        },
        {
          "role": "heading",
          "text": "Day pass"
        },
        {
          "role": "body",
          "text": "Entry for one day, all demos and workshops, and a tasting token."
        },
        {
          "role": "label",
          "text": "$45"
        },
        {
          "role": "button",
          "text": "Select"
        },
        {
          "role": "heading",
          "text": "Weekend pass"
        },
        {
          "role": "body",
          "text": "Both days, the long table dinner, and a festival tote."
        },
        {
          "role": "label",
          "text": "$85"
        },
        {
          "role": "button",
          "text": "Select"
        },
        {
          "role": "heading",
          "text": "Fire table seat"
        },
        {
          "role": "body",
          "text": "Reserved seat at the long table dinner plus weekend entry."
        },
        {
          "role": "label",
          "text": "$120"
        },
        {
          "role": "button",
          "text": "Select"
        },
        {
          "role": "dialog-title",
          "text": "Tickets are a demonstration"
        },
        {
          "role": "dialog-body",
          "text": "No payment is collected and no tickets are issued. This site shows how the festival would sell entry."
        },
        {
          "role": "dialog-button",
          "text": "Close"
        }
      ]
    },
    {
      "id": "directions",
      "purpose": "Give the festival address and clear travel options by train, car and bike.",
      "layout": "Max 1200px centered, padding 96px 24px; section heading; an address card and three transport rows; single column on mobile, two columns at 768px (address left, transport right).",
      "copy": [
        {
          "role": "heading",
          "text": "Directions"
        },
        {
          "role": "label",
          "text": "Address"
        },
        {
          "role": "body",
          "text": "Riverside Park, 1200 River Road, Millerton, NY 12546"
        },
        {
          "role": "heading",
          "text": "By train"
        },
        {
          "role": "body",
          "text": "Metro-North to Wassaic, then the free festival shuttle runs every 20 minutes from 9am to 11pm."
        },
        {
          "role": "heading",
          "text": "By car"
        },
        {
          "role": "body",
          "text": "Route 22 to River Road; parking is at the north meadow, a 10-minute walk from the gate."
        },
        {
          "role": "heading",
          "text": "By bike"
        },
        {
          "role": "body",
          "text": "The Hudson Valley Rail Trail ends at the park entrance; bike racks are inside the gate."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Close the page with a repeat of navigation, contact email and copyright.",
      "layout": "Full width, max 1200px centered, padding 48px 24px; border-top; flex column on mobile, row space-between on 768px.",
      "copy": [
        {
          "role": "logo",
          "text": "Ember Table"
        },
        {
          "role": "body",
          "text": "A weekend for slow food and long tables."
        },
        {
          "role": "link",
          "text": "Lineup"
        },
        {
          "role": "link",
          "text": "Schedule"
        },
        {
          "role": "link",
          "text": "Tickets"
        },
        {
          "role": "link",
          "text": "Directions"
        },
        {
          "role": "body",
          "text": "hello@embertable.example"
        },
        {
          "role": "body",
          "text": "© 2025 The Ember Table Festival"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 639,
      "changes": [
        "Header shows only logo and tickets button; nav links hidden",
        "Hero text full width, no decorative element",
        "Lineup cards single column",
        "Schedule days stacked",
        "Ticket cards single column",
        "Directions single column",
        "Padding 24px"
      ]
    },
    {
      "maxWidth": 767,
      "changes": [
        "Lineup cards two columns",
        "Section padding 48px",
        "Footer stacks"
      ]
    },
    {
      "maxWidth": 1023,
      "changes": [
        "Nav links visible",
        "Hero text max-width 560px",
        "Schedule days side by side",
        "Ticket cards two columns",
        "Directions two columns",
        "Section padding 96px"
      ]
    },
    {
      "maxWidth": 1279,
      "changes": [
        "Hero split with decorative element on right",
        "Lineup cards three columns",
        "Ticket cards three columns",
        "Max width 1100px"
      ]
    },
    {
      "maxWidth": 9999,
      "changes": [
        "Max width 1200px",
        "Hero heading size at clamp maximum"
      ]
    }
  ],
  "motion": [
    {
      "element": "Header",
      "trigger": "load",
      "behaviour": "Fade in from opacity 0",
      "timing": "300ms ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "Hero heading, subheading, buttons",
      "trigger": "load",
      "behaviour": "Rise 16px and fade in, stagger 80ms between items",
      "timing": "320ms ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "Hero decorative element",
      "trigger": "load",
      "behaviour": "Fade in",
      "timing": "400ms ease-out after 200ms delay"
    },
    {
      "element": "Section headings and intros",
      "trigger": "in view",
      "behaviour": "Rise 24px and fade in",
      "timing": "320ms ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "Lineup cards",
      "trigger": "in view",
      "behaviour": "Rise 16px and fade in, stagger 100ms",
      "timing": "320ms ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "Ticket cards",
      "trigger": "in view",
      "behaviour": "Rise 16px and fade in, stagger 100ms",
      "timing": "320ms ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "Buttons",
      "trigger": "hover",
      "behaviour": "Lift 1px and shadow increase",
      "timing": "200ms ease-out"
    },
    {
      "element": "Buttons",
      "trigger": "press",
      "behaviour": "Scale to 0.98",
      "timing": "100ms ease-out"
    },
    {
      "element": "Ticket dialog",
      "trigger": "open",
      "behaviour": "Fade and scale from 0.95 opacity 0",
      "timing": "200ms ease-out"
    }
  ],
  "do": [
    "Use warm bone background #FAF8F3 as the page color; white is only for cards",
    "Use terracotta #B5533A only for primary CTAs and key accents",
    "Use Fraunces for all headings and display text",
    "Use 24px gutter on mobile, scaling up to 48px and 96px section padding",
    "Keep motion opacity-led with 250-350ms durations and ease-out cubic-bezier(0.23,1,0.32,1)"
  ],
  "avoid": [
    "Do not use pure white as the page background; it would flatten the warm paper feel",
    "Do not animate with bounce or spring overshoot; the material is paper, not rubber",
    "Do not use the green accent color decoratively; it would dilute the terracotta's meaning",
    "Do not use bold or emoji as heading decoration; the serif and whitespace carry it",
    "Do not allow horizontal scrolling at any breakpoint"
  ],
  "checks": [
    "Page background is #FAF8F3, not white",
    "Primary buttons are #B5533A",
    "Headings use Fraunces",
    "Ticket section says it is a demonstration",
    "At 375px viewport, no horizontal scroll and body text is at least 16px",
    "Nav links appear at 768px and above",
    "Animations honor prefers-reduced-motion"
  ]
}
---

# Design

A literary, warm single-page site for a weekend food festival, for attendees planning their visit, with the job of presenting the lineup, schedule, tickets and directions in one calm scroll.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Header | load | Fade in from opacity 0 | 300ms ease-out cubic-bezier(0.23,1,0.32,1) |
| Hero heading, subheading, buttons | load | Rise 16px and fade in, stagger 80ms between items | 320ms ease-out cubic-bezier(0.23,1,0.32,1) |
| Hero decorative element | load | Fade in | 400ms ease-out after 200ms delay |
| Section headings and intros | in view | Rise 24px and fade in | 320ms ease-out cubic-bezier(0.23,1,0.32,1) |
| Lineup cards | in view | Rise 16px and fade in, stagger 100ms | 320ms ease-out cubic-bezier(0.23,1,0.32,1) |
| Ticket cards | in view | Rise 16px and fade in, stagger 100ms | 320ms ease-out cubic-bezier(0.23,1,0.32,1) |
| Buttons | hover | Lift 1px and shadow increase | 200ms ease-out |
| Buttons | press | Scale to 0.98 | 100ms ease-out |
| Ticket dialog | open | Fade and scale from 0.95 opacity 0 | 200ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use warm bone background #FAF8F3 as the page color; white is only for cards
- Use terracotta #B5533A only for primary CTAs and key accents
- Use Fraunces for all headings and display text
- Use 24px gutter on mobile, scaling up to 48px and 96px section padding
- Keep motion opacity-led with 250-350ms durations and ease-out cubic-bezier(0.23,1,0.32,1)

## Don't

- Do not use pure white as the page background; it would flatten the warm paper feel
- Do not animate with bounce or spring overshoot; the material is paper, not rubber
- Do not use the green accent color decoratively; it would dilute the terracotta's meaning
- Do not use bold or emoji as heading decoration; the serif and whitespace carry it
- Do not allow horizontal scrolling at any breakpoint

## Checks

- Page background is #FAF8F3, not white
- Primary buttons are #B5533A
- Headings use Fraunces
- Ticket section says it is a demonstration
- At 375px viewport, no horizontal scroll and body text is at least 16px
- Nav links appear at 768px and above
- Animations honor prefers-reduced-motion
