---
{
  "intent": "A portfolio site for a freelance photographer to showcase recent work, introduce themselves, and provide a contact method.",
  "tokens": {
    "colors": [
      {
        "name": "primary",
        "value": "#E8FF52",
        "use": "acid yellow-green, used only for interactive elements and key highlights"
      },
      {
        "name": "primary-foreground",
        "value": "#0A0A0A",
        "use": "text on primary background"
      },
      {
        "name": "secondary",
        "value": "#1A1A1A",
        "use": "secondary surface for cards or hover states"
      },
      {
        "name": "secondary-foreground",
        "value": "#FFFFFF",
        "use": "text on secondary background"
      },
      {
        "name": "accent",
        "value": "#B9CC3F",
        "use": "darker variant of primary for hover states"
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
        "use": "primary text color"
      },
      {
        "name": "card",
        "value": "#121212",
        "use": "card background"
      },
      {
        "name": "card-foreground",
        "value": "#FFFFFF",
        "use": "text on card background"
      },
      {
        "name": "muted",
        "value": "#1F1F1F",
        "use": "muted surface for subtle backgrounds"
      },
      {
        "name": "muted-foreground",
        "value": "#9A9A9A",
        "use": "muted text for secondary information"
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
        "fallback": "sans-serif",
        "weights": [
          500,
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "IBM Plex Sans",
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
        "size": "clamp(3rem, 6vw, 5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "heading",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.02em"
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
      },
      {
        "name": "caption",
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
        "value": "80px"
      },
      {
        "name": "stack",
        "value": "16px"
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
        "name": "focus-ring",
        "value": "0 0 0 2px var(--ring)"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the photographer's name and a short tagline, with a call to action to view work or contact.",
      "layout": "Left-aligned, max-width 800px, padding top and bottom 80px, background color var(--background), text color var(--foreground).",
      "copy": [
        {
          "role": "heading",
          "text": "Alex Morgan"
        },
        {
          "role": "subheading",
          "text": "Freelance photographer capturing the unseen in urban landscapes."
        },
        {
          "role": "button",
          "text": "View work"
        },
        {
          "role": "button",
          "text": "Get in touch"
        },
        {
          "role": "caption",
          "text": "Based in Berlin, available worldwide"
        }
      ]
    },
    {
      "id": "gallery",
      "purpose": "Display recent work in a responsive grid with captions.",
      "layout": "Max-width 1200px, centered, grid with 3 columns on desktop, 2 on tablet, 1 on mobile, gap 24px. Each item has an aspect ratio 4:3 placeholder and caption below.",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "caption",
          "text": "Concrete Waves"
        },
        {
          "role": "caption",
          "text": "Neon Nights"
        },
        {
          "role": "caption",
          "text": "Silent Structures"
        },
        {
          "role": "caption",
          "text": "Urban Rhythms"
        },
        {
          "role": "caption",
          "text": "Shadow Play"
        },
        {
          "role": "caption",
          "text": "Asphalt Dreams"
        }
      ]
    },
    {
      "id": "bio",
      "purpose": "Present a short biography of the photographer.",
      "layout": "Max-width 1200px, split layout with portrait placeholder on left (max-width 400px), text on right, stack vertically on mobile.",
      "copy": [
        {
          "role": "heading",
          "text": "About"
        },
        {
          "role": "body",
          "text": "I'm Alex, a freelance photographer based in Berlin. My work focuses on the geometry and light of urban environments, finding beauty in the overlooked corners of the city. With over a decade behind the lens, I've shot for magazines, brands, and personal projects that explore the tension between nature and concrete."
        },
        {
          "role": "body",
          "text": "When I'm not shooting, I'm scouting locations, developing film, or teaching photography workshops. I'm available for commissions worldwide."
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "Provide a contact form and a direct email alternative.",
      "layout": "Max-width 600px, centered, form fields stack with 16px gap, labels above inputs.",
      "copy": [
        {
          "role": "heading",
          "text": "Get in touch"
        },
        {
          "role": "body",
          "text": "Have a project in mind? Fill out the form or email me directly."
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
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "caption",
          "text": "This form is a demonstration and does not send."
        },
        {
          "role": "link",
          "text": "hello@alexmorgan.photo"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 768,
      "changes": [
        "Gallery grid changes to 2 columns",
        "Bio section becomes stacked (portrait above text)",
        "Hero text size reduces via clamp()",
        "Padding reduces to 48px"
      ]
    },
    {
      "maxWidth": 480,
      "changes": [
        "Gallery grid changes to 1 column",
        "Navigation links may stack or hide",
        "Buttons become full width"
      ]
    }
  ],
  "motion": [
    {
      "element": "primary button",
      "trigger": "press",
      "behaviour": "scale to 0.97 and back",
      "timing": "100ms spring stiffness 400 damping 30"
    },
    {
      "element": "primary button accent ring",
      "trigger": "press",
      "behaviour": "opacity from 0 to 1 to 0, scale from 1 to 1.1",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use var(--primary) #E8FF52 only for interactive elements and key highlights",
    "Use Space Grotesk for all headings with letter-spacing -0.02em to -0.03em",
    "Keep all non-accent colors grayscale or near-black",
    "Use 16px+ body font size with line-height 1.6",
    "Provide visible focus states with var(--ring)"
  ],
  "avoid": [
    "Adding any other saturated colors (would break the acid dark discipline)",
    "Animating anything beyond the 180ms limit (would feel sluggish)",
    "Using emojis or decorative icons (would dilute the technical aesthetic)",
    "Rounded corners larger than 8px (would soften the sharp geometric feel)",
    "Centering text except in specific sections like contact form (would feel less editorial)"
  ],
  "checks": [
    "Headings use Space Grotesk with letter-spacing -0.02em or tighter",
    "All buttons are at least 44px tall and have cursor-pointer",
    "Form labels are visible and not placeholder-only",
    "Gallery items show accent border on hover",
    "Contact form states it is a demonstration and does not send",
    "No horizontal scroll at 375px viewport",
    "Only colors from the provided tokens are used, no raw hex in classNames"
  ]
}
---

# Design

A portfolio site for a freelance photographer to showcase recent work, introduce themselves, and provide a contact method.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| primary button | press | scale to 0.97 and back | 100ms spring stiffness 400 damping 30 |
| primary button accent ring | press | opacity from 0 to 1 to 0, scale from 1 to 1.1 | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use var(--primary) #E8FF52 only for interactive elements and key highlights
- Use Space Grotesk for all headings with letter-spacing -0.02em to -0.03em
- Keep all non-accent colors grayscale or near-black
- Use 16px+ body font size with line-height 1.6
- Provide visible focus states with var(--ring)

## Don't

- Adding any other saturated colors (would break the acid dark discipline)
- Animating anything beyond the 180ms limit (would feel sluggish)
- Using emojis or decorative icons (would dilute the technical aesthetic)
- Rounded corners larger than 8px (would soften the sharp geometric feel)
- Centering text except in specific sections like contact form (would feel less editorial)

## Checks

- Headings use Space Grotesk with letter-spacing -0.02em or tighter
- All buttons are at least 44px tall and have cursor-pointer
- Form labels are visible and not placeholder-only
- Gallery items show accent border on hover
- Contact form states it is a demonstration and does not send
- No horizontal scroll at 375px viewport
- Only colors from the provided tokens are used, no raw hex in classNames
