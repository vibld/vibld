---
{
  "intent": "A site for Fernbank Dental, a small family practice in Millbrook, that lets local patients check when it is open, see what it treats and find their way to the door.",
  "tokens": {
    "colors": [
      {
        "name": "background",
        "value": "#f3efe6",
        "use": "Paper page background under the grain texture"
      },
      {
        "name": "foreground",
        "value": "#2b2a22",
        "use": "Bark body and heading text"
      },
      {
        "name": "card",
        "value": "#faf7f0",
        "use": "Cards, dialog surface, map roads"
      },
      {
        "name": "card-foreground",
        "value": "#2b2a22",
        "use": "Text on cards"
      },
      {
        "name": "popover",
        "value": "#faf7f0",
        "use": "Popover surface (shadcn default)"
      },
      {
        "name": "popover-foreground",
        "value": "#2b2a22",
        "use": "Text on popovers"
      },
      {
        "name": "primary",
        "value": "#4f6446",
        "use": "Moss green buttons, logo mark, map pin, icons"
      },
      {
        "name": "primary-foreground",
        "value": "#f6f3ea",
        "use": "Text and icons on primary"
      },
      {
        "name": "primary-hover",
        "value": "#3f5238",
        "use": "Hover and pressed fill of primary buttons"
      },
      {
        "name": "secondary",
        "value": "#e4dccb",
        "use": "Sand fills: icon blobs, emergency card, map ground, footer"
      },
      {
        "name": "secondary-foreground",
        "value": "#3b3a2f",
        "use": "Text on secondary"
      },
      {
        "name": "muted",
        "value": "#e9e3d6",
        "use": "Demonstration and placeholder notes"
      },
      {
        "name": "muted-foreground",
        "value": "#5f5b4c",
        "use": "Secondary text on paper, card and sand"
      },
      {
        "name": "accent",
        "value": "#c9d2bb",
        "use": "Sage pale fill for the hero label, check-ups card, travel icons"
      },
      {
        "name": "accent-foreground",
        "value": "#2f3b2a",
        "use": "Text on accent"
      },
      {
        "name": "destructive",
        "value": "#9b3b2e",
        "use": "Form validation messages and invalid field borders"
      },
      {
        "name": "border",
        "value": "#d8cfbd",
        "use": "Card, header and table hairlines"
      },
      {
        "name": "input",
        "value": "#8f8570",
        "use": "Form field borders (3.2:1 on paper)"
      },
      {
        "name": "ring",
        "value": "#4f6446",
        "use": "2px focus outline"
      },
      {
        "name": "sage",
        "value": "#a9b79a",
        "use": "Hero blob, canal on map, 19:30 numeral and labels on forest"
      },
      {
        "name": "clay",
        "value": "#8f5b3e",
        "use": "Italic headline phrase, eyebrow labels, clay blobs"
      },
      {
        "name": "bark",
        "value": "#6b5443",
        "use": "Small decorative blobs and map station block"
      },
      {
        "name": "forest",
        "value": "#2f3b2a",
        "use": "Opening hours panel background"
      },
      {
        "name": "forest-foreground",
        "value": "#eef0e6",
        "use": "Text on the forest panel"
      },
      {
        "name": "forest-muted",
        "value": "#bfc6b4",
        "use": "Secondary text on the forest panel (6.7:1)"
      },
      {
        "name": "glow",
        "value": "rgba(169, 183, 154, 0.45)",
        "use": "Cursor spotlight in the hero"
      },
      {
        "name": "scrim",
        "value": "rgba(43, 42, 34, 0.45)",
        "use": "Dialog overlay"
      },
      {
        "name": "mesh-sage",
        "value": "rgba(169, 183, 154, 0.35)",
        "use": "First stop of the drifting hero mesh"
      },
      {
        "name": "mesh-clay",
        "value": "rgba(143, 91, 62, 0.14)",
        "use": "Second stop of the drifting hero mesh"
      },
      {
        "name": "shadow-ink",
        "value": "rgba(59, 52, 36, 0.28)",
        "use": "Colour of the soft card shadow"
      }
    ],
    "fonts": [
      {
        "role": "display",
        "family": "Fraunces",
        "fallback": "\"Iowan Old Style\", Georgia, serif",
        "weights": [
          400,
          500,
          600
        ]
      },
      {
        "role": "body",
        "family": "Figtree",
        "fallback": "ui-sans-serif, system-ui, sans-serif",
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
        "size": "clamp(2.75rem, 1.5rem + 5.4vw, 6.5rem)",
        "lineHeight": "0.98",
        "letterSpacing": "-0.03em"
      },
      {
        "name": "heading",
        "size": "clamp(2.25rem, 1.6rem + 2.6vw, 4rem)",
        "lineHeight": "1.04",
        "letterSpacing": "-0.025em"
      },
      {
        "name": "numeral",
        "size": "clamp(5.5rem, 2rem + 10vw, 11rem)",
        "lineHeight": "0.85",
        "letterSpacing": "-0.05em"
      },
      {
        "name": "title",
        "size": "1.5rem",
        "lineHeight": "1.2",
        "letterSpacing": "-0.01em"
      },
      {
        "name": "lede",
        "size": "1.25rem",
        "lineHeight": "1.6",
        "letterSpacing": "-0.005em"
      },
      {
        "name": "body",
        "size": "1.0625rem",
        "lineHeight": "1.65",
        "letterSpacing": "0em"
      },
      {
        "name": "small",
        "size": "0.9375rem",
        "lineHeight": "1.5",
        "letterSpacing": "0.01em"
      }
    ],
    "space": [
      {
        "name": "gutter",
        "value": "24px (px-6)"
      },
      {
        "name": "gutter-lg",
        "value": "48px (lg:px-12)"
      },
      {
        "name": "section",
        "value": "80px (py-20)"
      },
      {
        "name": "section-lg",
        "value": "128px (lg:py-32)"
      },
      {
        "name": "content",
        "value": "1200px (max-w-300)"
      },
      {
        "name": "hours-panel",
        "value": "1320px (max-w-330)"
      },
      {
        "name": "prose",
        "value": "36rem (max-w-xl)"
      }
    ],
    "radii": [
      {
        "name": "blob",
        "value": "62% 38% 54% 46% / 48% 58% 42% 52%"
      },
      {
        "name": "organic",
        "value": "2.5rem 1.5rem 2.75rem 1.75rem"
      },
      {
        "name": "organic-alt",
        "value": "1.5rem 2.75rem 1.75rem 2.5rem"
      },
      {
        "name": "organic-lg",
        "value": "4.5rem 2.5rem 5rem 3rem"
      },
      {
        "name": "pill",
        "value": "9999px"
      },
      {
        "name": "field",
        "value": "1rem"
      }
    ],
    "effects": [
      {
        "name": "grain",
        "value": "url(data:image/svg+xml feTurbulence fractalNoise baseFrequency 0.85, 3 octaves, alpha 0.14, 180px tile) repeated over body, hero blob and map"
      },
      {
        "name": "hero-mesh",
        "value": "radial-gradient(60% 50% at 20% 30%, var(--mesh-sage), transparent 70%), radial-gradient(50% 45% at 80% 70%, var(--mesh-clay), transparent 70%) at background-size 200% 200%"
      },
      {
        "name": "drift",
        "value": "background-position 0% 0% to 100% 100%, 32s ease-in-out infinite alternate"
      },
      {
        "name": "breathe",
        "value": "scale 0.98 to 1.02 and rotate -2deg to 2deg, 3.2s to 4s easeInOut loop on every blob"
      },
      {
        "name": "soft-shadow",
        "value": "0 24px 48px -24px var(--shadow-ink)"
      },
      {
        "name": "spotlight",
        "value": "480px circle of var(--glow) with blur(64px), follows the pointer through a spring (stiffness 300, damping 35)"
      },
      {
        "name": "header-glass",
        "value": "background rgba of --background at 85%, backdrop-filter blur(12px), 1px border at 70% --border"
      },
      {
        "name": "ease-organic",
        "value": "cubic-bezier(0.23, 1, 0.32, 1), 300 to 500ms on hovers, reveals and color changes"
      }
    ]
  },
  "sections": [
    {
      "id": "header",
      "purpose": "Brand, section links and a direct call button",
      "layout": "Sticky, max 1200px, 24px gutter (48px at lg), 12px vertical padding, glass fill. Logo left, call button right; links wrap to a full-width second row below md and sit inline at md with 32px gaps. Every link is at least 44px tall.",
      "copy": [
        {
          "role": "link",
          "text": "Skip to content"
        },
        {
          "role": "link",
          "text": "Fernbank Dental"
        },
        {
          "role": "link",
          "text": "Services"
        },
        {
          "role": "link",
          "text": "Hours"
        },
        {
          "role": "link",
          "text": "Directions"
        },
        {
          "role": "button",
          "text": "Call"
        },
        {
          "role": "button",
          "text": "01632 960418"
        }
      ]
    },
    {
      "id": "hero",
      "purpose": "Say what the practice is and offer the appointment request",
      "layout": "Split 1.05fr / 0.95fr at lg, stacked below; max 1200px, 48px top and 80px bottom padding (80/128 at lg). Left column left aligned, lede max 36rem. Right: a square composition up to 512px of four breathing blobs with an emergency note top left and a live status card bottom right. Drifting mesh behind, cursor spotlight on fine pointers, 90px parallax on the composition.",
      "copy": [
        {
          "role": "label",
          "text": "Family and general dentistry in Millbrook"
        },
        {
          "role": "heading",
          "text": "Calm dentistry, at a gentler pace."
        },
        {
          "role": "body",
          "text": "Fernbank Dental is a small practice with four surgeries on Fernbank Road. Standard appointments are 30 minutes long, so there is time to ask questions, and time to stop if you need a break."
        },
        {
          "role": "button",
          "text": "Request an appointment"
        },
        {
          "role": "button",
          "text": "Opening hours"
        },
        {
          "role": "body",
          "text": "New patients welcome, adults and children."
        },
        {
          "role": "body",
          "text": "Emergency slots every weekday morning"
        },
        {
          "role": "label",
          "text": "Today at Fernbank"
        },
        {
          "role": "status",
          "text": "Open now"
        },
        {
          "role": "status",
          "text": "Closed now"
        },
        {
          "role": "status",
          "text": "Until {close} today"
        },
        {
          "role": "status",
          "text": "Opens today at {open}"
        },
        {
          "role": "status",
          "text": "Opens tomorrow at {open}"
        },
        {
          "role": "status",
          "text": "Opens {day} at {open}"
        },
        {
          "role": "link",
          "text": "Call 01632 960418"
        }
      ]
    },
    {
      "id": "services",
      "purpose": "List the treatments with typical appointment lengths",
      "layout": "Max 1200px, 80px vertical padding (128 at lg). Header grid 0.8fr / 1.2fr at lg with the lede aligned right. Bento grid, 20px gaps: 1 column, 2 at md, 3 at lg; check-ups and emergency span 2 columns, whitening spans 2 at md only. Cards alternate organic and organic-alt radii, 28px padding (36 at sm).",
      "copy": [
        {
          "role": "label",
          "text": "Services"
        },
        {
          "role": "heading",
          "text": "What we do"
        },
        {
          "role": "body",
          "text": "General care for the whole family, plus the treatments most people need at some point. If you are not sure which appointment to book, ask for a check-up and we will plan the rest from there."
        },
        {
          "role": "heading",
          "text": "Check-ups and hygiene"
        },
        {
          "role": "body",
          "text": "An examination, a scale and polish, and a plain explanation of what we found. We take X-rays when there is a reason to, usually every one to two years."
        },
        {
          "role": "label",
          "text": "30 minutes"
        },
        {
          "role": "heading",
          "text": "Fillings"
        },
        {
          "role": "body",
          "text": "White composite fillings, matched to the shade of your own teeth."
        },
        {
          "role": "label",
          "text": "30 to 60 minutes"
        },
        {
          "role": "heading",
          "text": "Root canal treatment"
        },
        {
          "role": "body",
          "text": "Done over one or two visits with local anaesthetic, with a review a week later."
        },
        {
          "role": "label",
          "text": "60 to 90 minutes"
        },
        {
          "role": "heading",
          "text": "Crowns and bridges"
        },
        {
          "role": "body",
          "text": "Made from a digital scan of your teeth, so there are no putty impressions."
        },
        {
          "role": "label",
          "text": "Two visits"
        },
        {
          "role": "heading",
          "text": "Children's dentistry"
        },
        {
          "role": "body",
          "text": "Short first visits for under fives: sit in the chair, count some teeth, go home with a sticker."
        },
        {
          "role": "label",
          "text": "20 minutes"
        },
        {
          "role": "heading",
          "text": "Emergency appointments"
        },
        {
          "role": "body",
          "text": "We keep slots free every weekday morning for pain, swelling and broken teeth. Phone from 08:00 and we will fit you in that day."
        },
        {
          "role": "label",
          "text": "Same day, Monday to Friday"
        },
        {
          "role": "heading",
          "text": "Whitening"
        },
        {
          "role": "body",
          "text": "Custom trays for whitening at home, once a check-up shows your teeth and gums are healthy."
        },
        {
          "role": "label",
          "text": "Two visits"
        }
      ]
    },
    {
      "id": "hours",
      "purpose": "Show the weekly hours and whether the practice is open right now",
      "layout": "Forest panel, max 1320px, 12px outer inset (24 at sm), organic-lg radius, 56px by 24px padding (64/48 at sm, 96/80 at lg). Two columns 1fr / 1.1fr at lg: heading, live status pill and the oversized 19:30 numeral left; table and notes right. Two breathing blobs sit behind.",
      "copy": [
        {
          "role": "label",
          "text": "Hours"
        },
        {
          "role": "heading",
          "text": "Opening hours"
        },
        {
          "role": "status",
          "text": "Open now"
        },
        {
          "role": "status",
          "text": "Closed now"
        },
        {
          "role": "heading",
          "text": "19:30"
        },
        {
          "role": "body",
          "text": "Wednesday late clinic, for appointments after work."
        },
        {
          "role": "label",
          "text": "Weekly opening hours"
        },
        {
          "role": "label",
          "text": "Day"
        },
        {
          "role": "label",
          "text": "Hours"
        },
        {
          "role": "body",
          "text": "Monday"
        },
        {
          "role": "body",
          "text": "Tuesday"
        },
        {
          "role": "body",
          "text": "Wednesday"
        },
        {
          "role": "body",
          "text": "Thursday"
        },
        {
          "role": "body",
          "text": "Friday"
        },
        {
          "role": "body",
          "text": "Saturday"
        },
        {
          "role": "body",
          "text": "Sunday"
        },
        {
          "role": "body",
          "text": "08:00–18:00"
        },
        {
          "role": "body",
          "text": "08:00–19:30"
        },
        {
          "role": "body",
          "text": "08:00–16:00"
        },
        {
          "role": "body",
          "text": "09:00–13:00"
        },
        {
          "role": "body",
          "text": "Closed"
        },
        {
          "role": "label",
          "text": "Late clinic"
        },
        {
          "role": "label",
          "text": "Check-ups and hygiene only"
        },
        {
          "role": "label",
          "text": "Today"
        },
        {
          "role": "body",
          "text": "Reception answers the phone from 08:00 on weekdays and 09:00 on Saturdays."
        },
        {
          "role": "body",
          "text": "Out of hours with severe pain or swelling, call NHS 111."
        },
        {
          "role": "body",
          "text": "Open and closed status uses the time on your device."
        }
      ]
    },
    {
      "id": "directions",
      "purpose": "Give the address and how to arrive by each mode",
      "layout": "Max 1200px, 80px vertical padding (128 at lg). Split 1.05fr / 0.95fr at lg: an illustrated blob map (5:4) left, pulled 64px left, unmasking top to bottom; details right. Travel list 1 column, 2 at sm, 24px gaps.",
      "copy": [
        {
          "role": "label",
          "text": "Directions"
        },
        {
          "role": "heading",
          "text": "Finding us"
        },
        {
          "role": "body",
          "text": "Fernbank Dental"
        },
        {
          "role": "body",
          "text": "14 Fernbank Road"
        },
        {
          "role": "body",
          "text": "Millbrook MB3 2LT"
        },
        {
          "role": "button",
          "text": "Open in OpenStreetMap"
        },
        {
          "role": "button",
          "text": "Call 01632 960418"
        },
        {
          "role": "heading",
          "text": "By bus"
        },
        {
          "role": "body",
          "text": "Routes 12 and 40 stop outside the library on Fernbank Road, a two minute walk from our door."
        },
        {
          "role": "heading",
          "text": "By car"
        },
        {
          "role": "body",
          "text": "Four free spaces behind the building, including one wide bay. Alder Lane has free street parking after 10:00."
        },
        {
          "role": "heading",
          "text": "By train"
        },
        {
          "role": "body",
          "text": "Millbrook station is a 12 minute walk along the canal path. Turn right at the footbridge."
        },
        {
          "role": "heading",
          "text": "Access"
        },
        {
          "role": "body",
          "text": "Step-free entrance and a ground floor surgery. Mention it when you book and we will put you in that room."
        },
        {
          "role": "status",
          "text": "Sample address, phone number and travel details. Replace them with the practice's own before publishing."
        },
        {
          "role": "label",
          "text": "Alder Lane"
        },
        {
          "role": "label",
          "text": "Fernbank Road"
        },
        {
          "role": "label",
          "text": "Canal path"
        },
        {
          "role": "label",
          "text": "Library"
        },
        {
          "role": "label",
          "text": "Station"
        }
      ]
    },
    {
      "id": "footer",
      "purpose": "Repeat contact details",
      "layout": "Sand band, max 1200px, 56px vertical padding; 1 column, 3 columns (1.4fr 1fr 1fr) at md; copyright row below a hairline.",
      "copy": [
        {
          "role": "heading",
          "text": "Fernbank Dental"
        },
        {
          "role": "body",
          "text": "Family and general dentistry on Fernbank Road, Millbrook."
        },
        {
          "role": "heading",
          "text": "Visit"
        },
        {
          "role": "heading",
          "text": "Contact"
        },
        {
          "role": "link",
          "text": "01632 960418"
        },
        {
          "role": "link",
          "text": "hello@fernbankdental.example"
        },
        {
          "role": "body",
          "text": "© {year} Fernbank Dental. Demonstration site with sample details."
        }
      ]
    },
    {
      "id": "booking-dialog",
      "purpose": "Collect an appointment request (demonstration only)",
      "layout": "shadcn Dialog on Radix, max 32rem, organic radius, 24px padding (32 at sm), scrim overlay; form and success views cross fade through AnimatePresence.",
      "copy": [
        {
          "role": "heading",
          "text": "Request an appointment"
        },
        {
          "role": "body",
          "text": "Tell us who you are and what you need. Reception will call you back to agree a time."
        },
        {
          "role": "status",
          "text": "This form is a demonstration and does not send anything yet. To book today, call 01632 960418."
        },
        {
          "role": "label",
          "text": "Full name"
        },
        {
          "role": "label",
          "text": "Phone number"
        },
        {
          "role": "label",
          "text": "What is the appointment for? (optional)"
        },
        {
          "role": "placeholder",
          "text": "For example: a check-up, or a filling that has come loose"
        },
        {
          "role": "status",
          "text": "Please enter your name."
        },
        {
          "role": "status",
          "text": "Please enter a phone number we can call, with the area code."
        },
        {
          "role": "button",
          "text": "Send request"
        },
        {
          "role": "status",
          "text": "Sending request"
        },
        {
          "role": "heading",
          "text": "Request noted"
        },
        {
          "role": "body",
          "text": "In the live version, reception would call you back within one working day. Nothing was sent from this demonstration."
        },
        {
          "role": "button",
          "text": "Close"
        }
      ]
    }
  ],
  "breakpoints": [
    {
      "maxWidth": 640,
      "changes": [
        "Below 640: hero buttons stack full width; header call button reads 'Call'; travel list is one column; hours panel padding 24px",
        " At 640 (sm) and up: hero buttons sit in a row at natural width, the call button shows 01632 960418, travel list splits into 2 columns, hours panel padding 48px"
      ]
    },
    {
      "maxWidth": 768,
      "changes": [
        "At 768 (md) and up: nav links move into the header row between logo and call button",
        "Services grid becomes 2 columns, with check-ups, emergency and whitening spanning both",
        "Footer becomes 3 columns (1.4fr 1fr 1fr)"
      ]
    },
    {
      "maxWidth": 1024,
      "changes": [
        "At 1024 (lg) and up: hero splits 1.05fr / 0.95fr with the blob composition on the right",
        "Services header splits 0.8fr / 1.2fr; grid becomes 3 columns with check-ups and emergency spanning 2, whitening 1",
        "Hours panel becomes 1fr / 1.1fr with 80px side padding",
        "Directions splits 1.05fr / 0.95fr with the map pulled 64px left",
        "Gutter grows to 48px and section padding to 128px"
      ]
    }
  ],
  "do": [
    "Shape every decorative surface with the blob radius (62% 38% 54% 46% / 48% 58% 42% 52%) or the organic radii; rectangles are only for form fields",
    "Let every blob breathe between scale 0.98 and 1.02 on a 3.2 to 4s easeInOut loop",
    "Run hovers, reveals and colour changes at 300 to 500ms on cubic-bezier(0.23, 1, 0.32, 1)",
    "Keep the paper grain (alpha 0.14) on the body, hero blob and map",
    "Pair every open or closed state with an icon and the words 'Open now' or 'Closed now'"
  ],
  "avoid": [
    "Adding stock photography of smiles or clinics: the blobs and illustrated map carry the page and a photo would pull it back to a generic template",
    "Pure white (#ffffff) or saturated teal: both read as clinical and break the paper and moss palette",
    "A second booking form or pricing table: the one request dialog and the phone number are the ways to book, and prices would be invented",
    "Snappy spring bounces or anything faster than 300ms on decorative motion: the page is meant to feel calm",
    "Inventing reviews, ratings or dentist names: the practice supplied none, so the page would state things nobody has checked"
  ],
  "checks": [
    "At 1440px the hero headline 'Calm dentistry, at a gentler pace.' sits beside the blob composition, with 'at a gentler pace.' in clay italic",
    "The 'Today at Fernbank' card and the hours panel both show 'Open now' or 'Closed now' with an icon, and the detail matches the device clock",
    "Today's row in the hours table carries a 'Today' badge",
    "The appointment dialog says 'This form is a demonstration and does not send anything yet.'",
    "Submitting the empty form shows 'Please enter your name.' under Full name, with an alert icon",
    "A valid submit disables the button and shows a spinning loader with 'Sending request' before 'Request noted' appears",
    "The directions note says the address, phone number and travel details are samples",
    "At 375px there is no horizontal scroll and the 19:30 numeral fits inside the forest panel",
    "With reduced motion on, the blobs stop breathing, the mesh stops drifting and no cursor glow appears, while content still fades in"
  ]
}
---

# Design

A site for Fernbank Dental, a small family practice in Millbrook, that lets local patients check when it is open, see what it treats and find their way to the door.

The frontmatter above is this project's design spec: every colour, font, type step, space, radius and effect it uses, each section's copy verbatim, and what changes at each breakpoint. Change the spec and the code together.

## Do

- Shape every decorative surface with the blob radius (62% 38% 54% 46% / 48% 58% 42% 52%) or the organic radii; rectangles are only for form fields
- Let every blob breathe between scale 0.98 and 1.02 on a 3.2 to 4s easeInOut loop
- Run hovers, reveals and colour changes at 300 to 500ms on cubic-bezier(0.23, 1, 0.32, 1)
- Keep the paper grain (alpha 0.14) on the body, hero blob and map
- Pair every open or closed state with an icon and the words 'Open now' or 'Closed now'

## Don't

- Adding stock photography of smiles or clinics: the blobs and illustrated map carry the page and a photo would pull it back to a generic template
- Pure white (#ffffff) or saturated teal: both read as clinical and break the paper and moss palette
- A second booking form or pricing table: the one request dialog and the phone number are the ways to book, and prices would be invented
- Snappy spring bounces or anything faster than 300ms on decorative motion: the page is meant to feel calm
- Inventing reviews, ratings or dentist names: the practice supplied none, so the page would state things nobody has checked

## Checks

- At 1440px the hero headline 'Calm dentistry, at a gentler pace.' sits beside the blob composition, with 'at a gentler pace.' in clay italic
- The 'Today at Fernbank' card and the hours panel both show 'Open now' or 'Closed now' with an icon, and the detail matches the device clock
- Today's row in the hours table carries a 'Today' badge
- The appointment dialog says 'This form is a demonstration and does not send anything yet.'
- Submitting the empty form shows 'Please enter your name.' under Full name, with an alert icon
- A valid submit disables the button and shows a spinning loader with 'Sending request' before 'Request noted' appears
- The directions note says the address, phone number and travel details are samples
- At 375px there is no horizontal scroll and the 19:30 numeral fits inside the forest panel
- With reduced motion on, the blobs stop breathing, the mesh stops drifting and no cursor glow appears, while content still fades in
