# The vibld brand

The direction is **Signal**: one vermilion signal on graphite and chalk. Chris
chose it on 2026-09-27 from the approved "Live Build" mockup, replacing
**Offset** (coral and ultramarine on newsprint, chosen 2026-09-16). Signal
kept Offset's mark, one chevron printed twice out of register, and changed
only its inks.

Everything below that can be checked is checked. The palette lives in
`packages/brand/src/palette.ts` and its tests recompute every contrast figure
quoted here using this repository's own checker (`@vibld/ai`'s
`contrastRatio`), the one already used on model output. A brand guide whose
numbers nothing recomputes is a brand guide that goes stale quietly.

## The inks

| Ink       | oklch                     | hex       | What it is                                         |
| --------- | ------------------------- | --------- | -------------------------------------------------- |
| Vermilion | `oklch(0.666 0.224 34.3)` | `#ff4a1c` | The ghost impression, and the fill                 |
| Graphite  | `oklch(0.191 0.009 264)`  | `#121418` | The text ink on light, the mark's stroke, the tile |
| Chalk     | `oklch(0.966 0.004 106)`  | `#f4f4f1` | The stock everything prints on                     |

Each oklch triple lands exactly on the mockup's hex through `oklchToHex`.

The rest of each theme:

| Token           | Light               | Dark                |
| --------------- | ------------------- | ------------------- |
| `paper`         | Chalk `#f4f4f1`     | `#0e0f11`           |
| `surface`       | `#ffffff`           | `#16181b`           |
| `surfaceStrong` | `#ecede8`           | `#1d2024`           |
| `ink`           | Graphite `#121418`  | `#eeeee9`           |
| `inkMuted`      | `#4a4f57`           | `#a9adb3`           |
| `accent`        | Vermilion `#ff4a1c` | Vermilion `#ff4a1c` |
| `onAccent`      | `#140a06`           | `#140a06`           |
| `accentInk`     | `#c2310d`           | `#ff8260`           |
| `markInk`       | Graphite `#121418`  | `#eeeee9`           |
| `markOffset`    | Vermilion           | Vermilion           |
| `markBlend`     | `multiply`          | `screen`            |

And what they measure, every one a pairing the palette test walks:

| Pairing                          | Light | Dark  |
| -------------------------------- | ----- | ----- |
| Body text on paper               | 16.73 | 16.48 |
| Body text on surface             | 18.44 | 15.28 |
| Body text on the raised surface  | 15.67 | 14.05 |
| Muted text on paper              | 7.48  | 8.51  |
| Muted text on surface            | 8.24  | 7.89  |
| Muted text on the raised surface | 7.01  | 7.25  |
| A link on paper                  | 5.10  | 7.87  |
| Text on a vermilion fill         | 5.81  | 5.81  |
| The mark's load-bearing stroke   | 16.73 | 16.48 |

## The rule that catches everybody

**Vermilion cannot carry text.** Against chalk it measures **3.05**. That
clears the large-text bar (3.0) by five hundredths and fails the normal-text
bar (4.5), which is the worst kind of number: it looks fine in a mockup and
fails the first time a heading wraps, a monitor runs bright or the heading
lands on the raised surface instead, where it measures 2.86 and fails both.
It is the most recognizable color in the system and the one nobody may set a
heading, a link or a label in, at any size.

The refusals that follow from it, all enforced by tests rather than by
convention:

- Vermilion text on chalk: 3.05. On the raised surface: 2.86. Use the accent
  ink, `#c2310d` (5.10) on light or `#ff8260` (7.87) on dark.
- White text on a vermilion fill: 3.36. Chalk: 3.05. Text on vermilion is
  always `#140a06` (5.81).
- The theme's own ink on a vermilion fill. It is graphite in light mode and
  looks safe, and in dark mode it is `#eeeee9` on a fill that does not change:
  2.89. Muted ink on vermilion is 2.45 in light mode already.
- The light link ink left unflipped on the dark ground: 3.41. The dark link
  ink leaked into the light theme: 2.21 on chalk.

**Every focus indicator takes the accent ink, never the accent.** Every one:
a control that replaces the global ring with its own border and halo has to
clear the same bar on its own, and the prompt input's override did not. An
alpha ramp of the accent does not help, it makes it worse: vermilion at 64%
and 16% composites to 2.17:1 and 1.21:1 on chalk (the previous coral managed
1.87:1 and 1.16:1).

**The focus ring takes the accent ink, never the accent.** A focus indicator
exists to be seen, which is the one job vermilion cannot be trusted with:
3.05 against chalk clears the 3:1 bar for a non-text indicator by a margin
no display keeps, and 2.86 against the raised surface does not clear it at
all. The accent ink measures 4.77 on the raised surface and more everywhere
else. Pointing the ring at the accent when the previous direction landed
quietly halved the contrast of every keyboard focus ring in the product.

`apps/marketing/test/palette-use.test.ts` reads the source and fails the build
if any of these appears. It was written because all three were already
shipped: the consent banner's "Allow" button set its text color to
`--color-accent-contrast`, a token that never existed, so the one control
every visitor sees had no text color at all.

## The mark

One chevron, printed twice, the second impression two units down and right in
a 32-unit box, the pair blended with `mix-blend-mode: multiply` on light and
`screen` on dark.

**Vermilion is always the ghost.** That is what makes it the color people
recognize: it is the one that does not change. The other impression is the
stroke the shape's legibility actually rests on, and it changes with the
ground:

| Ground          | Load-bearing ink | Ratio |
| --------------- | ---------------- | ----- |
| Chalk           | Graphite         | 16.73 |
| Dark            | `#eeeee9`        | 16.48 |
| A graphite tile | Chalk            | 16.73 |

A mark drawn in vermilion alone is not a mark to rely on: 3.05 on chalk
clears the 3:1 non-text bar by a hair and 2.86 on the raised surface does
not. `packages/brand/test/mark.test.ts` asserts the ghost never reads more
strongly than the ink.

**Anywhere the mark sits on a fixed ground, override the blend as well as the
inks.** The builder's logo tile is graphite whatever the page theme is, so it
sets `--vibld-mark-ink` to chalk, `--vibld-mark-offset` to vermilion and
`--vibld-mark-blend` to `screen`. Without the last one it would inherit
`multiply` in light mode and multiply a near-white stroke into graphite,
giving the ground back. That is exactly what the previous direction's
ultramarine tile shipped with. Overriding the two inks without the blend is
the shape of that mistake.

The tile is graphite because the favicon's is, so the tab and the header are
the same picture. In light mode it reads as a solid block (16.73 on chalk);
in dark mode it measures 1.04 against the ground and sinks into it, leaving
the mark as the dark theme draws it.

### When the overprint cannot survive

Named when the mark was first chosen: transparency is thrown away by
monochrome favicon rendering and by some email clients, leaving a muddy single
shape. `mark-mono.svg` is the answer. It draws the load-bearing ink only
(graphite), never the ghost, and it is generated rather than hand-drawn so it
cannot drift from the real mark.

## The wordmark

`vibld`, lowercase, everywhere: page titles, the header, the middle of a
sentence, legal copy. The capitalized form survives in exactly one place,
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

- `favicon.svg`, the mark on a graphite tile: chalk stroke, vermilion ghost,
  `screen`
- `mark-mono.svg`, the single-ink fallback, in graphite
- `apple-touch-icon.png`, 180x180, the favicon's tile
- `favicon.ico`, the favicon's tile at 16, 32 and 48, for whatever asks for
  `/favicon.ico` by name
- `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` (full bleed, the
  mark scaled into the safe zone), named by `manifest.webmanifest`
- `bimi.svg`, the logo mail providers show beside vibld.com mail (D173): SVG
  Tiny Portable/Secure, full bleed, the mark scaled into the middle for the
  circle crop. The test also checks the profile's rules.
- `og-image.png`, 1200x630: graphite ground, the tiled mark's arrangement at
  scale, the wordmark in chalk (16.73), the tagline in the dark link ink
  (7.56), and a vermilion band along the foot. Vermilion would pass as text
  on graphite (5.49), and is still not used as text there: a rule with an
  exception for the one image every share carries is not a rule.

`apps/marketing/test/brand-assets.test.ts` regenerates the SVGs and the
manifest and fails if the committed files differ, so they cannot drift from
the palette. The icons and the manifest are written to app.vibld.com's
`apps/web/public/` too, and `apps/web/test/shell-brand.test.ts` checks both
hosts ship the same bytes.

**Never write `oklch()` into a file rendered outside a browser.** The first
social card the previous palette produced came out entirely black: librsvg,
which rasterises the PNGs, does not parse `oklch()` and falls back to black
rather than failing. Static assets use the `hex` field on each color, which
the palette test verifies against `oklchToHex`.

## Why one package

Before `@vibld/brand` existed, vibld.com shipped a warm orange chevron in
oklch and app.vibld.com shipped a purple-to-blue tilde in hsl. Two halves of
one product, two logos, two color systems, which is exactly what BRAND-01
(`docs/decisions.md`) forbids: searching "vibld" returns Bible-study sites, so
the only lever available is publishing one unambiguous entity everywhere.

Both apps now alias their existing token names onto `brand.css` rather than
declaring colors. That indirection is deliberate. It meant neither app had to
be rewritten to adopt the brand, it means there is exactly one place a color
is decided, and it is why moving from Offset to Signal changed no alias in
either app. Every theme token (`--vibld-paper`, `--vibld-accent`,
`--vibld-accent-ink` and the rest) kept its name and only its value moved;
the three named inks were renamed along with the inks themselves, to
`--vibld-vermilion`, `--vibld-graphite` and `--vibld-chalk`.
