# Luminous site template

A prerendered product site with a light-first look: warm paper, a cursor-reactive glow of ember, amber and teal behind the hero, one dark band for "how it works", and Schibsted Grotesk, Instrument Serif and JetBrains Mono for type. React Router in framework mode, React, TypeScript, Vite and Tailwind. Every declared route is rendered to HTML at build time, so the output is a folder of static files any host can serve.

The content is for **Emberline**, an invented customer-feedback product. Every name, plan, price and sample message in it is made up so that you can see the design with realistic copy; replace it with your own.

This is a conventional project. It has no dependency on Vibld, needs no account or runtime service, and there is no `.vibld/` directory. Copy it somewhere else and it still installs, builds and runs.

## Commands

```sh
npm install      # install dependencies
npm run dev      # development server with hot reload
npm run build    # prerender to build/client/
npm run preview  # serve the built site locally
npm run typecheck
npm test         # builds, then asserts on the emitted HTML and the palette
```

## What is where

| Path                           | What it holds                                                    |
| ------------------------------ | ---------------------------------------------------------------- |
| `app/site.ts`                  | Site name, routes, and per-page titles and descriptions          |
| `app/routes.ts`                | The route table React Router builds from                         |
| `app/routes/*.tsx`             | One file per page                                                |
| `app/plans.ts`                 | Plans and prices, shared by the home and pricing pages           |
| `app/components/`              | Header, footer, page heads, the hero's pieces and the band       |
| `app/components/GlowField.tsx` | The WebGL glow behind the home hero                              |
| `app/glow-palette.ts`          | The glow's colours and strength, read by the shader and the test |
| `app/app.css`                  | Tailwind entry point, the fonts, the palette and the components  |
| `public/fonts/`                | The self-hosted font files and their licence texts               |
| `react-router.config.ts`       | Prerendering configuration                                       |

**Start with `app/site.ts`.** Navigation, the prerender list and every page's metadata are derived from it, so adding a route there and in `app/routes.ts` is enough for it to appear in the nav, be prerendered, and get its own title, description and social card. There is no way to ship a page that the build forgot to render.

## Configuration

Copy `.env.example` to `.env` and set `VITE_SITE_URL` to the origin the site is actually served from. It builds absolute URLs for canonical links and social cards, which crawlers require to be absolute. The build falls back to `https://example.com` so a fresh clone works -- but a placeholder in a social card is a broken social card, so set it before going live.

## Replace the invented content

Before this goes live, go through:

- `app/site.ts`: the name, tagline and every page description.
- `app/plans.ts`: plan names, prices and terms. They are invented.
- `app/components/SampleInbox.tsx` and `HowItWorks.tsx`: the sample messages and themes. They are attributed to a plan, never to a named person, and labelled as samples on the page. Keep it that way: do not replace them with quotes attributed to real-sounding people unless those people said them.
- `app/components/SourceTiles.tsx`: the twelve integrations are kinds of tool (email, live chat, an issue tracker), not named products. Name the ones you really support.
- The footer in `app/components/SiteChrome.tsx`, which says the site is a demonstration.

The site deliberately has no customer logos, testimonials or usage figures. If you add social proof, make it real.

## The glow

The hero's light is drawn with WebGL, and it is decoration built to be skipped. The hero's CSS gradient is what everyone gets first; the canvas starts transparent and fades in only after it has drawn a frame. With JavaScript off, without WebGL, if the GPU context is lost, or when the reader asks for reduced motion, the static gradient is what they see, and nothing on the page depends on the glow. The loop pauses when the hero is off screen or the tab is hidden, and the canvas never takes pointer events.

To change its colours, edit `app/glow-palette.ts`. The contrast test reads the same file and checks the headline and lead against the most saturated colour the field can paint, so a change that makes text hard to read fails `npm test`.

## Colour and contrast

Every colour that text or a control edge sits on is a token in `app/app.css`, in a light block and a dark block (dark follows the reader's system setting). `test/contrast.test.ts` reads both blocks and measures each pairing the site uses with the WCAG 2 formula: 4.5:1 for text, 3:1 for large display text, control edges, focus rings and icons. If you add a colour, add it as a token and add its pairings to the test.

## The contact form is a demonstration

`app/routes/contact.tsx` renders a form that goes nowhere. It says so, in the prerendered HTML, above the fields. There is no backend in this template and it does not pretend otherwise.

To make it real, replace the `handleSubmit` handler with a request to whatever endpoint you use -- a form service, your own API, a serverless function -- and remove the notice at the same time. Removing the notice without wiring the endpoint is the one edit that turns an honest page into a dishonest one.

## Deploying

`npm run build` writes static files to `build/client/`. Upload that directory.

Each route is emitted as its own `index.html` (`/pricing` → `build/client/pricing/index.html`), so deep links work on any host that serves directory indexes -- which is nearly all of them, with no rewrite rules.

For unknown paths, point your host's 404 handler at `build/client/__spa-fallback.html`. It renders the "page not found" screen and lets a visitor navigate onwards rather than seeing the host's own error page.

## Tests

`npm test` builds the site and then reads the emitted HTML, because that is what a visitor actually receives. A passing compiler does not tell you that a crawler sees your content or that a static host can serve your deep links.

It checks that every declared route is prerendered and no others; that deep links are separate files; that each page has a unique title and description and a complete social card with absolute URLs; that headings and navigation are present without JavaScript; that the skip link precedes the navigation and every form field has a label; that the page is complete before any script runs, with the glow starting switched off; that nothing is loaded from another origin and every font is self-hosted; that every text colour meets its contrast ratio in both themes; and that nothing ties the project to Vibld.

Those tests are the specification. If you change the site's structure, change them too rather than deleting them.

## Fonts

The three typefaces are served from `public/fonts/`, so the site makes no request to a font service. Each is the Latin subset, taken from the Fontsource packages on npm (`@fontsource-variable/schibsted-grotesk`, `@fontsource/instrument-serif` and `@fontsource-variable/jetbrains-mono`, version 5.3.0).

| Family            | Files                                                                                | Licence text                            |
| ----------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Schibsted Grotesk | `schibsted-grotesk-latin-wght-normal.woff2`                                          | `public/fonts/SchibstedGrotesk-OFL.txt` |
| Instrument Serif  | `instrument-serif-latin-400-normal.woff2`, `instrument-serif-latin-400-italic.woff2` | `public/fonts/InstrumentSerif-OFL.txt`  |
| JetBrains Mono    | `jetbrains-mono-latin-wght-normal.woff2`                                             | `public/fonts/JetBrainsMono-OFL.txt`    |

Each licence file is the `LICENSE` file from the corresponding package, unchanged: the SIL Open Font License, Version 1.1, preceded by the family's copyright line. The files are copied into `build/client/fonts/` with the site.

## Provenance

`vibld.json` records which template this came from. Nothing reads it. Delete it and everything still works -- and a test asserts that no application file imports it, so it cannot quietly become required.

## License

MIT. See [LICENSE](./LICENSE). The font files in `public/fonts/` carry their own licence texts, listed under Fonts above.
