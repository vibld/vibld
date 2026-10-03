---
{
  "intent": "A one-page portfolio for freelance photographer Mara Voss that presents recent work, a short bio and a contact form.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#0d0b14",
        "use": "page background, dark plum black"
      },
      {
        "name": "foreground",
        "value": "#f7f4f1",
        "use": "primary text on dark backgrounds"
      },
      {
        "name": "primary",
        "value": "#ff7a59",
        "use": "accent color for buttons, links, focus ring"
      },
      {
        "name": "primary-foreground",
        "value": "#24100a",
        "use": "text on primary-colored elements"
      },
      {
        "name": "muted",
        "value": "#1a1626",
        "use": "muted surface behind glass"
      },
      {
        "name": "muted-foreground",
        "value": "#c9c2d4",
        "use": "secondary text, labels"
      },
      {
        "name": "accent",
        "value": "#2a2240",
        "use": "hover state for glass surfaces"
      },
      {
        "name": "border",
        "value": "rgba(255,255,255,0.22)",
        "use": "hairline borders on glass and cards"
      },
      {
        "name": "ring",
        "value": "#ff7a59",
        "use": "focus ring color"
      },
      {
        "name": "glass-bg",
        "value": "rgba(24,21,34,0.55)",
        "use": "fill for frosted glass surfaces"
      },
      {
        "name": "glass-border",
        "value": "rgba(255,255,255,0.24)",
        "use": "brighter border for key glass panels"
      },
      {
        "name": "scrim",
        "value": "rgba(13,11,20,0.70)",
        "use": "dark overlay behind glass and on hero media"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "Georgia, serif",
        "weights": [
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "Manrope",
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
        "size": "clamp(3.25rem, 8vw, 7rem)",
        "lineHeight": "0.98",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "section",
        "size": "clamp(2rem, 4vw, 3.5rem)",
        "lineHeight": "1.05",
        "letterSpacing": "-0.025em"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.6",
        "letterSpacing": "0.01em"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.01em"
      },
      {
        "name": "eyebrow",
        "size": "0.75rem",
        "lineHeight": "1.4",
        "letterSpacing": "0.14em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "clamp(20px, 4vw, 48px)"
      },
      {
        "name": "section",
        "value": "clamp(72px, 10vw, 140px)"
      },
      {
        "name": "stack-8",
        "value": "8px"
      },
      {
        "name": "stack-16",
        "value": "16px"
      },
      {
        "name": "stack-24",
        "value": "24px"
      },
      {
        "name": "stack-32",
        "value": "32px"
      },
      {
        "name": "stack-48",
        "value": "48px"
      }
    ],
    "radii": [
      {
        "name": "glass",
        "value": "24px"
      },
      {
        "name": "pill",
        "value": "999px"
      },
      {
        "name": "image",
        "value": "16px"
      }
    ],
    "effects": [
      {
        "name": "glass",
        "value": "backdrop-filter: blur(18px) saturate(1.4); background: rgba(24,21,34,0.55); border: 1px solid rgba(255,255,255,0.22); box-shadow: 0 24px 48px -12px rgba(0,0,0,0.5);"
      },
      {
        "name": "glassStrong",
        "value": "backdrop-filter: blur(24px) saturate(1.3); background: rgba(20,18,28,0.72); border: 1px solid rgba(255,255,255,0.24); box-shadow: 0 32px 64px -16px rgba(0,0,0,0.6);"
      },
      {
        "name": "scrim",
        "value": "background: linear-gradient(to bottom right, rgba(13,11,20,0.86), rgba(13,11,20,0.55) 55%, rgba(13,11,20,0.35));"
      }
    ]
  },
  "sections": [
    {
      "id": "site-header",
      "purpose": "Fixed glass navigation with brand, anchor links and a mobile menu",
      "layout": "Fixed top, full width, height 72px, max width 1200px centered, padding-inline gutter, flex between items center",
      "copy": [
        {
          "role": "brand",
          "text": "Mara Voss"
        },
        {
          "role": "nav-link",
          "text": "Work"
        },
        {
          "role": "nav-link",
          "text": "About"
        },
        {
          "role": "nav-link",
          "text": "Contact"
        },
        {
          "role": "button",
          "text": "Book a shoot"
        },
        {
          "role": "menu-button",
          "text": "Open navigation"
        },
        {
          "role": "menu-button",
          "text": "Close navigation"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "Full-bleed hero with background image, scrim and introductory copy",
      "layout": "min-height 100svh, flex align-end, max width 1200px, padding-bottom clamp(48px,8vh,96px), left aligned, background image with scrim overlay",
      "copy": [
        {
          "role": "eyebrow",
          "text": "Freelance photographer, Lisbon"
        },
        {
          "role": "heading",
          "text": "Photographs that hold the quiet in a loud room."
        },
        {
          "role": "body",
          "text": "I make portraits, editorial images and live performance photos for musicians, makers and small brands."
        },
        {
          "role": "button",
          "text": "See recent work"
        },
        {
          "role": "button",
          "text": "Get in touch"
        }
      ]
    },
    {
      "id": "gallery",
      "purpose": "Filterable gallery of recent work with lightbox",
      "layout": "max width 1200px centered, padding-inline gutter, padding-block section, heading left, filter buttons row, grid 12 columns with varied card spans",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "body",
          "text": "A selection of portraits, places and live shows from the last two years."
        },
        {
          "role": "filter",
          "text": "All"
        },
        {
          "role": "filter",
          "text": "Portraits"
        },
        {
          "role": "filter",
          "text": "Places"
        },
        {
          "role": "filter",
          "text": "Live"
        },
        {
          "role": "image",
          "text": "Portrait of a woman in natural window light"
        },
        {
          "role": "image",
          "text": "Foggy mountain road at dawn"
        },
        {
          "role": "image",
          "text": "Singer on stage with red light"
        },
        {
          "role": "image",
          "text": "Close portrait of a man in a studio"
        },
        {
          "role": "image",
          "text": "Coastal cliffs in late afternoon"
        },
        {
          "role": "image",
          "text": "Drummer mid-song at a club show"
        },
        {
          "role": "image",
          "text": "Woman laughing at a market stall"
        },
        {
          "role": "image",
          "text": "Old tram on a Lisbon street"
        }
      ]
    },
    {
      "id": "bio",
      "purpose": "Short bio with portrait",
      "layout": "max width 1000px centered, padding-block section, two-column grid on desktop (portrait left, text right), gap 48px",
      "copy": [
        {
          "role": "heading",
          "text": "About me"
        },
        {
          "role": "body",
          "text": "I am Mara Voss, a freelance photographer based in Lisbon. I started with a film camera in my grandfather's attic and now shoot portraits, editorial work and live performances for clients who want images that feel unhurried."
        },
        {
          "role": "body",
          "text": "When I am not behind a camera, I am developing film, walking the Alfama with a notebook, or chasing late light along the Tagus."
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "Contact form and direct email alternative",
      "layout": "max width 1000px centered, padding-block section, glass panel with padding 48px, form two columns on desktop for name and email, message full width",
      "copy": [
        {
          "role": "heading",
          "text": "Work with me"
        },
        {
          "role": "body",
          "text": "Tell me about your project, your dates and where you are based. I will reply when I can."
        },
        {
          "role": "label",
          "text": "Your name"
        },
        {
          "role": "label",
          "text": "Email address"
        },
        {
          "role": "label",
          "text": "Message"
        },
        {
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "status",
          "text": "Sending..."
        },
        {
          "role": "status",
          "text": "Thanks, your message is ready to send. This form is a demonstration and does not deliver yet."
        },
        {
          "role": "link",
          "text": "Prefer email? Write to hello@maravoss.photo"
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Footer with copyright and social links",
      "layout": "max width 1200px, padding-block 48px, flex between items center",
      "copy": [
        {
          "role": "text",
          "text": "© 2026 Mara Voss"
        },
        {
          "role": "link",
          "text": "hello@maravoss.photo"
        },
        {
          "role": "social-label",
          "text": "Instagram"
        },
        {
          "role": "social-label",
          "text": "Email"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "nav links hidden, mobile sheet menu shown",
        "hero heading drops to text-hero size already at mobile",
        "gallery grid becomes single column",
        "contact form stacks to one column",
        "bio section stacks to one column with portrait first"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "gallery grid becomes two columns",
        "contact form keeps two columns for name and email"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "gallery grid uses three columns",
        "hero content left aligned with narrower max width"
      ]
    }
  ],
  "motion": [
    {
      "element": "site header glass",
      "trigger": "load",
      "behaviour": "backdrop-filter blur from 0 to 18px and scale 0.98 to 1",
      "timing": "250ms ease-out"
    },
    {
      "element": "hero eyebrow, heading, body, buttons",
      "trigger": "load",
      "behaviour": "rise 24px and fade in, 80ms stagger",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "hero spotlight glow",
      "trigger": "pointer",
      "behaviour": "follows cursor x and y with springs",
      "timing": "spring stiffness 80 damping 20, only fine pointers"
    },
    {
      "element": "gallery image cards",
      "trigger": "in view",
      "behaviour": "scale 0.96 and fade in, 60ms stagger",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "gallery filter buttons",
      "trigger": "hover and press",
      "behaviour": "scale 1.02 on hover, 0.97 on tap",
      "timing": "spring stiffness 400 damping 30"
    },
    {
      "element": "bio portrait",
      "trigger": "in view",
      "behaviour": "scale 0.96 and fade in",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "bio text",
      "trigger": "in view",
      "behaviour": "rise 24px and fade in",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "contact glass panel",
      "trigger": "in view",
      "behaviour": "backdrop-filter blur from 0 to 24px and scale 0.98 to 1",
      "timing": "250ms ease-out"
    }
  ],
  "do": [
    "Put saturated color on the solid background layer behind glass, never on the translucent foreground",
    "Use one glass surface per stacking context",
    "Use the text-display token for all display headings",
    "Keep navigation anchored with smooth scroll",
    "Use the materializeGlass variant for glass surfaces"
  ],
  "avoid": [
    "Do not stack two light translucent surfaces on top of each other; legibility collapses",
    "Do not use raw hex values in className; use color tokens",
    "Do not animate width, height, top or left",
    "Do not state a response time; the form is a demonstration and does not deliver",
    "Do not use a brand icon for Instagram; use the AtSign lucide icon with an aria-label"
  ],
  "checks": [
    "Every gallery image opens in a dialog with a caption",
    "The contact form disables while sending and then shows the demo notice",
    "The header has a visible hairline border and backdrop blur",
    "At 375px wide, the hero heading fits without clipping",
    "No section has two translucent panels overlapped"
  ]
}
---

# Design

A one-page portfolio for freelance photographer Mara Voss that presents recent work, a short bio and a contact form.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| site header glass | load | backdrop-filter blur from 0 to 18px and scale 0.98 to 1 | 250ms ease-out |
| hero eyebrow, heading, body, buttons | load | rise 24px and fade in, 80ms stagger | spring stiffness 120 damping 20 |
| hero spotlight glow | pointer | follows cursor x and y with springs | spring stiffness 80 damping 20, only fine pointers |
| gallery image cards | in view | scale 0.96 and fade in, 60ms stagger | spring stiffness 120 damping 20 |
| gallery filter buttons | hover and press | scale 1.02 on hover, 0.97 on tap | spring stiffness 400 damping 30 |
| bio portrait | in view | scale 0.96 and fade in | spring stiffness 120 damping 20 |
| bio text | in view | rise 24px and fade in | spring stiffness 120 damping 20 |
| contact glass panel | in view | backdrop-filter blur from 0 to 24px and scale 0.98 to 1 | 250ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Put saturated color on the solid background layer behind glass, never on the translucent foreground
- Use one glass surface per stacking context
- Use the text-display token for all display headings
- Keep navigation anchored with smooth scroll
- Use the materializeGlass variant for glass surfaces

## Don't

- Do not stack two light translucent surfaces on top of each other; legibility collapses
- Do not use raw hex values in className; use color tokens
- Do not animate width, height, top or left
- Do not state a response time; the form is a demonstration and does not deliver
- Do not use a brand icon for Instagram; use the AtSign lucide icon with an aria-label

## Checks

- Every gallery image opens in a dialog with a caption
- The contact form disables while sending and then shows the demo notice
- The header has a visible hairline border and backdrop blur
- At 375px wide, the hero heading fits without clipping
- No section has two translucent panels overlapped
