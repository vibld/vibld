# Marketing site template

A prerendered marketing site: React Router in framework mode, React, TypeScript, Vite and Tailwind. Every declared route is rendered to HTML at build time, so the output is a folder of static files any host can serve.

This is a conventional project. It has no dependency on Vibld, needs no account or runtime service, and there is no `.vibld/` directory. Copy it somewhere else and it still installs, builds and runs.

## Commands

```sh
npm install      # install dependencies
npm run dev      # development server with hot reload
npm run build    # prerender to build/client/
npm run preview  # serve the built site locally
npm run typecheck
npm test         # builds, then asserts on the emitted HTML
```

## What is where

| Path                     | What it holds                                             |
| ------------------------ | --------------------------------------------------------- |
| `app/site.ts`            | Site name, routes, and per-page titles and descriptions   |
| `app/routes.ts`          | The route table React Router builds from                  |
| `app/routes/*.tsx`       | One file per page                                         |
| `app/components/`        | Header, footer and page scaffolding shared by every route |
| `app/app.css`            | Tailwind entry point and the theme                        |
| `react-router.config.ts` | Prerendering configuration                                |

**Start with `app/site.ts`.** Navigation, the prerender list and every page's metadata are derived from it, so adding a route there and in `app/routes.ts` is enough for it to appear in the nav, be prerendered, and get its own title, description and social card. There is no way to ship a page that the build forgot to render.

## Configuration

Copy `.env.example` to `.env` and set `VITE_SITE_URL` to the origin the site is actually served from. It builds absolute URLs for canonical links and social cards, which crawlers require to be absolute. The build falls back to `https://example.com` so a fresh clone works -- but a placeholder in a social card is a broken social card, so set it before going live.

## The contact form is a demonstration

`app/routes/contact.tsx` renders a form that goes nowhere. It says so, in the prerendered HTML, above the fields. There is no backend in this template and it does not pretend otherwise.

To make it real, replace the `handleSubmit` handler with a request to whatever endpoint you use -- a form service, your own API, a serverless function -- and remove the notice at the same time. Removing the notice without wiring the endpoint is the one edit that turns an honest page into a dishonest one.

## Deploying

`npm run build` writes static files to `build/client/`. Upload that directory.

Each route is emitted as its own `index.html` (`/pricing` → `build/client/pricing/index.html`), so deep links work on any host that serves directory indexes -- which is nearly all of them, with no rewrite rules.

For unknown paths, point your host's 404 handler at `build/client/__spa-fallback.html`. It renders the "page not found" screen and lets a visitor navigate onwards rather than seeing the host's own error page.

## Tests

`npm test` builds the site and then reads the emitted HTML, because that is what a visitor actually receives. A passing compiler does not tell you that a crawler sees your content or that a static host can serve your deep links.

It checks that every declared route is prerendered and no others; that deep links are separate files; that each page has a unique title and description and a complete social card with absolute URLs; that headings and navigation are present without JavaScript; that the skip link precedes the navigation and every form field has a label; and that nothing ties the project to Vibld.

Those tests are the specification. If you change the site's structure, change them too rather than deleting them.

## Provenance

`vibld.json` records which template this came from. Nothing reads it. Delete it and everything still works -- and a test asserts that no application file imports it, so it cannot quietly become required.

## License

MIT. See [LICENSE](./LICENSE).
