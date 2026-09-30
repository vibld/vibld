---
slug: nocturne
category: template
tone: dark
industry: [ai-tech, saas]
stack: [webgl, shaders, springs]
---

# Nocturne

Build **one self-contained HTML file** containing a complete landing page for
"Nocturne", a fictional observability product for AI agents.

## Intent

A near-black, confident SaaS page. Behind the hero, three thin ribbons of light
(indigo, cyan, lime) drift like oscilloscope traces, which suits a product
about seeing signals in the dark. The copy pairs a crisp grotesk with italic
serif accent words. Everything arrives on springs; nothing blinks or loops for
attention.

## Composition

1. **Floating pill nav**: brand dot, 4 links (hidden below 800px), primary CTA. Fixed, glass blur.
2. **Hero (100svh)**: WebGL ribbon canvas; "New" pill; h1 "See what your agents *actually* did." bottom-aligned; subtitle and two CTAs in a row beneath.
3. **Logo strip**: six fictional wordmarks between hairlines.
4. **Product**: kicker, h2, lede, and a 6-column bento grid (one wide card with a mini trace timeline and glow, one tall card, three small cards).
5. **Results**: three metrics that count up when scrolled into view.
6. **Pricing**: three plans; the middle plan is highlighted with an accent border.
7. **CTA panel**: rounded panel with an indigo glow rising from the bottom.
8. **Footer**.

## Look

Three-tier tokens: `--raw-*` primitives → semantic roles → components. No hex values outside `:root`.

| Semantic | Raw | Value |
|---|---|---|
| `--bg` | `--raw-ink-950` | #06070b |
| `--surface` / `--surface-2` | ink-900 / ink-800 | #0c0e15 / #151823 |
| `--border` | ink-700 | #232839 |
| `--fg` / `--fg-muted` / `--fg-subtle` | mist-100 / 400 / 500 | #eef1f8 / #9aa2b8 / #6d7590 |
| `--accent` / `-2` / `-3` | lime / cyan / indigo | #c6ff4d / #4de1ff / #3a2fd6 |

- Type: Geist 400/500/600; Instrument Serif italic for accent words. h1 `clamp(3rem, 9.5vw, 8.5rem)`, tracking −0.045em.

## Motion

A single spring integrator (k, c, dt-stepped) inside one rAF loop drives all of these:

| Element | Trigger | Behaviour | Spring |
|---|---|---|---|
| h1 words | load | Split into masked words; each rises from 110%, 70ms stagger | k=120 c=20 |
| `[data-reveal]` | IntersectionObserver, −12% bottom margin | Fade + rise 40px; 80ms stagger per batch | k=140 c=22 |
| Metrics | in view | Count from 0 to the value | k=30 c=11 (slight overshoot is fine) |
| Hero ribbons | always, while visible | 3 sine-sum curves with glow falloff; cursor parallax | exp lerp, rate 3/s |

## Constraints

- The hidden initial state is applied only once `.js` is on `<html>`, so content is visible with JS disabled.
- Split headline keeps an `aria-label` with the full sentence; word spans are `aria-hidden`.
- Reduced motion: no split, reveals show instantly, the canvas draws one frame.
- Hero canvas at 0.75 × min(dpr, 2), and it stops drawing when scrolled out of view.
- Semantic landmarks: `nav`, `main`, `section[aria-labelledby]`, `footer`.

## Deliverable

Return only the complete `index.html`, with no commentary.
