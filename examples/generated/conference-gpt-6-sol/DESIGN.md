---
{
  "intent": "Present a two-day developer conference to prospective attendees and invite them to request program updates through a demo form.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#FFFFFF",
        "use": "Primary text and form submit surface"
      },
      {
        "name": "primary-foreground",
        "value": "#07121C",
        "use": "Text and icon on the primary surface"
      },
      {
        "name": "secondary",
        "value": "#0E2230",
        "use": "Secondary surfaces"
      },
      {
        "name": "secondary-foreground",
        "value": "#E6EEF2",
        "use": "Text on secondary surfaces"
      },
      {
        "name": "accent",
        "value": "#9FC3D6",
        "use": "Eyebrows, speaker numbers, and focus-adjacent detail"
      },
      {
        "name": "accent-foreground",
        "value": "#07121C",
        "use": "Text on accent surfaces"
      },
      {
        "name": "background",
        "value": "#07121C",
        "use": "Page and hero base"
      },
      {
        "name": "foreground",
        "value": "#FFFFFF",
        "use": "Headings and main text"
      },
      {
        "name": "card",
        "value": "#0B1A26",
        "use": "Reserved dark surface token"
      },
      {
        "name": "card-foreground",
        "value": "#E6EEF2",
        "use": "Text on the reserved card surface"
      },
      {
        "name": "muted",
        "value": "#0E2230",
        "use": "Muted surface token"
      },
      {
        "name": "muted-foreground",
        "value": "#C8D4DB",
        "use": "Supporting text"
      },
      {
        "name": "border",
        "value": "#2A3B47",
        "use": "Section and row dividers"
      },
      {
        "name": "ring",
        "value": "#FFFFFF",
        "use": "Keyboard focus ring"
      },
      {
        "name": "destructive",
        "value": "#F28B82",
        "use": "Field validation error"
      },
      {
        "name": "destructive-foreground",
        "value": "#07121C",
        "use": "Text on destructive surfaces"
      },
      {
        "name": "glass-fill",
        "value": "rgba(10,22,31,.37)",
        "use": "Nav and email field fill"
      },
      {
        "name": "glass-border",
        "value": "rgba(255,255,255,.22)",
        "use": "Nav and email field border"
      },
      {
        "name": "scrim-top",
        "value": "rgba(2,10,18,.57)",
        "use": "Top of hero scrim"
      },
      {
        "name": "scrim-middle",
        "value": "rgba(2,10,18,.28)",
        "use": "Middle of hero scrim"
      },
      {
        "name": "scrim-light",
        "value": "rgba(2,10,18,.02)",
        "use": "Lower opening in hero scrim"
      },
      {
        "name": "scrim-bottom",
        "value": "rgba(2,10,18,.13)",
        "use": "Bottom of hero scrim"
      },
      {
        "name": "glow-core",
        "value": "rgba(159,195,214,.70)",
        "use": "Hero light source"
      },
      {
        "name": "glow-edge",
        "value": "rgba(47,101,136,.36)",
        "use": "Hero light falloff"
      },
      {
        "name": "glow-clear",
        "value": "rgba(47,101,136,0)",
        "use": "Transparent end of hero light"
      },
      {
        "name": "glow-side",
        "value": "rgba(159,195,214,.16)",
        "use": "Secondary hero glow"
      },
      {
        "name": "glow-night",
        "value": "rgba(7,18,28,.95)",
        "use": "Dark edge of hero media"
      },
      {
        "name": "shadow-ink",
        "value": "rgba(2,10,18,.28)",
        "use": "Floating nav shadow"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Playfair Display",
        "fallback": "Georgia, serif",
        "weights": [
          400
        ]
      },
      {
        "role": "body",
        "family": "DM Sans",
        "fallback": "sans-serif",
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
        "size": "clamp(4.3rem, 8.8vw, 8.3rem)",
        "lineHeight": ".99",
        "letterSpacing": "-.065em"
      },
      {
        "name": "title",
        "size": "clamp(2.6rem, 5vw, 4.75rem)",
        "lineHeight": "1.08",
        "letterSpacing": "-.04em"
      },
      {
        "name": "subhead",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "-.02em"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.65",
        "letterSpacing": "0"
      },
      {
        "name": "small",
        "size": ".875rem",
        "lineHeight": "1.5",
        "letterSpacing": ".01em"
      },
      {
        "name": "meta",
        "size": ".75rem",
        "lineHeight": "1.4",
        "letterSpacing": ".12em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "mobile-gutter",
        "value": "20px"
      },
      {
        "name": "section",
        "value": "112px"
      },
      {
        "name": "nav-top",
        "value": "20px"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "8px"
      },
      {
        "name": "md",
        "value": "14px"
      },
      {
        "name": "lg",
        "value": "24px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "hero-scrim",
        "value": "linear-gradient(180deg, var(--scrim-top) 0%, var(--scrim-middle) 40%, var(--scrim-light) 72%, var(--scrim-bottom) 100%)"
      },
      {
        "name": "hero-glow",
        "value": "radial-gradient(ellipse 62% 44% at 52% 87%, var(--glow-core) 0%, var(--glow-edge) 48%, var(--glow-clear) 100%), radial-gradient(ellipse 45% 64% at 82% 43%, var(--glow-side) 0%, var(--glow-clear) 100%), linear-gradient(160deg, var(--background) 12%, var(--glow-night) 100%)"
      },
      {
        "name": "nav-blur",
        "value": "blur(18px)"
      },
      {
        "name": "medium",
        "value": "0 16px 48px var(--shadow-ink)"
      },
      {
        "name": "ui-fade",
        "value": "opacity 180ms ease-out"
      }
    ]
  },
  "sections": [
    {
      "id": "top",
      "purpose": "Introduce the event and hold the page's single form action.",
      "layout": "Hero min-height 100svh; edge-to-edge layered CSS media and scrim; content centered within 1200px; floating nav 20px from top, max-width 850px and 50px high; form max-width 490px with a 51px field and a 38px visible submit circle.",
      "copy": [
        {
          "role": "brand",
          "text": "trace / 26"
        },
        {
          "role": "link",
          "text": "Schedule"
        },
        {
          "role": "link",
          "text": "Speakers"
        },
        {
          "role": "link",
          "text": "About"
        },
        {
          "role": "eyebrow",
          "text": "October 14-15, 2026 / Online + venue to come"
        },
        {
          "role": "heading",
          "text": "Build what lasts."
        },
        {
          "role": "body",
          "text": "Two days with the people who make the web work when things get complicated."
        },
        {
          "role": "label",
          "text": "Email for program updates"
        },
        {
          "role": "placeholder",
          "text": "you@company.com"
        },
        {
          "role": "button accessibility label",
          "text": "Join the update list"
        },
        {
          "role": "note",
          "text": "Demo only. This form does not send or store your email."
        },
        {
          "role": "validation",
          "text": "Enter your email address."
        },
        {
          "role": "validation",
          "text": "Enter a valid email address."
        },
        {
          "role": "status",
          "text": "Checking..."
        },
        {
          "role": "status",
          "text": "Demo complete. No email was sent or stored."
        }
      ]
    },
    {
      "id": "about",
      "purpose": "Explain the event's editorial focus.",
      "layout": "1180px shell with 112px vertical spacing; at 768px, a narrow label column beside a wider heading and paragraph.",
      "copy": [
        {
          "role": "label",
          "text": "01 / The idea"
        },
        {
          "role": "heading",
          "text": "The work behind the work."
        },
        {
          "role": "body",
          "text": "Trace is a two-day gathering for developers who care about how software behaves after launch. Expect practical talks, live reviews, and enough time to ask the awkward questions."
        }
      ]
    },
    {
      "id": "schedule",
      "purpose": "Show a readable draft for both conference days.",
      "layout": "1180px shell with a heading above two columns at 768px; session rows have 1px dividers and a 76px time column.",
      "copy": [
        {
          "role": "label",
          "text": "02 / Program"
        },
        {
          "role": "heading",
          "text": "Two days, one conversation."
        },
        {
          "role": "body",
          "text": "A draft of the room's rhythm, from first coffee to the last question."
        },
        {
          "role": "note",
          "text": "Sample program: names, times, and sessions are illustrative."
        },
        {
          "role": "day",
          "text": "Day 01"
        },
        {
          "role": "date",
          "text": "Wednesday, October 14"
        },
        {
          "role": "time",
          "text": "09:00"
        },
        {
          "role": "session",
          "text": "Doors and coffee"
        },
        {
          "role": "speaker",
          "text": "Open room"
        },
        {
          "role": "time",
          "text": "10:00"
        },
        {
          "role": "session",
          "text": "The cost of later"
        },
        {
          "role": "speaker",
          "text": "Ada Mensah"
        },
        {
          "role": "time",
          "text": "11:30"
        },
        {
          "role": "session",
          "text": "The interface under pressure"
        },
        {
          "role": "speaker",
          "text": "Jun Park"
        },
        {
          "role": "time",
          "text": "14:00"
        },
        {
          "role": "session",
          "text": "Caches, queues, and the messy middle"
        },
        {
          "role": "speaker",
          "text": "Leila Haddad"
        },
        {
          "role": "day",
          "text": "Day 02"
        },
        {
          "role": "date",
          "text": "Thursday, October 15"
        },
        {
          "role": "time",
          "text": "09:30"
        },
        {
          "role": "session",
          "text": "Morning notes"
        },
        {
          "role": "speaker",
          "text": "Open room"
        },
        {
          "role": "time",
          "text": "10:00"
        },
        {
          "role": "session",
          "text": "Design for failure, then recovery"
        },
        {
          "role": "speaker",
          "text": "Tomas Vale"
        },
        {
          "role": "time",
          "text": "11:30"
        },
        {
          "role": "session",
          "text": "A keyboard-first product review"
        },
        {
          "role": "speaker",
          "text": "Jun Park"
        },
        {
          "role": "time",
          "text": "14:00"
        },
        {
          "role": "session",
          "text": "What we keep from the prototype"
        },
        {
          "role": "speaker",
          "text": "Ada Mensah + Leila Haddad"
        }
      ]
    },
    {
      "id": "speakers",
      "purpose": "Introduce the four illustrative speakers without invented biographies or portraits.",
      "layout": "1180px shell; heading beside a two-column speaker list from 768px; profiles separated by rules instead of cards.",
      "copy": [
        {
          "role": "label",
          "text": "03 / Speakers"
        },
        {
          "role": "heading",
          "text": "The voices in the room."
        },
        {
          "role": "body",
          "text": "Four perspectives on building for the long run."
        },
        {
          "role": "number",
          "text": "01"
        },
        {
          "role": "name",
          "text": "Ada Mensah"
        },
        {
          "role": "role",
          "text": "Platform engineer"
        },
        {
          "role": "description",
          "text": "On the decisions that make a system easier to maintain a year later."
        },
        {
          "role": "number",
          "text": "02"
        },
        {
          "role": "name",
          "text": "Jun Park"
        },
        {
          "role": "role",
          "text": "Accessibility engineer"
        },
        {
          "role": "description",
          "text": "On testing an interface when the keyboard is the only way in."
        },
        {
          "role": "number",
          "text": "03"
        },
        {
          "role": "name",
          "text": "Leila Haddad"
        },
        {
          "role": "role",
          "text": "Database engineer"
        },
        {
          "role": "description",
          "text": "On the tradeoffs hiding between a fast query and a reliable service."
        },
        {
          "role": "number",
          "text": "04"
        },
        {
          "role": "name",
          "text": "Tomas Vale"
        },
        {
          "role": "role",
          "text": "Developer tooling designer"
        },
        {
          "role": "description",
          "text": "On making failure states clear enough to act on."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Close with the event date and sample-content disclosure.",
      "layout": "1180px shell with a top border; content stacks on narrow screens and separates horizontally at 768px.",
      "copy": [
        {
          "role": "brand",
          "text": "trace / 26"
        },
        {
          "role": "date",
          "text": "October 14-15, 2026"
        },
        {
          "role": "note",
          "text": "Program and speaker details are illustrative."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 650,
      "changes": [
        "Trim the nav to the brand and Schedule link.",
        "Start hero content at 12vh instead of vertically centering it.",
        "Make the email form full width and shift the CSS media background position to 60% center.",
        "Use 20px page gutters."
      ]
    },
    {
      "maxWidth": 767,
      "changes": [
        "Keep the about section, schedule days, speaker profiles, and footer stacked in one column."
      ]
    }
  ],
  "do": [
    "Use the exact --hero-scrim stops over the CSS media layer.",
    "Keep the floating nav at 20px from the top with --glass-fill and --glass-border.",
    "Set the headline in Playfair Display at --text-display with its last word italic.",
    "Use --spacing-section between content sections and 1px --border rules within lists.",
    "Keep UI entrances and feedback to opacity changes of 180ms or less."
  ],
  "avoid": [
    "A missing video or image file: the hero uses self-contained CSS media instead.",
    "Cards or ornamental elements over the hero media: they would interrupt the full-screen frame.",
    "A second conversion button: the email form is the page's one action.",
    "Invented credentials or testimonials: speaker roles and all session details are explicitly illustrative.",
    "Scroll or pointer parallax: the requested visual direction limits UI motion to short opacity changes."
  ],
  "checks": [
    "At 1440px, the headline fits on one line over a full-screen hero.",
    "At 375px, the nav shows only the brand and Schedule, and hero content begins 12vh from the top.",
    "The nav is 50px tall and the email shell is 51px tall with a 38px visible submit circle.",
    "Both schedule days and all four illustrative speakers are visible below the hero.",
    "An invalid email shows a message beside the field; a valid submission shows a loading state followed by a demo-only result.",
    "Keyboard focus is visible on nav links, the email input, and the submit button.",
    "No missing media request is made, and reduced-motion users see the same static CSS hero."
  ]
}
---

# Design

Present a two-day developer conference to prospective attendees and invite them to request program updates through a demo form.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use the exact --hero-scrim stops over the CSS media layer.
- Keep the floating nav at 20px from the top with --glass-fill and --glass-border.
- Set the headline in Playfair Display at --text-display with its last word italic.
- Use --spacing-section between content sections and 1px --border rules within lists.
- Keep UI entrances and feedback to opacity changes of 180ms or less.

## Don't

- A missing video or image file: the hero uses self-contained CSS media instead.
- Cards or ornamental elements over the hero media: they would interrupt the full-screen frame.
- A second conversion button: the email form is the page's one action.
- Invented credentials or testimonials: speaker roles and all session details are explicitly illustrative.
- Scroll or pointer parallax: the requested visual direction limits UI motion to short opacity changes.

## Checks

- At 1440px, the headline fits on one line over a full-screen hero.
- At 375px, the nav shows only the brand and Schedule, and hero content begins 12vh from the top.
- The nav is 50px tall and the email shell is 51px tall with a 38px visible submit circle.
- Both schedule days and all four illustrative speakers are visible below the hero.
- An invalid email shows a message beside the field; a valid submission shows a loading state followed by a demo-only result.
- Keyboard focus is visible on nav links, the email input, and the submit button.
- No missing media request is made, and reduced-motion users see the same static CSS hero.
