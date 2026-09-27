---
{
  "intent": "A portfolio for a freelance gouache and ink illustrator, aimed at art directors and publishers, whose single job is to get them to look closely at the plates and then email a brief.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#f4efe6",
        "use": "Warm paper page ground; text on the commissions section"
      },
      {
        "name": "foreground",
        "value": "#1b1712",
        "use": "Ink body text, section rules and the commissions section fill"
      },
      {
        "name": "card",
        "value": "#faf6ee",
        "use": "Plate dialog surface"
      },
      {
        "name": "card-foreground",
        "value": "#1b1712",
        "use": "Text inside the plate dialog"
      },
      {
        "name": "popover",
        "value": "#faf6ee",
        "use": "shadcn popover surface (reserved)"
      },
      {
        "name": "popover-foreground",
        "value": "#1b1712",
        "use": "shadcn popover text (reserved)"
      },
      {
        "name": "primary",
        "value": "#a8341a",
        "use": "Vermilion ink: primary button, 08 numeral, link underlines, drop cap, tile title hover"
      },
      {
        "name": "primary-foreground",
        "value": "#fbf7f0",
        "use": "Text on the primary button"
      },
      {
        "name": "secondary",
        "value": "#e8e0d2",
        "use": "shadcn secondary surface"
      },
      {
        "name": "secondary-foreground",
        "value": "#1b1712",
        "use": "Text on secondary surfaces"
      },
      {
        "name": "muted",
        "value": "#e8e0d2",
        "use": "Plate frame fill while artwork loads or wipes in"
      },
      {
        "name": "muted-foreground",
        "value": "#5c5347",
        "use": "Labels, captions, tab counts, supporting copy (6.6:1 on paper)"
      },
      {
        "name": "accent",
        "value": "#ece3d3",
        "use": "Hover fill for outline and inverse buttons, dialog close"
      },
      {
        "name": "accent-foreground",
        "value": "#1b1712",
        "use": "Text on accent"
      },
      {
        "name": "border",
        "value": "#cfc3ae",
        "use": "Hairlines under tabs and above tile captions"
      },
      {
        "name": "input",
        "value": "#cfc3ae",
        "use": "shadcn input border (reserved)"
      },
      {
        "name": "ring",
        "value": "#a8341a",
        "use": "2px focus outline on paper"
      },
      {
        "name": "scrim",
        "value": "rgba(20,16,12,.72)",
        "use": "Overlay behind the plate dialog"
      },
      {
        "name": "grain",
        "value": "rgba(27,23,18,.05)",
        "use": "Paper tooth dots in the body background"
      },
      {
        "name": "shadow-color",
        "value": "rgba(20,16,12,.45)",
        "use": "Colour of the dialog shadow"
      },
      {
        "name": "inverse-muted",
        "value": "#c9c0b1",
        "use": "Secondary text on the ink commissions section (9.9:1)"
      },
      {
        "name": "inverse-border",
        "value": "#4a4236",
        "use": "Rules and outline button border on the ink section"
      },
      {
        "name": "art-night",
        "value": "#1f2747",
        "use": "Artwork: night sky, ink lines"
      },
      {
        "name": "art-deep",
        "value": "#34406e",
        "use": "Artwork: sea, dusk sky, heron"
      },
      {
        "name": "art-moon",
        "value": "#f2e3b3",
        "use": "Artwork: moon, lamp, windows"
      },
      {
        "name": "art-ochre",
        "value": "#d69a3a",
        "use": "Artwork: field, cat, sunflowers"
      },
      {
        "name": "art-rust",
        "value": "#b5532c",
        "use": "Artwork: cabin, trunks, beds, roof"
      },
      {
        "name": "art-teal",
        "value": "#2f6464",
        "use": "Artwork: shore, pool, shed, riso teal"
      },
      {
        "name": "art-sage",
        "value": "#93a585",
        "use": "Artwork: rocks, hills, sprouts"
      },
      {
        "name": "art-rose",
        "value": "#d9927f",
        "use": "Artwork: sun, anemones, riso pink"
      },
      {
        "name": "art-cream",
        "value": "#efe3c8",
        "use": "Artwork: paper, hull, frames"
      },
      {
        "name": "art-leaf",
        "value": "#4f6b3a",
        "use": "Artwork: tree crowns, reeds, ground"
      },
      {
        "name": "art-sky",
        "value": "#b9cfd4",
        "use": "Artwork: day sky, water, glass"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Bodoni Moda",
        "fallback": "\"Bodoni 72\", Didot, Georgia, serif",
        "weights": [
          400,
          500
        ]
      },
      {
        "role": "body",
        "family": "Newsreader",
        "fallback": "Georgia, \"Times New Roman\", serif",
        "weights": [
          400,
          500
        ]
      },
      {
        "role": "mono",
        "family": "IBM Plex Mono",
        "fallback": "ui-monospace, Menlo, monospace",
        "weights": [
          400,
          500
        ]
      }
    ],
    "type": [
      {
        "name": "numeral",
        "size": "clamp(6rem, 2rem + 12vw, 15rem)",
        "lineHeight": "0.8",
        "letterSpacing": "-0.04em"
      },
      {
        "name": "display",
        "size": "clamp(3.25rem, 1.4rem + 7.6vw, 8rem)",
        "lineHeight": "0.92",
        "letterSpacing": "-0.035em"
      },
      {
        "name": "headline",
        "size": "clamp(2.25rem, 1.6rem + 2.6vw, 4rem)",
        "lineHeight": "1.02",
        "letterSpacing": "-0.025em"
      },
      {
        "name": "quote",
        "size": "clamp(1.75rem, 1.2rem + 2.4vw, 3.25rem)",
        "lineHeight": "1.14",
        "letterSpacing": "-0.02em"
      },
      {
        "name": "title",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "deck",
        "size": "1.3125rem",
        "lineHeight": "1.5",
        "letterSpacing": "-0.005em"
      },
      {
        "name": "body",
        "size": "1.125rem",
        "lineHeight": "1.65",
        "letterSpacing": "0em"
      },
      {
        "name": "caption",
        "size": "0.875rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.01em"
      },
      {
        "name": "label",
        "size": "0.75rem",
        "lineHeight": "1.4",
        "letterSpacing": "0.12em"
      }
    ],
    "space": [
      {
        "name": "page-margin",
        "value": "clamp(1.25rem, 4vw, 4rem)"
      },
      {
        "name": "gutter",
        "value": "24px"
      },
      {
        "name": "section",
        "value": "80px below 1024px, 128px from 1024px"
      },
      {
        "name": "tile-row-gap",
        "value": "56px below 1024px, 80px from 1024px"
      },
      {
        "name": "content-max",
        "value": "1440px (90rem, max-w-page)"
      },
      {
        "name": "measure",
        "value": "34rem for standalone paragraphs"
      }
    ],
    "radii": [
      {
        "name": "plate",
        "value": "0px"
      },
      {
        "name": "control",
        "value": "2px"
      }
    ],
    "effects": [
      {
        "name": "paper-grain",
        "value": "radial-gradient(var(--grain) 0.6px, transparent 0.8px) at 4px 4px on body"
      },
      {
        "name": "shadow-plate",
        "value": "0 30px 80px -20px var(--shadow-color)"
      },
      {
        "name": "plate-wipe",
        "value": "clip-path inset(0% 100% 0% 0%) to inset(0% 0% 0% 0%), 600ms cubic-bezier(0.23, 1, 0.32, 1)"
      },
      {
        "name": "enter",
        "value": "opacity 0 to 1 with scale 0.98 to 1, 500ms cubic-bezier(0.23, 1, 0.32, 1), hero children staggered 80ms"
      },
      {
        "name": "dialog-enter",
        "value": "fade-in plus zoom-in-98, 400ms open, 280ms close, over scrim rgba(20,16,12,.72)"
      },
      {
        "name": "tile-hover",
        "value": "artwork scale(1.02) over 500ms inside overflow hidden frame, 1px ring foreground/10 inset"
      },
      {
        "name": "focus",
        "value": "outline 2px solid var(--ring), offset 3px; var(--background) on the ink section"
      }
    ]
  },
  "sections": [
    {
      "id": "masthead",
      "purpose": "Name the illustrator and link to the three parts of the page.",
      "layout": "max-w-page (1440px) centred with page-margin padding, 20px vertical padding. Stacked name over nav below 640px; one row, name left and nav right, from 640px. Nav links 44px tall, 24px apart. Skip link appears fixed top left on focus.",
      "copy": [
        {
          "role": "link",
          "text": "Skip to the work"
        },
        {
          "role": "link",
          "text": "Ines Marlow"
        },
        {
          "role": "label",
          "text": "Illustration and picture books"
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
          "text": "Commissions"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "Set the editorial voice with one large headline and open on a full-bleed feature plate.",
      "layout": "1px foreground rule, then a mono label row justified between. Headline spans all 12 columns in text-display (128px at 1440px), 48px above at lg. Deck and actions sit in columns 8 to 12 at lg, 40px under the headline. Plate 01 runs the full viewport width 64px below: aspect 4/5, 16/10 from 768px, 21/9 from 1280px, caption in mono under it inside page margins.",
      "copy": [
        {
          "role": "label",
          "text": "Illustrator, Bristol UK"
        },
        {
          "role": "label",
          "text": "Selected work, 2021 to 2024"
        },
        {
          "role": "heading",
          "text": "Small worlds, painted slowly."
        },
        {
          "role": "body",
          "text": "Editorial illustration, book covers and picture books in gouache, ink and two colour risograph. Taking new commissions from September."
        },
        {
          "role": "button",
          "text": "See the work"
        },
        {
          "role": "link",
          "text": "Commission a picture"
        },
        {
          "role": "label",
          "text": "Plate 01"
        },
        {
          "role": "body",
          "text": "Night ferry. Gouache on hot pressed paper, 56 x 32 cm, 2024."
        }
      ]
    },
    {
      "id": "gallery",
      "purpose": "Show eight plates on an asymmetric magazine grid, filterable by kind of work.",
      "layout": "max-w-page. Header grid: label and heading in columns 1 to 7, a decorative 205px italic 08 numeral in primary in columns 8 to 12 that rises 112px above the section rule. Tabs underline style, 44px tall, wrapping. Plates: 1 column, 2 columns from 768px, 12 columns from 1024px with spans 7/5/4/8/5/7/6/6, aspects 5:4, 4:5, 16:10 and 1:1, and vertical offsets of 64 to 128px on alternate tiles. Caption under each plate: mono number, Bodoni title, mono meta built as category, medium, year.",
      "copy": [
        {
          "role": "label",
          "text": "Selected work"
        },
        {
          "role": "heading",
          "text": "Eight pictures from the last four years"
        },
        {
          "role": "body",
          "text": "Select any plate to see it larger, with notes on how it was made."
        },
        {
          "role": "label",
          "text": "08"
        },
        {
          "role": "button",
          "text": "All work"
        },
        {
          "role": "button",
          "text": "Editorial"
        },
        {
          "role": "button",
          "text": "Books"
        },
        {
          "role": "button",
          "text": "Personal"
        },
        {
          "role": "status",
          "text": "8"
        },
        {
          "role": "status",
          "text": "3"
        },
        {
          "role": "status",
          "text": "2"
        },
        {
          "role": "heading",
          "text": "Night ferry"
        },
        {
          "role": "heading",
          "text": "Orchard in August"
        },
        {
          "role": "heading",
          "text": "The lodger"
        },
        {
          "role": "heading",
          "text": "Tidepool"
        },
        {
          "role": "heading",
          "text": "Greenhouse at dusk"
        },
        {
          "role": "heading",
          "text": "Saturday market"
        },
        {
          "role": "heading",
          "text": "Heron at Eastville"
        },
        {
          "role": "heading",
          "text": "Allotment, late summer"
        }
      ]
    },
    {
      "id": "plate-dialog",
      "purpose": "Show one plate large with its making notes, and step through the current filter.",
      "layout": "shadcn Dialog, width 100% minus 32px up to 72rem, card fill, 20px padding (32px from 640px), shadow-plate, over the scrim. One column below 1024px; from 1024px a 1.3fr / 1fr split with the 4:5 plate capped at viewport height minus 8rem. 44px close button top right. Arrow keys step plates; the plate cross-fades in 150ms.",
      "copy": [
        {
          "role": "label",
          "text": "Plate 01"
        },
        {
          "role": "label",
          "text": "Medium"
        },
        {
          "role": "label",
          "text": "Size"
        },
        {
          "role": "label",
          "text": "Year"
        },
        {
          "role": "label",
          "text": "Filed under"
        },
        {
          "role": "button",
          "text": "Previous"
        },
        {
          "role": "button",
          "text": "Next"
        },
        {
          "role": "status",
          "text": "1 of 8"
        },
        {
          "role": "button",
          "text": "Close"
        },
        {
          "role": "body",
          "text": "Painted over three evenings from sketches made on the Portishead foreshore. The moon went in first, and every other colour was mixed to sit under it."
        },
        {
          "role": "body",
          "text": "A cover sample for a novel set during one harvest. The brief asked for heat without using red, so the sun is a dusty pink and the field does the work."
        },
        {
          "role": "body",
          "text": "Drawn for a column about renting with pets. The cat was drawn from life; the window was drawn from four different flats."
        },
        {
          "role": "body",
          "text": "From a week of low tides at Mousehole. Every rock started as a thumbprint of masking fluid."
        },
        {
          "role": "body",
          "text": "Chapter opener for a gardening memoir. The lamp is the only warm colour on the page, which is why the tomatoes are nearly grey."
        },
        {
          "role": "body",
          "text": "A spread for a food supplement, printed in two passes at a shared studio. The overlap between the pink and teal inks does the shadows."
        },
        {
          "role": "body",
          "text": "Eastville Park lake, early March. The heron stood still for eleven minutes, long enough for this and two worse drawings."
        },
        {
          "role": "body",
          "text": "Opening image for a series on community gardens. The shed belongs to plot 14, and its owner asked for the roof to be made redder."
        }
      ]
    },
    {
      "id": "pull-quote",
      "purpose": "Set the illustrator's own words apart from the body copy.",
      "layout": "max-w-page, 1px foreground rule, 12 columns at lg: mono label in columns 1 to 2, the quote in italic Bodoni at text-quote in columns 3 to 11, mono attribution below it.",
      "copy": [
        {
          "role": "label",
          "text": "From the studio notebook"
        },
        {
          "role": "body",
          "text": "I start every picture with the light source and paint backwards from it. If the lamp is wrong, nothing else in the room will sit still."
        },
        {
          "role": "label",
          "text": "Ines Marlow, on how a picture begins"
        }
      ]
    },
    {
      "id": "about",
      "purpose": "A short biography and the working facts a commissioner needs.",
      "layout": "max-w-page, 80px / 128px vertical padding. At lg: label and heading in columns 1 to 3; body in columns 4 to 12 set in two CSS columns with a 48px gap and a primary drop cap. Facts strip under the body in columns 4 to 12: 1 column, 2 from 640px, 4 from 1280px, each under a 1px foreground rule.",
      "copy": [
        {
          "role": "label",
          "text": "About"
        },
        {
          "role": "heading",
          "text": "A short biography"
        },
        {
          "role": "body",
          "text": "Ines Marlow grew up above a hardware shop in Stroud and now paints most mornings at a kitchen table in Easton, Bristol. She studied printmaking, spent six years laying out pages for a regional newspaper, and went freelance in 2019 when the drawings in the margins started to take over."
        },
        {
          "role": "body",
          "text": "Most pictures begin as pencil thumbnails no bigger than a postage stamp. Finals are gouache on hot pressed paper, sometimes with an ink line, scanned at 600 dpi and checked against the printer's proofs. Shorter runs become two colour risograph editions, printed at a shared studio on Stokes Croft."
        },
        {
          "role": "body",
          "text": "She is left handed, works to the radio, and never throws away a failed painting. The backs are for colour tests."
        },
        {
          "role": "label",
          "text": "Based in"
        },
        {
          "role": "body",
          "text": "Bristol, UK"
        },
        {
          "role": "label",
          "text": "Mediums"
        },
        {
          "role": "body",
          "text": "Gouache, ink, two colour risograph"
        },
        {
          "role": "label",
          "text": "Takes on"
        },
        {
          "role": "body",
          "text": "Editorial spots, book covers, picture books, packaging"
        },
        {
          "role": "label",
          "text": "Turnaround"
        },
        {
          "role": "body",
          "text": "Spot illustrations in five working days, covers in three to four weeks"
        }
      ]
    },
    {
      "id": "plate-08",
      "purpose": "A second full-bleed feature image between the biography and the commissions section.",
      "layout": "Full viewport width, aspect 4/5, 16/9 from 768px, 21/9 from 1280px, clip-path wipe on scroll, mono caption inside page margins.",
      "copy": [
        {
          "role": "label",
          "text": "Plate 08"
        },
        {
          "role": "body",
          "text": "Allotment, late summer. Gouache and ink, 48 x 27 cm, 2024."
        }
      ]
    },
    {
      "id": "commissions",
      "purpose": "Get a brief sent by email.",
      "layout": "Full-width ink band (bg-foreground, text-background), 80px top margin (128px at lg). Inside max-w-page with 80px / 128px padding: 12 columns at lg, pitch in columns 1 to 6 with the email set large in Bodoni (24px, text-quote from 640px), two 48px buttons and a status line; the brief checklist in columns 8 to 12 as a numbered list under 1px inverse-border rules.",
      "copy": [
        {
          "role": "label",
          "text": "Commissions"
        },
        {
          "role": "heading",
          "text": "Booking from September."
        },
        {
          "role": "body",
          "text": "Send a short brief with the deadline, the printed size and where the picture will appear. Replies go out within two working days with a quote and a rough schedule."
        },
        {
          "role": "link",
          "text": "studio@inesmarlow.example"
        },
        {
          "role": "button",
          "text": "Email the studio"
        },
        {
          "role": "button",
          "text": "Copy address"
        },
        {
          "role": "status",
          "text": "Copying"
        },
        {
          "role": "status",
          "text": "Address copied"
        },
        {
          "role": "status",
          "text": "Copy failed. Select the address above instead."
        },
        {
          "role": "heading",
          "text": "What to put in the brief"
        },
        {
          "role": "body",
          "text": "The deadline and the file format you need"
        },
        {
          "role": "body",
          "text": "The printed size, including any bleed"
        },
        {
          "role": "body",
          "text": "Where the picture will run, and for how long"
        },
        {
          "role": "body",
          "text": "Two or three references, if you have them"
        },
        {
          "role": "body",
          "text": "The address above is a placeholder. Swap it for a real inbox before publishing."
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Credit line, placeholder notice and a way back up.",
      "layout": "max-w-page, 40px vertical padding, 1px foreground rule; stacked below 768px, three items in a row from 768px.",
      "copy": [
        {
          "role": "label",
          "text": "© 2025 Ines Marlow (year from the visitor's clock)"
        },
        {
          "role": "body",
          "text": "Ines Marlow is a placeholder name. The plates are drawn in code as stand-ins for scanned artwork; replace both with your own."
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
        "From 640px the masthead name and nav share one row, justified between",
        "From 640px the email address grows from text-title (24px) to text-quote",
        "From 640px the about facts strip becomes 2 columns and dialog padding grows to 32px"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "From 768px the tagline Illustration and picture books appears beside the name",
        "From 768px the gallery becomes 2 columns",
        "From 768px feature plates change from aspect 4/5 to 16/10 (Plate 01) and 16/9 (Plate 08)",
        "From 768px the footer lays out in one row"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "From 1024px the hero deck and actions move to columns 8 to 12",
        "From 1024px the gallery becomes a 12 column grid with spans 7/5/4/8/5/7/6/6 and staggered top offsets",
        "From 1024px the 08 numeral appears in columns 8 to 12 and rises above the section rule",
        "From 1024px the pull quote starts at column 3, the about body sets in two columns, the plate dialog splits into image and notes, and commissions splits 6 / 5 columns",
        "Section padding grows from 80px to 128px"
      ]
    },
    {
      "maxWidth": 1280,
      "changes": [
        "From 1280px both feature plates widen to aspect 21/9",
        "From 1280px the about facts strip becomes 4 columns"
      ]
    }
  ],
  "do": [
    "Set every headline in Bodoni Moda 400 at text-display, text-headline or text-quote with negative tracking; body copy stays Newsreader 18px with 1.65 line height and 0 tracking.",
    "Limit motion to opacity with scale 0.98 to 1 over 500ms on cubic-bezier(0.23, 1, 0.32, 1); only full-bleed plates wipe, clip-path inset(0% 100% 0% 0%) to inset(0% 0% 0% 0%) over 600ms.",
    "Run feature plates edge to edge with radius plate (0px) and caption them in IBM Plex Mono 14px, prefixed Plate NN.",
    "Use primary #a8341a only for the primary button, the 08 numeral, the drop cap, link underlines, hover titles and focus rings.",
    "Hang every block on the 12 column grid inside max-w-page (1440px) with page-margin clamp(1.25rem, 4vw, 4rem) and a 24px gutter."
  ],
  "avoid": [
    "Rounded thumbnails or card shadows in the gallery: plates read as printed pages, so radius stays 0px and shadow-plate appears only on the open dialog.",
    "Animating body paragraphs or adding slide offsets: the direction allows opacity and a 0.98 scale, and moving text breaks the magazine reading pace.",
    "A contact form with fields: there is no backend, and the mailto link plus copy button send a brief without a fake submit.",
    "Client logos, testimonials or named clients: none were supplied, and the footer already marks the name and plates as placeholders.",
    "A sans serif display face: Bodoni Moda's thick and thin strokes carry the editorial voice, and a grotesque would flatten it into a template."
  ],
  "checks": [
    "At 1440px the headline Small worlds, painted slowly. renders in Bodoni Moda at 128px across the full content width on two lines.",
    "The Night ferry plate runs to both edges of the viewport and wipes in from left to right on load.",
    "Selecting the Books tab shows exactly two plates, and the tab reads Books 2.",
    "Clicking a plate opens a dialog with its title, medium, size, year and note; Escape closes it and focus returns to the plate button.",
    "Pressing ArrowRight in the open dialog shows the next plate and the counter reads 2 of 8.",
    "Pressing Copy address shows Address copied with a check icon beside it.",
    "With reduced motion turned on, plates fade in without the clip-path wipe.",
    "At 375px nothing scrolls sideways and the email address wraps inside the viewport.",
    "The footer says Ines Marlow is a placeholder name."
  ]
}
---

# Design

A portfolio for a freelance gouache and ink illustrator, aimed at art directors and publishers, whose single job is to get them to look closely at the plates and then email a brief.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Set every headline in Bodoni Moda 400 at text-display, text-headline or text-quote with negative tracking; body copy stays Newsreader 18px with 1.65 line height and 0 tracking.
- Limit motion to opacity with scale 0.98 to 1 over 500ms on cubic-bezier(0.23, 1, 0.32, 1); only full-bleed plates wipe, clip-path inset(0% 100% 0% 0%) to inset(0% 0% 0% 0%) over 600ms.
- Run feature plates edge to edge with radius plate (0px) and caption them in IBM Plex Mono 14px, prefixed Plate NN.
- Use primary #a8341a only for the primary button, the 08 numeral, the drop cap, link underlines, hover titles and focus rings.
- Hang every block on the 12 column grid inside max-w-page (1440px) with page-margin clamp(1.25rem, 4vw, 4rem) and a 24px gutter.

## Don't

- Rounded thumbnails or card shadows in the gallery: plates read as printed pages, so radius stays 0px and shadow-plate appears only on the open dialog.
- Animating body paragraphs or adding slide offsets: the direction allows opacity and a 0.98 scale, and moving text breaks the magazine reading pace.
- A contact form with fields: there is no backend, and the mailto link plus copy button send a brief without a fake submit.
- Client logos, testimonials or named clients: none were supplied, and the footer already marks the name and plates as placeholders.
- A sans serif display face: Bodoni Moda's thick and thin strokes carry the editorial voice, and a grotesque would flatten it into a template.

## Checks

- At 1440px the headline Small worlds, painted slowly. renders in Bodoni Moda at 128px across the full content width on two lines.
- The Night ferry plate runs to both edges of the viewport and wipes in from left to right on load.
- Selecting the Books tab shows exactly two plates, and the tab reads Books 2.
- Clicking a plate opens a dialog with its title, medium, size, year and note; Escape closes it and focus returns to the plate button.
- Pressing ArrowRight in the open dialog shows the next plate and the counter reads 2 of 8.
- Pressing Copy address shows Address copied with a check icon beside it.
- With reduced motion turned on, plates fade in without the clip-path wipe.
- At 375px nothing scrolls sideways and the email address wraps inside the viewport.
- The footer says Ines Marlow is a placeholder name.
