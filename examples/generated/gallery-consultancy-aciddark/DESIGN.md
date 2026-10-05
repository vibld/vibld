---
{
  "intent": "For leadership teams at mid-sized organizations, a site that presents the consultancy's services, two case studies, and a contact form, all in an acid-dark technical visual style.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#E8FF52",
        "use": "acid yellow-green accent for primary actions, focus rings, and active states only"
      },
      {
        "name": "primary-foreground",
        "value": "#0A0A0A",
        "use": "text on primary background"
      },
      {
        "name": "secondary",
        "value": "#1A1A1A",
        "use": "hover state for cards and buttons"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "text on secondary background"
      },
      {
        "name": "accent",
        "value": "#B9CC3F",
        "use": "subtle hover accent, sparingly"
      },
      {
        "name": "accent-foreground",
        "value": "#0A0A0A",
        "use": "text on accent background"
      },
      {
        "name": "background",
        "value": "#0A0A0A",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#FFFFFF",
        "use": "primary text"
      },
      {
        "name": "card",
        "value": "#121212",
        "use": "card and surface background"
      },
      {
        "name": "card-foreground",
        "value": "#FFFFFF",
        "use": "text on card"
      },
      {
        "name": "muted",
        "value": "#1F1F1F",
        "use": "muted background for secondary surfaces"
      },
      {
        "name": "muted-foreground",
        "value": "#9A9A9A",
        "use": "secondary text, captions"
      },
      {
        "name": "border",
        "value": "#2A2A2A",
        "use": "borders and dividers"
      },
      {
        "name": "ring",
        "value": "#E8FF52",
        "use": "focus ring color"
      },
      {
        "name": "destructive",
        "value": "#FF5C5C",
        "use": "error states"
      },
      {
        "name": "destructive-foreground",
        "value": "#0A0A0A",
        "use": "text on destructive background"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Space Grotesk",
        "fallback": "'Space Grotesk', 'Helvetica Neue', sans-serif",
        "weights": [
          500,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "IBM Plex Sans",
        "fallback": "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
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
        "size": "clamp(3rem, 8vw, 6rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h1",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h2",
        "size": "clamp(1.5rem, 3vw, 2.25rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "h3",
        "size": "1.25rem",
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
        "name": "body-sm",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.01em"
      },
      {
        "name": "small",
        "size": "0.75rem",
        "lineHeight": "1.4",
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
        "value": "clamp(4rem, 10vw, 8rem)"
      },
      {
        "name": "container",
        "value": "1200px"
      },
      {
        "name": "card-pad",
        "value": "24px"
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
        "name": "card",
        "value": "background: #121212; border: 1px solid #2A2A2A;"
      },
      {
        "name": "card-hover",
        "value": "background: #1A1A1A; border-color: #3A3A3A;"
      },
      {
        "name": "focus-ring",
        "value": "outline: 2px solid #E8FF52; outline-offset: 2px;"
      },
      {
        "name": "overlay",
        "value": "rgba(10, 10, 10, 0.8)"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "Site-wide header with logo, navigation, and mobile menu trigger.",
      "layout": "Max width 1200px, flex justify-between items-center, padding 24px gutter. Mobile: logo left, menu button right; nav hidden behind sheet.",
      "copy": [
        {
          "role": "logo",
          "text": "Crux"
        },
        {
          "role": "nav",
          "text": "Home"
        },
        {
          "role": "nav",
          "text": "Services"
        },
        {
          "role": "nav",
          "text": "Case Studies"
        },
        {
          "role": "nav",
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
      "purpose": "Introduce the consultancy's value proposition and primary calls to action.",
      "layout": "Full-width section with max content width 1200px. Padding: section vertical. Text left-aligned, max-width 700px. Two buttons in a row, gap 16px.",
      "copy": [
        {
          "role": "heading",
          "text": "Clarity for complex decisions."
        },
        {
          "role": "body",
          "text": "Crux Consulting works with leadership teams to map strategy, streamline operations, and make accountability stick."
        },
        {
          "role": "body",
          "text": "Small firm, senior attention. No junior handoffs."
        },
        {
          "role": "button",
          "text": "Start a conversation"
        },
        {
          "role": "button",
          "text": "See our services"
        }
      ]
    },
    {
      "id": "services-preview",
      "purpose": "Summarize four core services with short descriptions.",
      "layout": "Grid of 4 cards on desktop (2 columns at tablet, 1 column mobile). Each card has title and one-sentence description. Gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "What we do"
        },
        {
          "role": "card-heading",
          "text": "Strategic planning"
        },
        {
          "role": "card-body",
          "text": "A clear, measurable plan that leadership actually uses."
        },
        {
          "role": "card-heading",
          "text": "Operational excellence"
        },
        {
          "role": "card-body",
          "text": "Find and remove the bottlenecks that slow delivery."
        },
        {
          "role": "card-heading",
          "text": "Organizational change"
        },
        {
          "role": "card-body",
          "text": "Make change stick by aligning structure, incentives, and communication."
        },
        {
          "role": "card-heading",
          "text": "Performance management"
        },
        {
          "role": "card-body",
          "text": "Set goals people own and review them without drama."
        }
      ]
    },
    {
      "id": "case-studies-preview",
      "purpose": "Show two anonymized case studies as teasers.",
      "layout": "Two cards side by side on desktop, stacked on mobile. Each card has client type, engagement title, and short outcome. Gap 24px.",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "body",
          "text": "Two short case studies, anonymized to protect client confidentiality."
        },
        {
          "role": "card-client",
          "text": "Manufacturing client"
        },
        {
          "role": "card-title",
          "text": "Three-year strategic plan"
        },
        {
          "role": "card-outcome",
          "text": "We facilitated leadership workshops and built a roadmap the whole executive team signed off on."
        },
        {
          "role": "card-client",
          "text": "Logistics client"
        },
        {
          "role": "card-title",
          "text": "Weekly performance dashboard"
        },
        {
          "role": "card-outcome",
          "text": "We replaced a monthly reporting pack with a live view of key metrics, so issues surfaced in days, not weeks."
        }
      ]
    },
    {
      "id": "differentiator",
      "purpose": "Emphasize the small-firm advantage.",
      "layout": "Full-width section, text centered, max-width 800px, padding section vertical.",
      "copy": [
        {
          "role": "heading",
          "text": "We are a small consultancy. That is the point."
        },
        {
          "role": "body",
          "text": "You work directly with the people who do the work. No layers, no handoffs, no recycled frameworks."
        }
      ]
    },
    {
      "id": "contact-cta",
      "purpose": "Encourage visitors to start a conversation.",
      "layout": "Centered text, max-width 600px, one button. Padding section vertical.",
      "copy": [
        {
          "role": "heading",
          "text": "Talk to us"
        },
        {
          "role": "body",
          "text": "Tell us what you are trying to solve. We will reply within one business day."
        },
        {
          "role": "button",
          "text": "Contact us"
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Site footer with minimal info.",
      "layout": "Max width 1200px, flex justify-between items-center, padding 24px gutter. Mobile: stacked centered.",
      "copy": [
        {
          "role": "copyright",
          "text": "© 2025 Crux Consulting"
        },
        {
          "role": "link",
          "text": "Privacy"
        },
        {
          "role": "link",
          "text": "Terms"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "Header switches to mobile menu with sheet.",
        "Hero heading size reduces to clamp(3rem, 8vw, 6rem).",
        "Services grid becomes 1 column.",
        "Case studies stack vertically.",
        "Footer stacks centered."
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "Services grid becomes 2 columns.",
        "Case studies become 2 columns.",
        "Container padding remains gutter 24px, sections padding reduces to 64px."
      ]
    }
  ],
  "motion": [
    {
      "element": "Hero heading",
      "trigger": "load",
      "behaviour": "fade in and translate up 8px",
      "timing": "150ms ease-out"
    },
    {
      "element": "Hero subtext",
      "trigger": "load",
      "behaviour": "fade in",
      "timing": "150ms ease-out, delay 50ms"
    },
    {
      "element": "Hero actions",
      "trigger": "load",
      "behaviour": "fade in",
      "timing": "150ms ease-out, delay 100ms"
    },
    {
      "element": "Section headings and cards (services, case studies, differentiator, contact CTA)",
      "trigger": "in view",
      "behaviour": "fade in and translate up 16px, stagger 40ms",
      "timing": "150ms ease-out"
    },
    {
      "element": "Buttons (hover)",
      "trigger": "hover",
      "behaviour": "background color changes 150ms, translate y -1px",
      "timing": "150ms ease-out"
    },
    {
      "element": "Cards (hover)",
      "trigger": "hover",
      "behaviour": "border color and background changes, translate y -2px",
      "timing": "150ms ease-out"
    },
    {
      "element": "Mobile menu sheet",
      "trigger": "toggle",
      "behaviour": "slide in from right, fade",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use #E8FF52 only for primary action elements, focus rings, and active states; everything else remains grayscale.",
    "Keep all motion durations between 100ms and 180ms with ease-out curves.",
    "Maintain at least 4.5:1 contrast ratio for body text against #0A0A0A or #121212.",
    "Use Space Grotesk for all headings and IBM Plex Sans for body text.",
    "Use sharp corners (radii sm/md/lg) except for pill-shaped buttons."
  ],
  "avoid": [
    "Adding any second saturated color; the acid green is the only high-chroma element.",
    "Using decorative animations longer than 180ms or with springy overshoot.",
    "Including images, illustrations, or gradients that introduce new colors; keep it typographic and flat.",
    "Using border-radius larger than 8px on cards or inputs; only buttons may be pill-shaped.",
    "Inventing real company names or metrics in case studies; use clearly anonymized placeholders."
  ],
  "checks": [
    "The only elements with #E8FF52 background are primary buttons and focus rings.",
    "All interactive elements have visible focus states with #E8FF52 outline.",
    "The contact form on /contact includes a note that it is a demonstration and does not send.",
    "Case studies use anonymized client labels and avoid fabricated statistics.",
    "No horizontal scroll occurs at 375px viewport width.",
    "All animation durations are 180ms or less."
  ]
}
---

# Design

For leadership teams at mid-sized organizations, a site that presents the consultancy's services, two case studies, and a contact form, all in an acid-dark technical visual style.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Hero heading | load | fade in and translate up 8px | 150ms ease-out |
| Hero subtext | load | fade in | 150ms ease-out, delay 50ms |
| Hero actions | load | fade in | 150ms ease-out, delay 100ms |
| Section headings and cards (services, case studies, differentiator, contact CTA) | in view | fade in and translate up 16px, stagger 40ms | 150ms ease-out |
| Buttons (hover) | hover | background color changes 150ms, translate y -1px | 150ms ease-out |
| Cards (hover) | hover | border color and background changes, translate y -2px | 150ms ease-out |
| Mobile menu sheet | toggle | slide in from right, fade | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use #E8FF52 only for primary action elements, focus rings, and active states; everything else remains grayscale.
- Keep all motion durations between 100ms and 180ms with ease-out curves.
- Maintain at least 4.5:1 contrast ratio for body text against #0A0A0A or #121212.
- Use Space Grotesk for all headings and IBM Plex Sans for body text.
- Use sharp corners (radii sm/md/lg) except for pill-shaped buttons.

## Don't

- Adding any second saturated color; the acid green is the only high-chroma element.
- Using decorative animations longer than 180ms or with springy overshoot.
- Including images, illustrations, or gradients that introduce new colors; keep it typographic and flat.
- Using border-radius larger than 8px on cards or inputs; only buttons may be pill-shaped.
- Inventing real company names or metrics in case studies; use clearly anonymized placeholders.

## Checks

- The only elements with #E8FF52 background are primary buttons and focus rings.
- All interactive elements have visible focus states with #E8FF52 outline.
- The contact form on /contact includes a note that it is a demonstration and does not send.
- Case studies use anonymized client labels and avoid fabricated statistics.
- No horizontal scroll occurs at 375px viewport width.
- All animation durations are 180ms or less.
