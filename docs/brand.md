# The vibld brand

The direction is **Offset**: two flat inks overprinting slightly out of
register, the way risograph and cheap two-colour printing do. Chris chose it
on 2026-09-16 from six studies, along with its palette.

Everything below that can be checked is checked. The palette lives in
`packages/brand/src/palette.ts` and its tests recompute every contrast figure
quoted here using this repository's own checker (`@vibld/ai`'s
`contrastRatio`), the one already used on model output. A brand guide whose
numbers nothing recomputes is a brand guide that goes stale quietly.

## The inks

| Ink         | oklch                  | hex       | What it is                          |
| ----------- | ---------------------- | --------- | ----------------------------------- |
| Coral       | `oklch(0.7 0.18 25)`   | `#fa6863` | The ghost impression, and the fill  |
| Ultramarine | `oklch(0.45 0.16 265)` | `#284cac` | The text ink on light, and the tile |
| Newsprint   | `oklch(0.96 0.012 90)` | `#f5f2e9` | The stock everything prints on      |

## The rule that catches everybody

**Coral cannot carry text.** Against newsprint it measures **2.60**, which
fails the normal-text bar (4.5) and the large-text bar (3.0) alike. It is the
most recognisable colour in the system and the one nobody may set a heading,
a link or a label in.

Three refusals follow from it, all enforced by tests rather than by
convention:

- Coral text on newsprint: 2.60. Use ultramarine (6.90) on light, or the
  lightened coral `#ff8e86` (8.49) on dark.
- Newsprint or white text on a coral fill: 2.60. Text on coral is always ink
  (`#141a29`, 5.97).
- Ink on an ultramarine fill: 2.25. Text on ultramarine is newsprint (6.90).

**Every focus indicator takes the accent ink, never the accent.** Every one:
a control that replaces the global ring with its own border and halo has to
clear the same bar on its own, and the prompt input's override did not. An
alpha ramp of the accent does not help, it makes it worse: the accent at 64%
and 16% composites to roughly 1.87:1 and 1.16:1 on paper.

**The focus ring takes the accent ink, never the accent.** A focus indicator
exists to be seen, which is the one job coral cannot do: 2.60 against
newsprint is under the 3:1 bar for a non-text indicator. Pointing it at the
accent when the brand landed quietly halved the contrast of every keyboard
focus ring in the product.

`apps/marketing/test/palette-use.test.ts` reads the source and fails the build
if any of these appears. It was written because all three were already
shipped: the consent banner's "Allow" button set its text colour to
`--color-accent-contrast`, a token that never existed, so the one control
every visitor sees had no text colour at all.

## The mark

One chevron, printed twice, the second impression two units down and right in
a 32-unit box, the pair blended with `mix-blend-mode: multiply`.

**Coral is always the ghost.** That is what makes it the colour people
recognise: it is the one that does not change. The other impression is the
stroke the shape's legibility actually rests on, and it changes with the
ground:

| Ground                       | Load-bearing ink | Ratio |
| ---------------------------- | ---------------- | ----- |
| Newsprint                    | Ultramarine      | 6.90  |
| Dark, or an ultramarine tile | Newsprint        | 16.82 |

A mark drawn in coral alone is not a mark. `packages/brand/test/mark.test.ts`
asserts the ghost never reads more strongly than the ink.

**Anywhere the mark sits on a fixed ground, override the blend as well as the
inks.** The builder's logo tile is ultramarine whatever the page theme is, so
in light mode it inherited `multiply` and multiplied a near-white stroke into
ultramarine, giving the ground back. Overriding `--vibld-mark-ink` and
`--vibld-mark-offset` without `--vibld-mark-blend` is the shape of that
mistake.

### When the overprint cannot survive

Named when the direction was chosen: transparency is thrown away by
monochrome favicon rendering and by some email clients, leaving a muddy single
shape. `mark-mono.svg` is the answer. It draws the load-bearing ink only,
never the ghost, and it is generated rather than hand-drawn so it cannot drift
from the real mark.

## The wordmark

`vibld`, lowercase, everywhere: page titles, the header, the middle of a
sentence, legal copy. The capitalised form survives in exactly one place,
`SITE.legalName`, which feeds schema.org's `alternateName` so a search engine
can match the way people actually type it.

Set in Georgia, which is also the display face for headlines. There is no
webfont anywhere on the marketing site on purpose: the Cookie Notice
enumerates every third party the site contacts, and a font link would add one.

## The assets

All generated, none hand-drawn, by
`apps/marketing/scripts/brand-assets.ts`:

```
pnpm --filter @vibld/marketing brand:assets
```

- `favicon.svg`, the mark on an ultramarine tile
- `mark-mono.svg`, the single-ink fallback
- `apple-touch-icon.png`, 180x180
- `og-image.png`, 1200x630

`apps/marketing/test/brand-assets.test.ts` regenerates the SVGs and fails if
the committed files differ, so they cannot drift from the palette.

**Never write `oklch()` into a file rendered outside a browser.** The first
social card this palette produced came out entirely black: librsvg, which
rasterises the PNGs, does not parse `oklch()` and falls back to black rather
than failing. Static assets use the `hex` field on each colour, which the
palette test verifies against `oklchToHex`.

## Why one package

Before `@vibld/brand` existed, vibld.com shipped a warm orange chevron in
oklch and app.vibld.com shipped a purple-to-blue tilde in hsl. Two halves of
one product, two logos, two colour systems, which is exactly what BRAND-01
(`docs/decisions.md`) forbids: searching "vibld" returns Bible-study sites, so
the only lever available is publishing one unambiguous entity everywhere.

Both apps now alias their existing token names onto `brand.css` rather than
declaring colours. That indirection is deliberate. It meant neither app had to
be rewritten to adopt the brand, and it means there is exactly one place a
colour is decided.
