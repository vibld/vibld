---
{
  "intent": "A two-page portfolio for freelance photographer Mara Voss, letting potential clients view recent work, read a short bio, and get in touch through a contact form or email.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#F7F5F2",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1A1917",
        "use": "primary text"
      },
      {
        "name": "muted",
        "value": "#E9E5E0",
        "use": "subtle backgrounds and form field borders"
      },
      {
        "name": "muted-foreground",
        "value": "#6B6660",
        "use": "secondary text and captions"
      },
      {
        "name": "primary",
        "value": "#C4511E",
        "use": "single accent color for links, focus rings, and one small decorative element"
      },
      {
        "name": "primary-foreground",
        "value": "#FFFFFF",
        "use": "text on primary accent"
      },
      {
        "name": "border",
        "value": "#DDD8D2",
        "use": "hairline borders on form fields"
      },
      {
        "name": "ring",
        "value": "#C4511E",
        "use": "focus ring color"
      },
      {
        "name": "image-overlay",
        "value": "rgba(247,245,242,0.85)",
        "use": "scrim over images for caption legibility"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "Georgia, serif",
        "weights": [
          400,
          500
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
        "name": "display",
        "size": "clamp(2.8rem, 6vw, 4.5rem)",
        "lineHeight": "1.05",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h2",
        "size": "clamp(1.8rem, 3.5vw, 2.5rem)",
        "lineHeight": "1.15",
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
        "letterSpacing": "0"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "clamp(1.25rem, 4vw, 2.5rem)"
      },
      {
        "name": "section-y",
        "value": "clamp(4rem, 10vw, 8rem)"
      },
      {
        "name": "page-max",
        "value": "72rem"
      }
    ],
    "radii": [
      {
        "name": "field",
        "value": "0.375rem"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "image-overlay",
        "value": "linear-gradient(to bottom, rgba(247,245,242,0) 0%, rgba(247,245,242,0.85) 100%)"
      }
    ]
  },
  "sections": [
    {
      "id": "home-hero",
      "purpose": "Introduce Mara Voss and guide visitors to the work or contact",
      "layout": "max-width 72rem, left-aligned text, two columns on desktop (text 45%, image 55%), gap 2rem; stacks to single column on mobile with text first",
      "copy": [
        {
          "role": "heading",
          "text": "Mara Voss"
        },
        {
          "role": "body",
          "text": "Freelance photographer based in Copenhagen, working across editorial, portrait and still life."
        },
        {
          "role": "link",
          "text": "See recent work"
        },
        {
          "role": "link",
          "text": "Get in touch"
        },
        {
          "role": "image alt",
          "text": "Featured photograph by Mara Voss, editorial portrait in natural light"
        }
      ]
    },
    {
      "id": "home-gallery",
      "purpose": "Show recent work in a grid with captions",
      "layout": "max-width 72rem, heading left, grid with 12 columns on desktop (some images span 6, some 4), gap 1.5rem; 2 columns at tablet, 1 column mobile",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "caption",
          "text": "Editorial portrait, Lisbon"
        },
        {
          "role": "caption category",
          "text": "Portrait"
        },
        {
          "role": "caption",
          "text": "Still life with ceramics"
        },
        {
          "role": "caption category",
          "text": "Still life"
        },
        {
          "role": "caption",
          "text": "Studio fashion, Copenhagen"
        },
        {
          "role": "caption category",
          "text": "Fashion"
        },
        {
          "role": "caption",
          "text": "Kitchen story for a food magazine"
        },
        {
          "role": "caption category",
          "text": "Editorial"
        },
        {
          "role": "caption",
          "text": "Architectural detail, Porto"
        },
        {
          "role": "caption category",
          "text": "Architecture"
        },
        {
          "role": "caption",
          "text": "Window light portrait"
        },
        {
          "role": "caption category",
          "text": "Portrait"
        }
      ]
    },
    {
      "id": "home-about",
      "purpose": "Provide a short bio with a portrait",
      "layout": "max-width 48rem, left-aligned, one column of text next to a portrait on desktop (text 60%, image 40%), stacks on mobile",
      "copy": [
        {
          "role": "heading",
          "text": "About"
        },
        {
          "role": "body",
          "text": "Mara Voss is a freelance photographer based in Copenhagen. She photographs people, objects and quiet interiors for magazines, studios and independent brands."
        },
        {
          "role": "body",
          "text": "The work is unhurried and precise: natural light, careful composition, and a preference for what is already there. She takes on a small number of commissions each season."
        },
        {
          "role": "image alt",
          "text": "Portrait of Mara Voss standing beside a window"
        }
      ]
    },
    {
      "id": "home-contact-cta",
      "purpose": "Invite visitors to reach out",
      "layout": "max-width 48rem, left-aligned, generous top padding",
      "copy": [
        {
          "role": "heading",
          "text": "Work with me"
        },
        {
          "role": "body",
          "text": "If you have a project in mind, tell me what you are making."
        },
        {
          "role": "link",
          "text": "Get in touch"
        }
      ]
    },
    {
      "id": "contact-form",
      "purpose": "Provide a way to get in touch via form or email",
      "layout": "max-width 48rem, left-aligned, form fields stacked with 1.5rem gap, labels above inputs",
      "copy": [
        {
          "role": "heading",
          "text": "Get in touch"
        },
        {
          "role": "body",
          "text": "Tell me about your project."
        },
        {
          "role": "label",
          "text": "Name"
        },
        {
          "role": "label",
          "text": "Email"
        },
        {
          "role": "label",
          "text": "Message"
        },
        {
          "role": "placeholder",
          "text": "Your name"
        },
        {
          "role": "placeholder",
          "text": "you@example.com"
        },
        {
          "role": "placeholder",
          "text": "What are you making?"
        },
        {
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "status",
          "text": "This form is a demonstration and does not send yet."
        },
        {
          "role": "body",
          "text": "Or write to"
        },
        {
          "role": "link",
          "text": "hello@example.com"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 768,
      "changes": [
        "Home hero stacks to single column",
        "Gallery grid becomes 2 columns",
        "About section stacks to single column",
        "Section padding reduces"
      ]
    },
    {
      "maxWidth": 640,
      "changes": [
        "Gallery grid becomes 1 column",
        "Header links reduce font size and gap",
        "Type scale uses smaller clamp values"
      ]
    }
  ],
  "motion": [
    {
      "element": "Home hero content block",
      "trigger": "load",
      "behaviour": "fade in opacity 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Home gallery section",
      "trigger": "in view",
      "behaviour": "fade in opacity 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Home about section",
      "trigger": "in view",
      "behaviour": "fade in opacity 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Home contact CTA section",
      "trigger": "in view",
      "behaviour": "fade in opacity 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "Contact form section",
      "trigger": "in view",
      "behaviour": "fade in opacity 0 to 1",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use only the neutral palette (#F7F5F2, #1A1917, #6B6660, #D3CEC8) and the single accent #C4511E",
    "Use display type for the main heading only, body for all other text",
    "Keep generous whitespace with section padding clamp(4rem, 10vw, 8rem)",
    "Use focus-visible ring with --ring on all interactive elements",
    "Use hash links for navigation between pages"
  ],
  "avoid": [
    "Do not add transforms, box shadows, or gradient backgrounds other than the image caption scrim",
    "Do not introduce a second accent color; one accent only",
    "Do not center hero text; keep it left-aligned",
    "Do not use decorative borders or separators except on form fields",
    "Do not add text or decoration that does not carry meaning"
  ],
  "checks": [
    "The hero heading is left-aligned at 1440px and uses the display face",
    "All images have alt text and maintain their aspect ratio",
    "The contact form shows the message \"This form is a demonstration and does not send yet.\"",
    "Focus ring is visible on keyboard tab on all links and form fields",
    "Text on background meets a 4.5:1 contrast ratio"
  ]
}
---

# Design

A two-page portfolio for freelance photographer Mara Voss, letting potential clients view recent work, read a short bio, and get in touch through a contact form or email.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Home hero content block | load | fade in opacity 0 to 1 | 150ms ease-out |
| Home gallery section | in view | fade in opacity 0 to 1 | 150ms ease-out |
| Home about section | in view | fade in opacity 0 to 1 | 150ms ease-out |
| Home contact CTA section | in view | fade in opacity 0 to 1 | 150ms ease-out |
| Contact form section | in view | fade in opacity 0 to 1 | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use only the neutral palette (#F7F5F2, #1A1917, #6B6660, #D3CEC8) and the single accent #C4511E
- Use display type for the main heading only, body for all other text
- Keep generous whitespace with section padding clamp(4rem, 10vw, 8rem)
- Use focus-visible ring with --ring on all interactive elements
- Use hash links for navigation between pages

## Don't

- Do not add transforms, box shadows, or gradient backgrounds other than the image caption scrim
- Do not introduce a second accent color; one accent only
- Do not center hero text; keep it left-aligned
- Do not use decorative borders or separators except on form fields
- Do not add text or decoration that does not carry meaning

## Checks

- The hero heading is left-aligned at 1440px and uses the display face
- All images have alt text and maintain their aspect ratio
- The contact form shows the message "This form is a demonstration and does not send yet."
- Focus ring is visible on keyboard tab on all links and form fields
- Text on background meets a 4.5:1 contrast ratio
