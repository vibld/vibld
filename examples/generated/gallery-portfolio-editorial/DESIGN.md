---
{
  "intent": "The site presents freelance photographer Lena Voss's recent work, short bio, and contact form as a single editorial page for potential clients.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#F7F3EC",
        "use": "page background"
      },
      {
        "name": "foreground",
        "value": "#1B1712",
        "use": "primary text"
      },
      {
        "name": "card",
        "value": "#FFFFFF",
        "use": "card background"
      },
      {
        "name": "card-foreground",
        "value": "#1B1712",
        "use": "card text"
      },
      {
        "name": "primary",
        "value": "#1B1712",
        "use": "primary buttons and links"
      },
      {
        "name": "primary-foreground",
        "value": "#F7F3EC",
        "use": "text on primary"
      },
      {
        "name": "secondary",
        "value": "#EAE3D8",
        "use": "secondary background"
      },
      {
        "name": "secondary-foreground",
        "value": "#1B1712",
        "use": "text on secondary"
      },
      {
        "name": "muted",
        "value": "#EAE3D8",
        "use": "muted background"
      },
      {
        "name": "muted-foreground",
        "value": "#6B6257",
        "use": "muted text"
      },
      {
        "name": "accent",
        "value": "#8A2E2E",
        "use": "accent links and hover"
      },
      {
        "name": "accent-foreground",
        "value": "#F7F3EC",
        "use": "text on accent"
      },
      {
        "name": "destructive",
        "value": "#B3261E",
        "use": "error text if needed"
      },
      {
        "name": "border",
        "value": "#D8CFC3",
        "use": "hairlines and input borders"
      },
      {
        "name": "input",
        "value": "#D8CFC3",
        "use": "form field borders"
      },
      {
        "name": "ring",
        "value": "#8A2E2E",
        "use": "focus rings"
      },
      {
        "name": "overlay",
        "value": "rgba(27,23,18,0.55)",
        "use": "scrim over hero image"
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
        "family": "Public Sans",
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
        "size": "clamp(3.5rem, 8vw, 6.5rem)",
        "lineHeight": "1.0",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "section-title",
        "size": "clamp(2.25rem, 4.5vw, 3.75rem)",
        "lineHeight": "1.05",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "pullquote",
        "size": "clamp(1.75rem, 3vw, 2.5rem)",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "body",
        "size": "1.0625rem",
        "lineHeight": "1.6",
        "letterSpacing": "0"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.01em"
      },
      {
        "name": "caption",
        "size": "0.8125rem",
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
        "name": "column-gap",
        "value": "32px"
      }
    ],
    "radii": [
      {
        "name": "sm",
        "value": "0px"
      },
      {
        "name": "md",
        "value": "0px"
      },
      {
        "name": "lg",
        "value": "0px"
      },
      {
        "name": "pill",
        "value": "0px"
      }
    ],
    "effects": [
      {
        "name": "focus-ring",
        "value": "2px solid var(--ring) offset 2px"
      },
      {
        "name": "header-glass",
        "value": "backdrop-filter: blur(8px)"
      },
      {
        "name": "overlay",
        "value": "linear-gradient(rgba(27,23,18,0.55), rgba(27,23,18,0.55))"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "site navigation",
      "layout": "fixed top, full width, background rgba(247,243,236,0.85) with blur, border-bottom border; inner max-width 1200px flex between; mobile uses sheet menu",
      "copy": [
        {
          "role": "link",
          "text": "Lena Voss"
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
          "role": "label",
          "text": "Open menu"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "introduce the photographer and lead to work and contact",
      "layout": "two-column on desktop: text left (50%), full-bleed image right (50%); on mobile stack with image top and text below; min-height 100svh; container max-width 1200px aligned left for text; hero image from picsum.photos/seed/hero/1600/2000",
      "copy": [
        {
          "role": "eyebrow",
          "text": "Freelance photographer"
        },
        {
          "role": "heading",
          "text": "Moments held still, before they change."
        },
        {
          "role": "body",
          "text": "Editorial and commercial photography for magazines, brands, and people who want the real thing."
        },
        {
          "role": "link",
          "text": "View recent work"
        },
        {
          "role": "link",
          "text": "About Lena"
        }
      ]
    },
    {
      "id": "work",
      "purpose": "show recent photography as a feature gallery",
      "layout": "container max-width 1440px; grid: 12 columns, 32px gap; first item spans 7 columns and 2 rows, others 5 columns, one item 12 columns full width with pull quote overlay; captions below; gallery images from picsum.photos seeds: coastal-light, studio-portrait, market-day, quiet-interiors, lines-city, after-rain",
      "copy": [
        {
          "role": "heading",
          "text": "Recent work"
        },
        {
          "role": "pullquote",
          "text": "The best frame is the one that still breathes."
        },
        {
          "role": "caption",
          "text": "Coastal Light, Editorial, 2025"
        },
        {
          "role": "caption",
          "text": "Studio Portrait, Portrait, 2025"
        },
        {
          "role": "caption",
          "text": "Market Day, Documentary, 2024"
        },
        {
          "role": "caption",
          "text": "Quiet Interiors, Interior, 2024"
        },
        {
          "role": "caption",
          "text": "Lines of the City, Architecture, 2024"
        },
        {
          "role": "caption",
          "text": "After Rain, Landscape, 2025"
        }
      ]
    },
    {
      "id": "about",
      "purpose": "short bio with portrait",
      "layout": "two-column: portrait left (40%), text right (60%) with pull quote set apart; gap 48px; portrait full-bleed within column; portrait image from picsum.photos/seed/portrait/1200/1500",
      "copy": [
        {
          "role": "heading",
          "text": "About Lena"
        },
        {
          "role": "body",
          "text": "I am a freelance photographer based in Copenhagen, working across editorial, portrait, and documentary assignments. I wait for the moment to arrive instead of forcing it."
        },
        {
          "role": "body",
          "text": "Before going independent, I spent six years as a photo editor at a monthly magazine, where I learned what a story needs to stand on its own. That training shapes every assignment I take on."
        },
        {
          "role": "pullquote",
          "text": "A good photo is a question, not an answer."
        },
        {
          "role": "link",
          "text": "Get in touch"
        }
      ]
    },
    {
      "id": "contact",
      "purpose": "form to start a conversation and direct email alternative",
      "layout": "two-column: left contact info and direct email, right form (max-width 600px) with fields stacked; gap 48px; on mobile stack",
      "copy": [
        {
          "role": "heading",
          "text": "Get in touch"
        },
        {
          "role": "body",
          "text": "Tell me about your project, your timeline, and the look you have in mind. This form is a demonstration and does not send messages yet."
        },
        {
          "role": "label",
          "text": "Name"
        },
        {
          "role": "placeholder",
          "text": "Your name"
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
          "text": "Tell me about the project, the date, and where it happens."
        },
        {
          "role": "button",
          "text": "Send message"
        },
        {
          "role": "status",
          "text": "Thanks, your message would be on its way in a real version."
        },
        {
          "role": "link",
          "text": "hello@lenavoss.photo"
        },
        {
          "role": "body",
          "text": "Prefer email? Write to hello@lenavoss.photo"
        },
        {
          "role": "body",
          "text": "Based in Copenhagen, available worldwide."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "copyright and back to top",
      "layout": "max-width 1200px, flex between, padding 24px",
      "copy": [
        {
          "role": "body",
          "text": "© 2026 Lena Voss. All rights reserved."
        },
        {
          "role": "link",
          "text": "Back to top"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "at 375 and below 640: header shows only logo and menu button, nav hidden; hero is single column with full-bleed image above text; work grid one column; about one column; contact one column"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "from 640 to 768: hero remains single column but text larger; work grid two columns; about two columns with portrait left 40%; contact two columns with info left form right"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "from 768 to 1024: hero splits into two columns text left image right; work grid 12 columns with first item spanning 7 columns and 2 rows; about two columns portrait left 40%; contact remains two columns"
      ]
    },
    {
      "maxWidth": 1440,
      "changes": [
        "from 1024 to 1440 and above: all sections at max container widths, hero image full viewport height, work grid full 1440 width"
      ]
    }
  ],
  "motion": [
    {
      "element": "hero text block",
      "trigger": "load",
      "behaviour": "rise 40px and fade in, headline words stagger 60ms, supporting line and links 80ms stagger",
      "timing": "spring stiffness 120 damping 20"
    },
    {
      "element": "hero image",
      "trigger": "load",
      "behaviour": "clip-path wipe from left, opacity 0 to 1, scale 1.05 to 1 over 600ms",
      "timing": "ease-out cubic-bezier(0.23,1,0.32,1)"
    },
    {
      "element": "work section heading",
      "trigger": "in view",
      "behaviour": "rise 24px and fade in",
      "timing": "600ms ease-out"
    },
    {
      "element": "gallery items",
      "trigger": "in view",
      "behaviour": "clip-path wipe from bottom, opacity 0 to 1, stagger 60ms, scale 1.02 to 1",
      "timing": "500ms ease-out"
    },
    {
      "element": "about portrait",
      "trigger": "in view",
      "behaviour": "clip-path wipe from left, opacity 0 to 1",
      "timing": "600ms ease-out"
    },
    {
      "element": "about text block and pull quote",
      "trigger": "in view",
      "behaviour": "rise 24px and fade in, pull quote delayed 120ms",
      "timing": "600ms ease-out"
    },
    {
      "element": "contact form fields",
      "trigger": "in view",
      "behaviour": "rise 16px and fade in, stagger 40ms",
      "timing": "400ms ease-out"
    },
    {
      "element": "focus rings and hover states",
      "trigger": "hover/press",
      "behaviour": "button lifts 2px and shadow, scale 1.02 on hover, 0.97 on press; links underline slides in",
      "timing": "150ms ease-out"
    }
  ],
  "do": [
    "Use Fraunces for all headings, Public Sans for body and UI.",
    "Use #8A2E2E accent only for links and focus rings, never as large background.",
    "Keep photography full-bleed and sharp-cornered, radius 0.",
    "Use generous white space with container 1200px and 1440px for gallery.",
    "Animate only transform, opacity, and clip-path."
  ],
  "avoid": [
    "Avoid rounded corners on images or buttons (radius is 0).",
    "Avoid any second call to action competing with the contact form; gallery and about link only to #contact.",
    "Avoid dark mode styles; this site is light only, no .dark.",
    "Avoid adding testimonials, client logos, or invented statistics; none are in the request.",
    "Avoid using pills, badges, or centered hero layout; use asymmetric editorial grid."
  ],
  "checks": [
    "The headline stays on one or two lines at 1440px, no overflow.",
    "On a 375px viewport, the hero image sits above the text and no horizontal scroll appears.",
    "The contact form shows 'This form is a demonstration and does not send messages yet.' before submit.",
    "Each gallery photo has a caption with title, category, and year.",
    "Keyboard focus is visible on all links and form fields.",
    "The header on mobile (<=640) hides Work and About links behind a menu button."
  ]
}
---

# Design

The site presents freelance photographer Lena Voss's recent work, short bio, and contact form as a single editorial page for potential clients.

## Motion

| Element | Trigger | Behavior | Timing |
| --- | --- | --- | --- |
| hero text block | load | rise 40px and fade in, headline words stagger 60ms, supporting line and links 80ms stagger | spring stiffness 120 damping 20 |
| hero image | load | clip-path wipe from left, opacity 0 to 1, scale 1.05 to 1 over 600ms | ease-out cubic-bezier(0.23,1,0.32,1) |
| work section heading | in view | rise 24px and fade in | 600ms ease-out |
| gallery items | in view | clip-path wipe from bottom, opacity 0 to 1, stagger 60ms, scale 1.02 to 1 | 500ms ease-out |
| about portrait | in view | clip-path wipe from left, opacity 0 to 1 | 600ms ease-out |
| about text block and pull quote | in view | rise 24px and fade in, pull quote delayed 120ms | 600ms ease-out |
| contact form fields | in view | rise 16px and fade in, stagger 40ms | 400ms ease-out |
| focus rings and hover states | hover/press | button lifts 2px and shadow, scale 1.02 on hover, 0.97 on press; links underline slides in | 150ms ease-out |

The frontmatter above is this project's design spec: every color, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Use Fraunces for all headings, Public Sans for body and UI.
- Use #8A2E2E accent only for links and focus rings, never as large background.
- Keep photography full-bleed and sharp-cornered, radius 0.
- Use generous white space with container 1200px and 1440px for gallery.
- Animate only transform, opacity, and clip-path.

## Don't

- Avoid rounded corners on images or buttons (radius is 0).
- Avoid any second call to action competing with the contact form; gallery and about link only to #contact.
- Avoid dark mode styles; this site is light only, no .dark.
- Avoid adding testimonials, client logos, or invented statistics; none are in the request.
- Avoid using pills, badges, or centered hero layout; use asymmetric editorial grid.

## Checks

- The headline stays on one or two lines at 1440px, no overflow.
- On a 375px viewport, the hero image sits above the text and no horizontal scroll appears.
- The contact form shows 'This form is a demonstration and does not send messages yet.' before submit.
- Each gallery photo has a caption with title, category, and year.
- Keyboard focus is visible on all links and form fields.
- The header on mobile (<=640) hides Work and About links behind a menu button.
