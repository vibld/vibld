---
slug: stacked-cards
category: section
tone: light
industry: [agency, saas, portfolio]
stack: [css-sticky, springs]
---

# Stacked Cards

Build **one self-contained HTML file** that renders the layer described below.

## Intent

A four-step "how we work" process in which each step is a large color card.
As you scroll, each card pins to the viewport, and the next card slides up over
it. The covered card sinks back: it scales down, lifts slightly and dims, so the
stack reads like physical paper. The section drops into any page.

## Composition

- Intro header (70svh) → the stack → footer (70svh), so the section is seen in context.
- Each card sits in a `position: sticky; top: 0; height: 100svh` wrapper; the card is centered at `min(1100px, 100%)` × `min(72svh, 640px)`.
- Card grid: a step number top-left, a large title spanning the bottom, and body copy in the right column.
- Below 768px: single column.

## Look

| Token | Value | Role |
|---|---|---|
| `--bg` | #eeece7 | page |
| `--card-1..4` | #1f3d2b, #c8553d, #2d4059, #e0b04a | card fills |
| `--on-card` | #fbf8f1 | text on dark cards (card 4 uses `--fg`) |
| `--radius` | 28px | card corner |

- Type: Manrope 800 for titles `clamp(2rem, 5vw, 4rem)`, 400 for body.

## Motion

| Element | Trigger | Behavior | Physics |
|---|---|---|---|
| Card *n* | scroll | Progress = how far card *n+1* has covered it (0→1). Scale down by up to 10%, translateY −3svh, black overlay → 35% (never fade the card itself, or the card beneath shows through) | spring k=180 c=26 per card |

Read positions with `getBoundingClientRect` inside the single rAF loop; write
only `transform` and the overlay's opacity (via a `--dim` custom property).

## Constraints

- Semantic: `<section aria-label>`; each card is an `<article>` with an `<h2>`.
- Reduced motion: sticky stacking stays, the springs do not run.

## Deliverable

Return only the complete `index.html`, with no commentary.
