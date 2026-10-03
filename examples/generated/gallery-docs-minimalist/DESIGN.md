---
{
  "intent": "Basalt CLI documentation for developers who want to install, start, and reference the commands of a small static site generator.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#ffffff",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1a1a1a",
        "use": "primary text"
      },
      {
        "name": "muted",
        "value": "#f5f5f5",
        "use": "secondary surfaces, code blocks"
      },
      {
        "name": "muted-foreground",
        "value": "#6b7280",
        "use": "secondary text, captions"
      },
      {
        "name": "primary",
        "value": "#2563eb",
        "use": "accent for links, focus, selected"
      },
      {
        "name": "primary-foreground",
        "value": "#ffffff",
        "use": "text on accent"
      },
      {
        "name": "border",
        "value": "#e5e7eb",
        "use": "hairline rules, input borders"
      },
      {
        "name": "ring",
        "value": "#2563eb",
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
          600
        ]
      },
      {
        "role": "body",
        "family": "Source Sans 3",
        "fallback": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        "weights": [
          400,
          600
        ]
      },
      {
        "role": "mono",
        "family": "JetBrains Mono",
        "fallback": "ui-monospace, SFMono-Regular, Menlo, monospace",
        "weights": [
          400,
          500
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(2.25rem, 5vw, 3.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h2",
        "size": "1.5rem",
        "lineHeight": "1.25",
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
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0"
      },
      {
        "name": "code",
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
        "name": "section",
        "value": "80px"
      },
      {
        "name": "navHeight",
        "value": "64px"
      }
    ],
    "radii": [
      {
        "name": "md",
        "value": "6px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "focusRing",
        "value": "box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #2563eb"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce Basalt CLI and lead into the three documentation guides.",
      "layout": "Centered, max-width 42rem, margin-inline auto, padding-block 5rem 3rem, text-align left.",
      "copy": [
        {
          "role": "heading",
          "text": "Basalt CLI"
        },
        {
          "role": "body",
          "text": "A small command-line tool for building static sites from plain text."
        }
      ]
    },
    {
      "id": "guides",
      "purpose": "Direct visitors to installation, quick start, and command reference.",
      "layout": "Three-column grid, max-width 64rem, gap 1.5rem, margin-inline auto, padding-block 0 5rem.",
      "copy": [
        {
          "role": "heading",
          "text": "Write, build, publish"
        },
        {
          "role": "link",
          "text": "Installation"
        },
        {
          "role": "body",
          "text": "Get Basalt on your machine in under a minute."
        },
        {
          "role": "link",
          "text": "Quick start"
        },
        {
          "role": "body",
          "text": "Build your first site from a directory of Markdown files."
        },
        {
          "role": "link",
          "text": "Command reference"
        },
        {
          "role": "body",
          "text": "Every Basalt command, flag, and exit code, listed."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "guides grid becomes one column",
        "hero padding-block becomes 3rem 1.5rem"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "guides grid becomes two columns"
      ]
    }
  ],
  "motion": [
    {
      "element": "hero section",
      "trigger": "load",
      "behaviour": "opacity from 0 to 1",
      "timing": "150ms ease-out"
    },
    {
      "element": "guides section",
      "trigger": "in view",
      "behaviour": "opacity from 0 to 1",
      "timing": "150ms ease-out, viewport once, amount 0.3"
    }
  ],
  "do": [
    "Use the neutral palette: #ffffff background, #1a1a1a text, one accent #2563eb for links and focus.",
    "Set body copy to --text-body with 1.6 line-height.",
    "Keep code and pre elements on --muted background with 1px --border border and --radius-md.",
    "Apply opacity-only motion at 150ms ease-out with no transforms or stagger.",
    "Show a 2px focus ring using --ring on every interactive element."
  ],
  "avoid": [
    "Do not add transforms, scale, or stagger to any motion; they break the quiet motion rule.",
    "Do not use more than one accent color; the single blue is the only color outside neutrals.",
    "Do not use decorative shadows, gradients, or borders; each rule must carry meaning.",
    "Do not use raw hex values in class names; always map through CSS custom properties.",
    "Do not set body text smaller than 16px."
  ],
  "checks": [
    "The home page hero and guides fade in over 150ms with no movement.",
    "All body text is at least 16px and line-height 1.6.",
    "Keyboard focus is visible on every link and button.",
    "The three documentation guides are reachable from the top navigation and the home page.",
    "No copy contains an em dash or curly quotes."
  ]
}
---

# Design

Basalt CLI documentation for developers who want to install, start, and reference the commands of a small static site generator.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| hero section | load | opacity from 0 to 1 | 150ms ease-out |
| guides section | in view | opacity from 0 to 1 | 150ms ease-out, viewport once, amount 0.3 |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use the neutral palette: #ffffff background, #1a1a1a text, one accent #2563eb for links and focus.
- Set body copy to --text-body with 1.6 line-height.
- Keep code and pre elements on --muted background with 1px --border border and --radius-md.
- Apply opacity-only motion at 150ms ease-out with no transforms or stagger.
- Show a 2px focus ring using --ring on every interactive element.

## Don't

- Do not add transforms, scale, or stagger to any motion; they break the quiet motion rule.
- Do not use more than one accent color; the single blue is the only color outside neutrals.
- Do not use decorative shadows, gradients, or borders; each rule must carry meaning.
- Do not use raw hex values in class names; always map through CSS custom properties.
- Do not set body text smaller than 16px.

## Checks

- The home page hero and guides fade in over 150ms with no movement.
- All body text is at least 16px and line-height 1.6.
- Keyboard focus is visible on every link and button.
- The three documentation guides are reachable from the top navigation and the home page.
- No copy contains an em dash or curly quotes.
