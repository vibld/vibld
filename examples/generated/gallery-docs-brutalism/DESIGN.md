---
{
  "intent": "Documentation for the rig command-line tool, for developers who need to install it, start a project, and look up commands, on a page that is direct, raw, and unadorned.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#f7f3e8",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#111111",
        "use": "primary text and borders"
      },
      {
        "name": "card",
        "value": "#ffffff",
        "use": "cards, code blocks, table cells background"
      },
      {
        "name": "card-foreground",
        "value": "#111111",
        "use": "text on cards"
      },
      {
        "name": "primary",
        "value": "#ff3b30",
        "use": "loud accent color for buttons, links, highlights"
      },
      {
        "name": "primary-foreground",
        "value": "#111111",
        "use": "text on primary"
      },
      {
        "name": "secondary",
        "value": "#ffd500",
        "use": "second loud color for highlights, sticky notes"
      },
      {
        "name": "secondary-foreground",
        "value": "#111111",
        "use": "text on secondary"
      },
      {
        "name": "muted",
        "value": "#e5e0d1",
        "use": "muted backgrounds, dividers"
      },
      {
        "name": "muted-foreground",
        "value": "#555555",
        "use": "secondary text"
      },
      {
        "name": "accent",
        "value": "#ffd500",
        "use": "same as secondary for shadcn consistency"
      },
      {
        "name": "border",
        "value": "#111111",
        "use": "all borders"
      },
      {
        "name": "input",
        "value": "#111111",
        "use": "input borders"
      },
      {
        "name": "ring",
        "value": "#111111",
        "use": "focus ring"
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
        "fallback": "Courier New, monospace",
        "weights": [
          400,
          700
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(3rem, 8vw, 6rem)",
        "lineHeight": "0.95",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "section",
        "size": "clamp(2rem, 5vw, 3.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.7",
        "letterSpacing": "0"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.02em"
      },
      {
        "name": "code",
        "size": "0.9rem",
        "lineHeight": "1.6",
        "letterSpacing": "0"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "clamp(24px, 5vw, 48px)"
      },
      {
        "name": "section",
        "value": "clamp(48px, 10vw, 96px)"
      },
      {
        "name": "stack",
        "value": "16px"
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
        "value": "6px 6px 0 0 #111111"
      },
      {
        "name": "soft-shadow",
        "value": "4px 4px 0 0 #111111"
      },
      {
        "name": "border",
        "value": "2px solid #111111"
      }
    ]
  },
  "sections": [
    {
      "id": "hero",
      "purpose": "Introduce the tool and point to installation",
      "layout": "max-width 1200px, center aligned, padding block var(--space-section), stacked with 24px gap",
      "copy": [
        {
          "role": "heading",
          "text": "rig CLI"
        },
        {
          "role": "body",
          "text": "A fast, opinionated scaffolder for code projects. Install it, run a template, and get back to work."
        },
        {
          "role": "button",
          "text": "Install rig"
        }
      ]
    },
    {
      "id": "installation",
      "purpose": "Show installation commands for each platform",
      "layout": "max-width 1200px, left aligned, section padding block var(--space-section), code blocks with border and hard shadow",
      "copy": [
        {
          "role": "label",
          "text": "Installation"
        },
        {
          "role": "heading",
          "text": "Install rig"
        },
        {
          "role": "body",
          "text": "Copy and run the command for your platform. rig requires Node.js 20 or newer."
        },
        {
          "role": "code-label",
          "text": "macOS / Linux"
        },
        {
          "role": "code",
          "text": "npm install -g rig-cli"
        },
        {
          "role": "code-label",
          "text": "Windows"
        },
        {
          "role": "code",
          "text": "npm install -g rig-cli"
        },
        {
          "role": "body",
          "text": "Verify the install:"
        },
        {
          "role": "code",
          "text": "rig --version"
        }
      ]
    },
    {
      "id": "quick-start",
      "purpose": "Walk through creating a first project",
      "layout": "max-width 1200px, left aligned, section padding block var(--space-section), ordered steps with mono numbers",
      "copy": [
        {
          "role": "label",
          "text": "Quick start"
        },
        {
          "role": "heading",
          "text": "Quick start"
        },
        {
          "role": "body",
          "text": "Create a project from a template in three commands."
        },
        {
          "role": "step",
          "text": "1. Initialize a new project in the current directory:"
        },
        {
          "role": "code",
          "text": "rig init"
        },
        {
          "role": "step",
          "text": "2. Pick a template when prompted:"
        },
        {
          "role": "code",
          "text": "? Select a template: (Use arrow keys)"
        },
        {
          "role": "step",
          "text": "3. Install dependencies and start the dev server:"
        },
        {
          "role": "code",
          "text": "npm install"
        },
        {
          "role": "code",
          "text": "npm run dev"
        },
        {
          "role": "body",
          "text": "All templates include a README with next steps."
        }
      ]
    },
    {
      "id": "command-reference",
      "purpose": "Reference every rig command with usage and examples",
      "layout": "max-width 1200px, left aligned, section padding block var(--space-section), responsive table with black borders",
      "copy": [
        {
          "role": "label",
          "text": "Command reference"
        },
        {
          "role": "heading",
          "text": "Command reference"
        },
        {
          "role": "body",
          "text": "Every rig command, its options, and an example."
        },
        {
          "role": "table-header-command",
          "text": "Command"
        },
        {
          "role": "table-header-description",
          "text": "Description"
        },
        {
          "role": "table-header-example",
          "text": "Example"
        },
        {
          "role": "command",
          "text": "rig init"
        },
        {
          "role": "description",
          "text": "Create a new project from a template in the current directory."
        },
        {
          "role": "example",
          "text": "rig init --template node-server"
        },
        {
          "role": "command",
          "text": "rig list"
        },
        {
          "role": "description",
          "text": "List available templates and their descriptions."
        },
        {
          "role": "example",
          "text": "rig list"
        },
        {
          "role": "command",
          "text": "rig create <name>"
        },
        {
          "role": "description",
          "text": "Create a new project in a subdirectory called <name>."
        },
        {
          "role": "example",
          "text": "rig create my-api"
        },
        {
          "role": "command",
          "text": "rig version"
        },
        {
          "role": "description",
          "text": "Print the installed version."
        },
        {
          "role": "example",
          "text": "rig version"
        },
        {
          "role": "command",
          "text": "rig help [command]"
        },
        {
          "role": "description",
          "text": "Show help for a command, or general help if omitted."
        },
        {
          "role": "example",
          "text": "rig help create"
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Close the page with project status and link",
      "layout": "max-width 1200px, left aligned, section padding block var(--space-gutter), border-top 2px solid var(--border)",
      "copy": [
        {
          "role": "body",
          "text": "rig is MIT licensed and open source."
        },
        {
          "role": "link",
          "text": "View on GitHub"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 768,
      "changes": [
        "Header navigation links hidden, hamburger button shown; all sections single column; code blocks reduce font size; command table becomes horizontally scrollable"
      ]
    }
  ],
  "motion": [],
  "do": [
    "Use 2px solid #111111 borders on all cards, code blocks, and interactive elements.",
    "Use the hard shadow (6px 6px 0 0 #111111) on primary buttons and cards that need to stand out.",
    "Set all corners to 0 via a global rule.",
    "Use the display font for headings and the mono font for code and command text.",
    "Keep layout aligned to an 8px grid."
  ],
  "avoid": [
    "Avoid any border-radius: it contradicts the brutalist direction.",
    "Avoid gradients, drop shadows with blur, and soft transitions over 100ms.",
    "Avoid more than two accent colors: red #ff3b30 and yellow #ffd500.",
    "Avoid emojis or decorative icons; use text and lucide icons sparingly.",
    "Avoid centered text in sections; keep content left aligned for rawness."
  ],
  "checks": [
    "Every element has square corners.",
    "The primary button has a 6px hard shadow and border.",
    "At 375px viewport, the nav collapses to a hamburger and no horizontal scroll appears.",
    "The command reference table remains readable at mobile widths, either stacking or scrolling horizontally.",
    "All code blocks use the mono font and have a black border."
  ]
}
---

# Design

Documentation for the rig command-line tool, for developers who need to install it, start a project, and look up commands, on a page that is direct, raw, and unadorned.

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use 2px solid #111111 borders on all cards, code blocks, and interactive elements.
- Use the hard shadow (6px 6px 0 0 #111111) on primary buttons and cards that need to stand out.
- Set all corners to 0 via a global rule.
- Use the display font for headings and the mono font for code and command text.
- Keep layout aligned to an 8px grid.

## Don't

- Avoid any border-radius: it contradicts the brutalist direction.
- Avoid gradients, drop shadows with blur, and soft transitions over 100ms.
- Avoid more than two accent colors: red #ff3b30 and yellow #ffd500.
- Avoid emojis or decorative icons; use text and lucide icons sparingly.
- Avoid centered text in sections; keep content left aligned for rawness.

## Checks

- Every element has square corners.
- The primary button has a 6px hard shadow and border.
- At 375px viewport, the nav collapses to a hamburger and no horizontal scroll appears.
- The command reference table remains readable at mobile widths, either stacking or scrolling horizontally.
- All code blocks use the mono font and have a black border.
