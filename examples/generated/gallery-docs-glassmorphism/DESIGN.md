---
{
  "intent": "A documentation site for Chisel, an open-source CLI that scaffolds projects from templates, designed to help developers install, learn, and reference commands quickly.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#0f172a",
        "use": "solid saturated page background behind glass panels"
      },
      {
        "name": "foreground",
        "value": "#f8fafc",
        "use": "primary text on dark background"
      },
      {
        "name": "primary",
        "value": "#a78bfa",
        "use": "accent color for links, buttons, highlights"
      },
      {
        "name": "primary-foreground",
        "value": "#0f172a",
        "use": "text on primary-colored elements"
      },
      {
        "name": "muted",
        "value": "#1e293b",
        "use": "muted background for code blocks and solid backing"
      },
      {
        "name": "muted-foreground",
        "value": "#cbd5e1",
        "use": "secondary text, less prominent"
      },
      {
        "name": "accent",
        "value": "#38bdf8",
        "use": "secondary accent for command highlights"
      },
      {
        "name": "accent-foreground",
        "value": "#0f172a",
        "use": "text on accent-colored elements"
      },
      {
        "name": "border",
        "value": "rgba(255, 255, 255, 0.12)",
        "use": "hairline borders on glass panels and inputs"
      },
      {
        "name": "ring",
        "value": "rgba(167, 139, 250, 0.6)",
        "use": "focus ring color"
      },
      {
        "name": "glass-bg",
        "value": "rgba(255, 255, 255, 0.08)",
        "use": "translucent background of glass panels"
      },
      {
        "name": "glass-border",
        "value": "rgba(255, 255, 255, 0.16)",
        "use": "border of glass panels"
      },
      {
        "name": "glass-shadow",
        "value": "0 8px 32px rgba(0, 0, 0, 0.4)",
        "use": "soft shadow under glass panels"
      },
      {
        "name": "code-bg",
        "value": "#0b1120",
        "use": "solid dark background for code blocks (not translucent)"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Sora",
        "fallback": "'Segoe UI', sans-serif",
        "weights": [
          600,
          700
        ]
      },
      {
        "role": "body",
        "family": "Work Sans",
        "fallback": "Arial, sans-serif",
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
        "size": "clamp(3rem, 6vw, 5.5rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "h2",
        "size": "clamp(2rem, 4vw, 3rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "h3",
        "size": "1.5rem",
        "lineHeight": "1.3",
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
        "value": "96px"
      },
      {
        "name": "stack",
        "value": "16px"
      },
      {
        "name": "card-pad",
        "value": "24px"
      }
    ],
    "radii": [
      {
        "name": "glass",
        "value": "16px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "glass-panel",
        "value": "backdrop-filter: blur(18px) saturate(140%); background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4)"
      },
      {
        "name": "focus-ring",
        "value": "box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.6)"
      }
    ]
  },
  "sections": [
    {
      "id": "nav",
      "purpose": "Top navigation with glass effect, linking to main pages and GitHub",
      "layout": "max-width 1200px, flex row, justify-between, align-center, padding 16px 24px, position sticky top 0, z-index 50",
      "copy": [
        {
          "role": "link",
          "text": "Installation"
        },
        {
          "role": "link",
          "text": "Quick start"
        },
        {
          "role": "link",
          "text": "Command reference"
        },
        {
          "role": "button",
          "text": "Star on GitHub"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "Introduce Chisel with headline, subhead, CTAs, and a terminal mockup",
      "layout": "max-width 1200px, grid grid-cols-1 lg:grid-cols-2 gap-12, align-center, padding-top 64px padding-bottom 96px",
      "copy": [
        {
          "role": "heading",
          "text": "Scaffold projects from templates in one command."
        },
        {
          "role": "body",
          "text": "Chisel is an open-source code generator that turns your templates into ready-to-run projects, no setup required."
        },
        {
          "role": "button",
          "text": "Get started"
        },
        {
          "role": "button",
          "text": "View commands"
        },
        {
          "role": "code",
          "text": "$ chisel new my-app --template next.js"
        },
        {
          "role": "code-output",
          "text": "✔ Template downloaded\n✔ Dependencies installed\n✔ Project ready in my-app/"
        }
      ]
    },
    {
      "id": "features",
      "purpose": "Bento grid highlighting key features with unequal cells",
      "layout": "max-width 1200px, grid grid-cols-1 md:grid-cols-3 gap-6, first card spans md:col-span-2, second md:col-span-1, third md:col-span-1, fourth md:col-span-3 (or 2+1)",
      "copy": [
        {
          "role": "heading",
          "text": "One command to a running app"
        },
        {
          "role": "body",
          "text": "Chisel pulls your template, installs dependencies, and starts the dev server. You go from empty folder to working app in under a minute."
        },
        {
          "role": "heading",
          "text": "Templates in any language"
        },
        {
          "role": "body",
          "text": "Define templates with plain files and a simple manifest. Works for JavaScript, Python, Go, Rust, and anything else you can put in a folder."
        },
        {
          "role": "heading",
          "text": "Git-friendly by default"
        },
        {
          "role": "body",
          "text": "Chisel initializes a git repository, creates a .gitignore, and makes an initial commit unless you ask it not to."
        },
        {
          "role": "heading",
          "text": "Extend with plugins"
        },
        {
          "role": "body",
          "text": "Add hooks to run after scaffolding, transform files, or prompt for variables. The plugin API is small and documented in the reference."
        }
      ]
    },
    {
      "id": "install",
      "purpose": "Show installation command and a note about prerequisites",
      "layout": "max-width 800px, centered, padding-block 96px",
      "copy": [
        {
          "role": "heading",
          "text": "Install Chisel"
        },
        {
          "role": "body",
          "text": "You need Node.js 18 or newer. Then install globally with npm or use Homebrew on macOS."
        },
        {
          "role": "code",
          "text": "npm install -g chisel-cli"
        },
        {
          "role": "code",
          "text": "brew install chisel"
        },
        {
          "role": "body",
          "text": "Verify the installation by running chisel --version."
        }
      ]
    },
    {
      "id": "command-preview",
      "purpose": "Preview three essential commands with descriptions",
      "layout": "max-width 1200px, grid grid-cols-1 md:grid-cols-3 gap-6",
      "copy": [
        {
          "role": "heading",
          "text": "Commands you will use daily"
        },
        {
          "role": "term",
          "text": "chisel new"
        },
        {
          "role": "definition",
          "text": "Create a new project from a template."
        },
        {
          "role": "term",
          "text": "chisel add"
        },
        {
          "role": "definition",
          "text": "Add a file or dependency to an existing project."
        },
        {
          "role": "term",
          "text": "chisel list"
        },
        {
          "role": "definition",
          "text": "Show available templates and plugins."
        }
      ]
    },
    {
      "id": "next-steps",
      "purpose": "Guide visitors to detailed guides",
      "layout": "max-width 1200px, grid grid-cols-1 md:grid-cols-2 gap-6",
      "copy": [
        {
          "role": "heading",
          "text": "Read the installation guide"
        },
        {
          "role": "body",
          "text": "Covers system requirements, package managers, and troubleshooting."
        },
        {
          "role": "link",
          "text": "Go to installation"
        },
        {
          "role": "heading",
          "text": "Try the quick start"
        },
        {
          "role": "body",
          "text": "Build a small project step by step to learn the workflow."
        },
        {
          "role": "link",
          "text": "Go to quick start"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 1024,
      "changes": [
        "Hero grid becomes single column, terminal mockup moves below text",
        "Bento grid first card spans full width, other cards adjust"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "Nav links collapse behind a simple menu (using a details/summary or just hide behind icon, no Radix needed)",
        "Bento grid becomes single column",
        "Command preview cards stack",
        "Next steps cards stack",
        "Type scale reduces slightly"
      ]
    }
  ],
  "motion": [
    {
      "element": "Hero heading and subheading",
      "trigger": "load",
      "behaviour": "rise 20px and fade in, stagger children 80ms",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "Hero terminal mockup (glass panel)",
      "trigger": "load",
      "behaviour": "materialize: scale 0.96, backdrop-filter blur 0px to 16px, opacity 0 to 1",
      "timing": "250ms ease-out (cubic-bezier(0.23, 1, 0.32, 1)) after 200ms delay"
    },
    {
      "element": "Bento feature cards",
      "trigger": "in view",
      "behaviour": "materialize: scale 0.96, blur 0px to 16px, opacity 0 to 1, stagger 120ms",
      "timing": "250ms ease-out"
    },
    {
      "element": "Installation code block",
      "trigger": "in view",
      "behaviour": "materialize: scale 0.96, blur 0px to 12px, opacity 0 to 1",
      "timing": "250ms ease-out"
    },
    {
      "element": "Command preview cards",
      "trigger": "in view",
      "behaviour": "materialize, stagger 100ms",
      "timing": "250ms ease-out"
    },
    {
      "element": "Next steps cards",
      "trigger": "in view",
      "behaviour": "materialize, stagger 100ms",
      "timing": "250ms ease-out"
    },
    {
      "element": "Primary buttons and links",
      "trigger": "hover/press",
      "behaviour": "scale 1.02 on hover, 0.97 on tap",
      "timing": "spring stiffness 300 damping 25"
    },
    {
      "element": "Background gradient",
      "trigger": "always",
      "behaviour": "slow drift of radial gradients, 40s loop",
      "timing": "ease-in-out infinite alternate"
    }
  ],
  "do": [
    "Use glass-panel effect only on top-level cards and nav, never on nested surfaces",
    "Keep text inside cards on a solid or sufficiently opaque background; use code-bg for code blocks",
    "Ensure all interactive elements (links, buttons) have visible focus rings using ring token",
    "Use primary color for accent links and buttons, with primary-foreground for text contrast"
  ],
  "avoid": [
    "Do not stack one translucent surface on another; nested glass panels would make text unreadable",
    "Do not use raw hex colors in className or inline styles; always reference CSS custom properties",
    "Do not animate any surface with just opacity fade; materialize with blur and scale as specified",
    "Do not add a testimonial row or generic centered hero with three identical cards; the layout is a bento grid"
  ],
  "checks": [
    "The hero terminal mockup appears with blur and scale animation on load, not just fade",
    "No two translucent glass surfaces are nested; code blocks sit on solid dark background",
    "At 375px viewport, the layout is single column and no horizontal scrolling occurs",
    "At 1440px, the hero headline fits on one line, and the terminal mockup is right-aligned",
    "All links and buttons show a focus ring when tabbed to"
  ]
}
---

# Design

A documentation site for Chisel, an open-source CLI that scaffolds projects from templates, designed to help developers install, learn, and reference commands quickly.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| Hero heading and subheading | load | rise 20px and fade in, stagger children 80ms | spring stiffness 120 damping 20 |
| Hero terminal mockup (glass panel) | load | materialize: scale 0.96, backdrop-filter blur 0px to 16px, opacity 0 to 1 | 250ms ease-out (cubic-bezier(0.23, 1, 0.32, 1)) after 200ms delay |
| Bento feature cards | in view | materialize: scale 0.96, blur 0px to 16px, opacity 0 to 1, stagger 120ms | 250ms ease-out |
| Installation code block | in view | materialize: scale 0.96, blur 0px to 12px, opacity 0 to 1 | 250ms ease-out |
| Command preview cards | in view | materialize, stagger 100ms | 250ms ease-out |
| Next steps cards | in view | materialize, stagger 100ms | 250ms ease-out |
| Primary buttons and links | hover/press | scale 1.02 on hover, 0.97 on tap | spring stiffness 300 damping 25 |
| Background gradient | always | slow drift of radial gradients, 40s loop | ease-in-out infinite alternate |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use glass-panel effect only on top-level cards and nav, never on nested surfaces
- Keep text inside cards on a solid or sufficiently opaque background; use code-bg for code blocks
- Ensure all interactive elements (links, buttons) have visible focus rings using ring token
- Use primary color for accent links and buttons, with primary-foreground for text contrast

## Don't

- Do not stack one translucent surface on another; nested glass panels would make text unreadable
- Do not use raw hex colors in className or inline styles; always reference CSS custom properties
- Do not animate any surface with just opacity fade; materialize with blur and scale as specified
- Do not add a testimonial row or generic centered hero with three identical cards; the layout is a bento grid

## Checks

- The hero terminal mockup appears with blur and scale animation on load, not just fade
- No two translucent glass surfaces are nested; code blocks sit on solid dark background
- At 375px viewport, the layout is single column and no horizontal scrolling occurs
- At 1440px, the hero headline fits on one line, and the terminal mockup is right-aligned
- All links and buttons show a focus ring when tabbed to
