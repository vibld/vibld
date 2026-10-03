---
{
  "intent": "A single-page portfolio for freelance photographer Mara Voss, aimed at editors and potential clients, whose job is to show recent work, introduce the photographer, and make it easy to request a commission.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#ffffff",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#0a0a0a",
        "use": "primary text and heavy rules"
      },
      {
        "name": "primary",
        "value": "#ff3c00",
        "use": "loud orange accent for buttons, hover states, selected nav underline"
      },
      {
        "name": "secondary",
        "value": "#0038ff",
        "use": "loud blue accent for focus rings, secondary buttons, link hover"
      },
      {
        "name": "muted",
        "value": "#f2f0eb",
        "use": "alternate section background"
      },
      {
        "name": "muted-foreground",
        "value": "#4d4d4d",
        "use": "secondary text such as captions"
      },
      {
        "name": "border",
        "value": "#0a0a0a",
        "use": "heavy black borders"
      },
      {
        "name": "ring",
        "value": "#0038ff",
        "use": "focus outline color"
      },
      {
        "name": "destructive",
        "value": "#b30000",
        "use": "error text"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Archivo Black",
        "fallback": "Arial Black, sans-serif",
        "weights": [
          400
        ]
      },
      {
        "role": "body",
        "family": "Space Mono",
        "fallback": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "weights": [
          400,
          700
        ]
      }
    ],
    "type": [
      {
        "name": "hero",
        "size": "clamp(3.5rem, 8vw, 7rem)",
        "lineHeight": "0.9",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "section-title",
        "size": "clamp(2.25rem, 4vw, 3.5rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "heading",
        "size": "1.5rem",
        "lineHeight": "1.1",
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
        "lineHeight": "1.4",
        "letterSpacing": "0.02em"
      },
      {
        "name": "label",
        "size": "0.75rem",
        "lineHeight": "1.2",
        "letterSpacing": "0.08em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "clamp(1.25rem, 4vw, 3rem)"
      },
      {
        "name": "section",
        "value": "clamp(4rem, 10vw, 8rem)"
      },
      {
        "name": "stack-sm",
        "value": "0.75rem"
      },
      {
        "name": "stack",
        "value": "1.5rem"
      },
      {
        "name": "stack-lg",
        "value": "2.5rem"
      }
    ],
    "radii": [
      {
        "name": "none",
        "value": "0px"
      }
    ],
    "effects": [
      {
        "name": "hard-shadow",
        "value": "8px 8px 0 0 #0a0a0a"
      },
      {
        "name": "hard-shadow-sm",
        "value": "4px 4px 0 0 #0a0a0a"
      },
      {
        "name": "border",
        "value": "3px solid #0a0a0a"
      },
      {
        "name": "border-thin",
        "value": "1px solid #0a0a0a"
      },
      {
        "name": "focus-ring",
        "value": "outline: 3px solid #0038ff; outline-offset: 2px"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "sticky navigation with logo and anchor links to Work, About, Contact",
      "layout": "full width, height 72px, padding 0 var(--gutter), display flex justify-between align-center, bottom border 3px solid #0a0a0a",
      "copy": [
        {
          "role": "link",
          "text": "MV"
        },
        {
          "role": "link",
          "text": "Work"
        },
        {
          "role": "link",
          "text": "About"
        },
        {
          "role": "link",
          "text": "Contact"
        },
        {
          "role": "button",
          "text": "Menu"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "introduce photographer with oversized name and a clear next step",
      "layout": "min-height calc(100vh - 72px), padding var(--section) var(--gutter), display flex flex-direction column justify-end, left aligned, bottom border 3px solid #0a0a0a",
      "copy": [
        {
          "role": "heading",
          "text": "Mara Voss"
        },
        {
          "role": "body",
          "text": "Photographer"
        },
        {
          "role": "body",
          "text": "Portrait and documentary work from Lisbon and elsewhere."
        },
        {
          "role": "link",
          "text": "See recent work"
        },
        {
          "role": "link",
          "text": "Get in touch"
        }
      ]
    },
    {
      "id": "work",
      "purpose": "show six recent projects in a hard-grid gallery",
      "layout": "max-width 1440px, margin auto, padding var(--section) var(--gutter), heading above, grid 1 column, gap 0, borders 1px solid #0a0a0a between cells; at md 2 columns, at lg 3 columns; each item is figure with image area 4:3, caption below",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "body",
          "text": "A selection of commissioned and personal projects from the last two years."
        },
        {
          "role": "body",
          "text": "Nocturne, Personal, 35mm, 2025"
        },
        {
          "role": "body",
          "text": "Porto Norte, Editorial, 2024"
        },
        {
          "role": "body",
          "text": "After the Set, Music, 2024"
        },
        {
          "role": "body",
          "text": "Market Day, Documentary, 2023"
        },
        {
          "role": "body",
          "text": "Blue Hour, Commission, 2023"
        },
        {
          "role": "body",
          "text": "Concrete Gardens, Personal, 2025"
        }
      ]
    },
    {
      "id": "about",
      "purpose": "short bio with a portrait placeholder and two short paragraphs",
      "layout": "max-width 900px, margin auto, padding var(--section) var(--gutter), display grid 1 column, gap var(--stack-lg), at lg 2 columns with text right, portrait left",
      "copy": [
        {
          "role": "heading",
          "text": "About"
        },
        {
          "role": "body",
          "text": "Mara Voss is a photographer based in Lisbon. She photographs people where they work, rest and perform, usually on 35mm and usually in available light."
        },
        {
          "role": "body",
          "text": "Her recent commissions include album covers, magazine features and brand work. She also teaches a monthly darkroom workshop and is slowly building a series on the city's late-night kiosks."
        },
        {
          "role": "body",
          "text": "For assignments, licensing or prints, send a note through the form below."
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "form for commissioning or questions, with a direct email alternative",
      "layout": "max-width 720px, margin auto, padding var(--section) var(--gutter), display flex column, gap var(--stack)",
      "copy": [
        {
          "role": "heading",
          "text": "Contact"
        },
        {
          "role": "body",
          "text": "Tell me about the project, the dates and the budget you have in mind."
        },
        {
          "role": "label",
          "text": "Name"
        },
        {
          "role": "placeholder",
          "text": "Mara Voss"
        },
        {
          "role": "label",
          "text": "Email"
        },
        {
          "role": "placeholder",
          "text": "you@example.com"
        },
        {
          "role": "label",
          "text": "Message"
        },
        {
          "role": "placeholder",
          "text": "Project details, dates, budget"
        },
        {
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "status",
          "text": "This form is a demonstration and does not send messages yet."
        },
        {
          "role": "body",
          "text": "Prefer email? Write to"
        },
        {
          "role": "link",
          "text": "hello@maravoss.com"
        },
        {
          "role": "status",
          "text": "Message sent (demo)."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "copyright line",
      "layout": "full width, padding var(--gutter), top border 3px solid #0a0a0a, text small",
      "copy": [
        {
          "role": "body",
          "text": "© 2026 Mara Voss. All photographs by Mara Voss."
        },
        {
          "role": "body",
          "text": "Built with straight lines and loud colors."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "nav links hidden, mobile menu button shown",
        "hero name uses smaller clamp",
        "gallery 1 column"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "gallery 2 columns",
        "about single column"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "gallery 3 columns",
        "about two columns",
        "nav links visible"
      ]
    }
  ],
  "motion": [
    {
      "element": "nav link underline",
      "trigger": "hover",
      "behaviour": "background-color from transparent to primary in 0ms (hard cut)",
      "timing": "0ms step-end"
    },
    {
      "element": "gallery card",
      "trigger": "hover",
      "behaviour": "box-shadow changes from hard-shadow-sm (4px) to hard-shadow (8px) in 80ms",
      "timing": "80ms steps(2, end)"
    },
    {
      "element": "primary buttons",
      "trigger": "hover/active",
      "behaviour": "background-color from primary to secondary on hover, to black on active",
      "timing": "0ms"
    },
    {
      "element": "form fields focus",
      "trigger": "focus",
      "behaviour": "outline color changes to ring (blue) in 0ms",
      "timing": "0ms"
    }
  ],
  "do": [
    "Use --radius-none (0px) on every element via a base rule.",
    "Use --border (3px solid #0a0a0a) for section dividers and input borders.",
    "Use --shadow-hard on gallery cards and buttons as default, --shadow-hard-sm on small cards.",
    "Set heading font-family to display, body to body via @theme mapping.",
    "Use uppercase and letter-spacing 0.08em for labels and buttons."
  ],
  "avoid": [
    "Avoid any border-radius greater than 0, it breaks the brutalist rule.",
    "Avoid soft shadows with blur or low opacity, hard offsets only.",
    "Avoid gradients or color transitions longer than 80ms.",
    "Avoid adding a third loud color beyond primary orange and secondary blue.",
    "Avoid slow fade-in or slide animations, the page should appear instantly."
  ],
  "checks": [
    "Every element's border-radius is 0.",
    "At 1440px the hero name is at least 6rem tall.",
    "The gallery grid shows 3 columns at desktop with 1px black grid lines.",
    "The contact form labels sit above inputs, not as placeholders.",
    "The form displays the demo notice and does not claim to send messages.",
    "All interactive elements have a visible focus outline of 3px solid #0038ff."
  ]
}
---

# Design

A single-page portfolio for freelance photographer Mara Voss, aimed at editors and potential clients, whose job is to show recent work, introduce the photographer, and make it easy to request a commission.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| nav link underline | hover | background-color from transparent to primary in 0ms (hard cut) | 0ms step-end |
| gallery card | hover | box-shadow changes from hard-shadow-sm (4px) to hard-shadow (8px) in 80ms | 80ms steps(2, end) |
| primary buttons | hover/active | background-color from primary to secondary on hover, to black on active | 0ms |
| form fields focus | focus | outline color changes to ring (blue) in 0ms | 0ms |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use --radius-none (0px) on every element via a base rule.
- Use --border (3px solid #0a0a0a) for section dividers and input borders.
- Use --shadow-hard on gallery cards and buttons as default, --shadow-hard-sm on small cards.
- Set heading font-family to display, body to body via @theme mapping.
- Use uppercase and letter-spacing 0.08em for labels and buttons.

## Don't

- Avoid any border-radius greater than 0, it breaks the brutalist rule.
- Avoid soft shadows with blur or low opacity, hard offsets only.
- Avoid gradients or color transitions longer than 80ms.
- Avoid adding a third loud color beyond primary orange and secondary blue.
- Avoid slow fade-in or slide animations, the page should appear instantly.

## Checks

- Every element's border-radius is 0.
- At 1440px the hero name is at least 6rem tall.
- The gallery grid shows 3 columns at desktop with 1px black grid lines.
- The contact form labels sit above inputs, not as placeholders.
- The form displays the demo notice and does not claim to send messages.
- All interactive elements have a visible focus outline of 3px solid #0038ff.
