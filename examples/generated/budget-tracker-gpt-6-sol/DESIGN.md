---
{
  "intent": "Build a personal budget tracker for someone managing everyday income and expenses, with one job: make the selected month's money easy to record and review.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#f4f2ec",
        "use": "Page background"
      },
      {
        "name": "foreground",
        "value": "#1e2824",
        "use": "Primary text"
      },
      {
        "name": "card",
        "value": "#fffefa",
        "use": "Tile surfaces"
      },
      {
        "name": "card-foreground",
        "value": "#1e2824",
        "use": "Tile text"
      },
      {
        "name": "primary",
        "value": "#263d34",
        "use": "Balance tile, selected entry type and primary action"
      },
      {
        "name": "primary-foreground",
        "value": "#fffefa",
        "use": "Text on primary surfaces"
      },
      {
        "name": "secondary",
        "value": "#e9eee7",
        "use": "Secondary buttons and quiet surfaces"
      },
      {
        "name": "secondary-foreground",
        "value": "#263d34",
        "use": "Text on secondary surfaces"
      },
      {
        "name": "muted",
        "value": "#eeeee7",
        "use": "Empty-state and input backgrounds"
      },
      {
        "name": "muted-foreground",
        "value": "#5b6760",
        "use": "Supporting text"
      },
      {
        "name": "accent",
        "value": "#dce7db",
        "use": "Subtle hover surfaces"
      },
      {
        "name": "accent-foreground",
        "value": "#263d34",
        "use": "Text on accent surfaces"
      },
      {
        "name": "border",
        "value": "#d9ded5",
        "use": "Tile and control borders"
      },
      {
        "name": "input",
        "value": "#d9ded5",
        "use": "Input borders"
      },
      {
        "name": "ring",
        "value": "#426b58",
        "use": "Keyboard focus outlines"
      },
      {
        "name": "income",
        "value": "#23694e",
        "use": "Income indicator and first category bar"
      },
      {
        "name": "expense",
        "value": "#a34431",
        "use": "Expense indicator and third category bar"
      },
      {
        "name": "chart-2",
        "value": "#89651f",
        "use": "Second category bar"
      },
      {
        "name": "chart-4",
        "value": "#555b91",
        "use": "Fourth category bar"
      },
      {
        "name": "track",
        "value": "#e3e9df",
        "use": "Category bar tracks"
      },
      {
        "name": "hero-glow",
        "value": "#3c5d4a",
        "use": "Balance tile radial gradient"
      },
      {
        "name": "hero-line",
        "value": "rgba(255, 254, 250, 0.16)",
        "use": "Decorative rings on the balance tile"
      },
      {
        "name": "shadow-ink",
        "value": "rgba(33, 48, 38, 0.09)",
        "use": "Tile hover shadows"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "Georgia, serif",
        "weights": [
          500,
          600
        ]
      },
      {
        "role": "body",
        "family": "DM Sans",
        "fallback": "\"Helvetica Neue\", sans-serif",
        "weights": [
          400,
          500,
          600,
          700
        ]
      }
    ],
    "type": [
      {
        "name": "display",
        "size": "clamp(3.1rem, 6vw, 5.5rem)",
        "lineHeight": "1",
        "letterSpacing": "-0.055em"
      },
      {
        "name": "heading",
        "size": "clamp(2.25rem, 4vw, 3.5rem)",
        "lineHeight": "1.08",
        "letterSpacing": "-0.045em"
      },
      {
        "name": "section",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "stat",
        "size": "clamp(2rem, 3vw, 2.75rem)",
        "lineHeight": "1.1",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "body",
        "size": "1rem",
        "lineHeight": "1.6",
        "letterSpacing": "0em"
      },
      {
        "name": "small",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.005em"
      },
      {
        "name": "label",
        "size": "0.8125rem",
        "lineHeight": "1.4",
        "letterSpacing": "0.09em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "18px"
      },
      {
        "name": "page-mobile",
        "value": "20px"
      },
      {
        "name": "page-desktop",
        "value": "40px"
      },
      {
        "name": "tile",
        "value": "24px"
      },
      {
        "name": "tile-large",
        "value": "32px"
      },
      {
        "name": "balance-large",
        "value": "40px"
      }
    ],
    "radii": [
      {
        "name": "tile",
        "value": "26px"
      },
      {
        "name": "field",
        "value": "14px"
      },
      {
        "name": "pill",
        "value": "999px"
      }
    ],
    "effects": [
      {
        "name": "balance-gradient",
        "value": "radial-gradient(circle at 88% 8%, var(--hero-glow), transparent 36%), var(--primary)"
      },
      {
        "name": "tile-hover-shadow",
        "value": "0 18px 42px var(--shadow-ink)"
      },
      {
        "name": "focus-outline",
        "value": "3px solid var(--ring)"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "Identify the app and state its storage boundary.",
      "layout": "1240px maximum width; 20px side padding below 1024px and 40px at 1024px; brand left, storage note right at 768px and above.",
      "copy": [
        {
          "role": "brand",
          "text": "tally."
        },
        {
          "role": "description",
          "text": "Your personal budget, kept here."
        },
        {
          "role": "storage note",
          "text": "Saved in this browser only"
        }
      ]
    },
    {
      "id": "overview",
      "purpose": "Introduce the month and provide navigation and export.",
      "layout": "Heading and description on the left; month controls and export on the right at 768px and above; 32px gap before the grid.",
      "copy": [
        {
          "role": "eyebrow",
          "text": "monthly overview"
        },
        {
          "role": "heading",
          "text": "Make sense of this month."
        },
        {
          "role": "body",
          "text": "Keep income, spending and the little details together in one place."
        },
        {
          "role": "accessible button",
          "text": "Previous month"
        },
        {
          "role": "accessible button",
          "text": "Next month"
        },
        {
          "role": "dynamic label",
          "text": "Month YYYY"
        },
        {
          "role": "button",
          "text": "Export CSV"
        },
        {
          "role": "status",
          "text": "CSV downloaded."
        },
        {
          "role": "error",
          "text": "CSV export failed. Try again."
        }
      ]
    },
    {
      "id": "summary",
      "purpose": "Show the selected month's balance, income and expenses.",
      "layout": "12-column grid with an 18px gutter at 768px and above; balance spans 7 columns and 2 rows, income and expenses each span 5 columns. Tiles stack at smaller widths.",
      "copy": [
        {
          "role": "label",
          "text": "month balance"
        },
        {
          "role": "body",
          "text": "Income minus expenses for the selected month."
        },
        {
          "role": "note",
          "text": "Your numbers stay on this device."
        },
        {
          "role": "label",
          "text": "income"
        },
        {
          "role": "body",
          "text": "Money in this month"
        },
        {
          "role": "label",
          "text": "expenses"
        },
        {
          "role": "body",
          "text": "Money out this month"
        },
        {
          "role": "dynamic amount",
          "text": "$0.00"
        }
      ]
    },
    {
      "id": "entry",
      "purpose": "Record an income or expense in the selected month.",
      "layout": "5 of 12 columns from 768px; 24px tile padding, increasing to 32px at 1024px; full width below 768px.",
      "copy": [
        {
          "role": "heading",
          "text": "Add an entry"
        },
        {
          "role": "body",
          "text": "A quick note now makes the month easier to read later."
        },
        {
          "role": "radio",
          "text": "Expense"
        },
        {
          "role": "radio",
          "text": "Income"
        },
        {
          "role": "label",
          "text": "Amount"
        },
        {
          "role": "placeholder",
          "text": "0.00"
        },
        {
          "role": "label",
          "text": "Category"
        },
        {
          "role": "placeholder",
          "text": "e.g. Groceries"
        },
        {
          "role": "label",
          "text": "Date"
        },
        {
          "role": "button",
          "text": "Save entry"
        },
        {
          "role": "success",
          "text": "Entry saved to this browser."
        },
        {
          "role": "error",
          "text": "Enter an amount greater than zero."
        },
        {
          "role": "error",
          "text": "Add a category."
        },
        {
          "role": "error",
          "text": "Choose a date in the selected month."
        },
        {
          "role": "error",
          "text": "Could not save in this browser. Check storage settings."
        }
      ]
    },
    {
      "id": "breakdown",
      "purpose": "Compare expense categories for the month.",
      "layout": "7 of 12 columns from 768px, otherwise full width; horizontal bars use transform-based reveal animation.",
      "copy": [
        {
          "role": "heading",
          "text": "Spending by category"
        },
        {
          "role": "body",
          "text": "A running view of the categories you enter."
        },
        {
          "role": "empty state",
          "text": "No expenses recorded yet."
        },
        {
          "role": "empty state detail",
          "text": "Add an expense to see where this month's money went."
        }
      ]
    },
    {
      "id": "entries",
      "purpose": "Review and remove individual transactions.",
      "layout": "Full-width tile beneath the other cards; rows have a 1px border and a 44px minimum-height remove control.",
      "copy": [
        {
          "role": "heading",
          "text": "Entries"
        },
        {
          "role": "body",
          "text": "Every line added for this month."
        },
        {
          "role": "empty state",
          "text": "No entries for this month."
        },
        {
          "role": "empty state detail",
          "text": "Start with an income or expense above."
        },
        {
          "role": "accessible button",
          "text": "Remove entry"
        },
        {
          "role": "status",
          "text": "Entry removed from this browser."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Reiterate the practical limit of browser storage.",
      "layout": "1240px maximum width; left-aligned, with 32px top and bottom padding.",
      "copy": [
        {
          "role": "note",
          "text": "No account. No sync. Clearing site data removes your entries."
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 767,
      "changes": [
        "Tiles form one column.",
        "Header and overview controls stack.",
        "Page side padding is 20px."
      ]
    },
    {
      "maxWidth": 1023,
      "changes": [
        "From 768px, use a 12-column bento grid and horizontal header and overview layouts.",
        "Tiles retain 24px padding."
      ]
    },
    {
      "maxWidth": 1535,
      "changes": [
        "From 1024px, page side padding becomes 40px and large tiles use 32px to 40px padding.",
        "Content remains capped at 1240px."
      ]
    }
  ],
  "do": [
    "Keep every tile at a 26px radius with an 18px grid gutter.",
    "Use #263d34 for the balance tile and the selected entry type.",
    "State browser-only storage in both the header and footer.",
    "Stagger the six tiles by 40ms, fading each up 8px in under 500ms total.",
    "Lift only the hovered tile by 3px without changing grid dimensions."
  ],
  "avoid": [
    "A second page-level call to action: recording an entry is the main action.",
    "Seeded example transactions: invented amounts would make the balance misleading.",
    "A remote account or sync claim: entries live only in localStorage.",
    "Animating tile width or height: it would reflow the bento grid.",
    "A category pie chart: the compact bar list is readable with long category names."
  ],
  "checks": [
    "At 375px, all tiles fit without horizontal scrolling.",
    "At 1440px, the balance tile spans seven grid columns and two rows.",
    "Changing months changes all totals, categories and entries together.",
    "An expense affects the balance and category breakdown; an income affects the balance and income total.",
    "The CSV contains only the selected month's entries and includes a header row.",
    "Reloading the page preserves entries in the same browser.",
    "A keyboard user can reach month controls, every form field, export and remove buttons.",
    "The page visibly says entries are saved in this browser only."
  ]
}
---

# Design

Build a personal budget tracker for someone managing everyday income and expenses, with one job: make the selected month's money easy to record and review.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Keep every tile at a 26px radius with an 18px grid gutter.
- Use #263d34 for the balance tile and the selected entry type.
- State browser-only storage in both the header and footer.
- Stagger the six tiles by 40ms, fading each up 8px in under 500ms total.
- Lift only the hovered tile by 3px without changing grid dimensions.

## Don't

- A second page-level call to action: recording an entry is the main action.
- Seeded example transactions: invented amounts would make the balance misleading.
- A remote account or sync claim: entries live only in localStorage.
- Animating tile width or height: it would reflow the bento grid.
- A category pie chart: the compact bar list is readable with long category names.

## Checks

- At 375px, all tiles fit without horizontal scrolling.
- At 1440px, the balance tile spans seven grid columns and two rows.
- Changing months changes all totals, categories and entries together.
- An expense affects the balance and category breakdown; an income affects the balance and income total.
- The CSV contains only the selected month's entries and includes a header row.
- Reloading the page preserves entries in the same browser.
- A keyboard user can reach month controls, every form field, export and remove buttons.
- The page visibly says entries are saved in this browser only.
