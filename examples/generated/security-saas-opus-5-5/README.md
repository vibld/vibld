# Tripline landing page

A single-page marketing site for Tripline, a fictional service that monitors a company's external attack surface: the servers, subdomains, certificates and DNS records anyone on the internet can see. The page has a hero with a sample findings console, a coverage overview, a setup timeline, three pricing tiers with a monthly and annual toggle, an FAQ and a contact form.

The product, prices and data on the page are illustrative. The contact form validates input and simulates a send, but it does not transmit anything; the page says so next to the form.

## Built with

- React 19 and TypeScript, bundled by Vite
- Tailwind CSS v4, configured in `src/styles.css` through the `@tailwindcss/vite` plugin (there is no `tailwind.config.js`)
- shadcn/ui components written into `src/components/ui/` on top of the `radix-ui` package (accordion, tabs, button, input, label, textarea)
- lucide-react for icons and Motion (`motion/react`) for animation

## Requirements

- Node.js 20.19 or newer (22 LTS works well)
- npm, which ships with Node.js

No account, API key or external service is needed. The only network request at runtime is the Google Fonts stylesheet for Space Grotesk and IBM Plex Sans; if it fails, the page falls back to system fonts.

## Install

```bash
npm install
```

## Run in development

```bash
npm run dev
```

Vite prints a local address, usually http://localhost:5173. Edits reload in the browser.

## Check types

```bash
npm run typecheck
npm run lint
```

`typecheck` runs the TypeScript compiler without emitting files. `lint` runs the same compiler with unused locals and parameters reported as errors.

## Build for production

```bash
npm run build
```

This type-checks the project and writes a static site to `dist/`. Preview the built output with:

```bash
npm run preview
```

The contents of `dist/` can be served by any static host.

## Project layout

```
src/
  main.tsx            entry point, imports styles.css
  App.tsx             page composition and the plan-to-contact hand-off
  styles.css          fonts, Tailwind, colour and type tokens
  types.ts            shared types
  lib/utils.ts        cn() class merge helper
  lib/motion.ts       shared easing curve
  components/         page sections
  components/ui/      shadcn/ui components
```

## Changing the design

Colours live as CSS custom properties on `:root` in `src/styles.css` and are exposed to Tailwind through `@theme inline`, so `bg-primary` or `text-muted-foreground` always read the token. The type scale (`text-display`, `text-title`, `text-lead` and so on) is declared in the `@theme` block in the same file.

The acid yellow `--primary` is reserved for the trial buttons and the focus ring. Keep it that way if you add sections, or it stops standing out.

## Hooking up the form

`src/components/Contact.tsx` validates fields and then waits 900ms in `handleSubmit`. Replace that wait with a request to your own endpoint, and change the demonstration notice and success text to match.
