---
{
  "intent": "The site of a small management consultancy presenting its services and recent client work to prospective clients, with a contact form to start an engagement.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#F9F7F2",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1A1A1A",
        "use": "main text"
      },
      {
        "name": "primary",
        "value": "#0F2A3F",
        "use": "headings, buttons, links"
      },
      {
        "name": "primary-foreground",
        "value": "#FFFFFF",
        "use": "text on primary"
      },
      {
        "name": "muted",
        "value": "#EAE6DF",
        "use": "subtle backgrounds, cards"
      },
      {
        "name": "muted-foreground",
        "value": "#5A5A5A",
        "use": "secondary text"
      },
      {
        "name": "accent",
        "value": "#B05C3B",
        "use": "highlights, small accents"
      },
      {
        "name": "border",
        "value": "#D1CCC3",
        "use": "borders, dividers"
      },
      {
        "name": "ring",
        "value": "#0F2A3F",
        "use": "focus rings"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Playfair Display",
        "fallback": "Georgia, serif",
        "weights": [
          400,
          700
        ]
      },
      {
        "role": "body",
        "family": "Source Sans 3",
        "fallback": "system-ui, sans-serif",
        "weights": [
          400,
          600
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(3rem, 6vw, 5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "heading",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "subheading",
        "size": "1.25rem",
        "lineHeight": "1.4",
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
        "name": "section-y",
        "value": "80px"
      },
      {
        "name": "card-padding",
        "value": "32px"
      }
    ],
    "radii": [
      {
        "name": "small",
        "value": "4px"
      },
      {
        "name": "medium",
        "value": "8px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "shadow-sm",
        "value": "0 1px 2px rgba(0,0,0,0.05)"
      },
      {
        "name": "shadow-md",
        "value": "0 4px 12px rgba(0,0,0,0.1)"
      },
      {
        "name": "overlay",
        "value": "linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0))"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "introduce the consultancy and direct visitors to services or case studies",
      "layout": "max-width 800px centered, padding: 120px 24px, text center",
      "copy": [
        {
          "role": "heading",
          "text": "Clear thinking for complex organizations."
        },
        {
          "role": "subheading",
          "text": "A management consultancy that helps small and mid-size companies make confident decisions, improve operations, and build stronger teams."
        },
        {
          "role": "primary button",
          "text": "Explore services"
        },
        {
          "role": "secondary button",
          "text": "Read case studies"
        }
      ]
    },
    {
      "id": "services",
      "purpose": "highlight three core service areas with brief descriptions",
      "layout": "max-width 1200px, three columns on desktop, single column mobile, padding: 80px 24px",
      "copy": [
        {
          "role": "heading",
          "text": "What we do"
        },
        {
          "role": "service title",
          "text": "Strategy"
        },
        {
          "role": "service description",
          "text": "We help leadership teams clarify direction, set priorities, and make decisions with confidence."
        },
        {
          "role": "service title",
          "text": "Operations"
        },
        {
          "role": "service description",
          "text": "We improve processes and workflows to reduce costs and increase throughput without sacrificing quality."
        },
        {
          "role": "service title",
          "text": "Leadership"
        },
        {
          "role": "service description",
          "text": "We develop management teams and build the habits that sustain performance over time."
        }
      ]
    },
    {
      "id": "case-studies",
      "purpose": "show two recent client engagements with tangible results",
      "layout": "max-width 1000px, two columns on desktop, stacked mobile, padding: 80px 24px",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "case study title",
          "text": "Reducing production lead time at a mid-size manufacturer"
        },
        {
          "role": "case study details",
          "text": "Client: [Manufacturing company, 120 employees]\\nChallenge: Production lead time was 30% above industry average.\\nResult: Reduced lead time by 22% in six months."
        },
        {
          "role": "case study title",
          "text": "Building a leadership pipeline at a professional services firm"
        },
        {
          "role": "case study details",
          "text": "Client: [Consulting firm, 45 employees]\\nChallenge: High turnover among first-line managers.\\nResult: Improved retention by 15% and promoted 12 internal candidates."
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "invite visitors to get in touch and provide a brief message",
      "layout": "max-width 600px centered, padding: 80px 24px",
      "copy": [
        {
          "role": "heading",
          "text": "Start a conversation"
        },
        {
          "role": "body",
          "text": "Tell us about your challenge. We'll respond within two business days."
        },
        {
          "role": "button",
          "text": "Contact us"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 768,
      "changes": [
        "services and case studies become single column",
        "hero padding reduces to 80px 16px",
        "navigation collapses to hamburger"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "three columns still okay, adjust card spacing"
      ]
    },
    {
      "maxWidth": 640,
      "changes": [
        "type sizes adjust, hero heading smaller"
      ]
    }
  ],
  "motion": [
    {
      "element": "hero heading",
      "trigger": "load",
      "behaviour": "opacity 0 to 1, scale 0.98 to 1, y 10px to 0",
      "timing": "600ms ease-out"
    },
    {
      "element": "hero subheading",
      "trigger": "load",
      "behaviour": "opacity 0 to 1, y 10px to 0",
      "timing": "600ms ease-out delay 100ms"
    },
    {
      "element": "hero buttons",
      "trigger": "load",
      "behaviour": "opacity 0 to 1, y 10px to 0",
      "timing": "600ms ease-out delay 200ms"
    },
    {
      "element": "service cards",
      "trigger": "in view",
      "behaviour": "opacity 0 to 1, scale 0.98 to 1, y 10px to 0",
      "timing": "500ms ease-out"
    },
    {
      "element": "case study images",
      "trigger": "in view",
      "behaviour": "clip-path from inset(0 0 100% 0) to inset(0)",
      "timing": "600ms ease-out"
    },
    {
      "element": "contact CTA",
      "trigger": "in view",
      "behaviour": "opacity 0 to 1, y 10px to 0",
      "timing": "500ms ease-out"
    }
  ],
  "do": [
    "Use the display font for all headings above 24px.",
    "Use the primary color for interactive elements and links.",
    "Maintain generous whitespace with section-y and gutter.",
    "Keep line lengths under 70 characters for body text."
  ],
  "avoid": [
    "Do not use more than two typefaces on any page.",
    "Do not use bright saturated colors; stick to the token palette.",
    "Do not over-animate; animations should be subtle and short.",
    "Do not place text over busy images without an overlay."
  ],
  "checks": [
    "The hero heading is on one line at 1440px and wraps gracefully on smaller screens.",
    "Service cards are three across at desktop and one across below 768px.",
    "Case study details include placeholders for client names, not invented specifics.",
    "Contact form fields have visible labels and a note that it is a demonstration."
  ]
}
---

# Design

The site of a small management consultancy presenting its services and recent client work to prospective clients, with a contact form to start an engagement.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| hero heading | load | opacity 0 to 1, scale 0.98 to 1, y 10px to 0 | 600ms ease-out |
| hero subheading | load | opacity 0 to 1, y 10px to 0 | 600ms ease-out delay 100ms |
| hero buttons | load | opacity 0 to 1, y 10px to 0 | 600ms ease-out delay 200ms |
| service cards | in view | opacity 0 to 1, scale 0.98 to 1, y 10px to 0 | 500ms ease-out |
| case study images | in view | clip-path from inset(0 0 100% 0) to inset(0) | 600ms ease-out |
| contact CTA | in view | opacity 0 to 1, y 10px to 0 | 500ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use the display font for all headings above 24px.
- Use the primary color for interactive elements and links.
- Maintain generous whitespace with section-y and gutter.
- Keep line lengths under 70 characters for body text.

## Don't

- Do not use more than two typefaces on any page.
- Do not use bright saturated colors; stick to the token palette.
- Do not over-animate; animations should be subtle and short.
- Do not place text over busy images without an overlay.

## Checks

- The hero heading is on one line at 1440px and wraps gracefully on smaller screens.
- Service cards are three across at desktop and one across below 768px.
- Case study details include placeholders for client names, not invented specifics.
- Contact form fields have visible labels and a note that it is a demonstration.
