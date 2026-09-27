# Ines Marlow, illustration portfolio

A one page portfolio site for a freelance illustrator. It opens on a large serif headline and a full bleed feature plate, then shows a filterable gallery of eight plates with a lightbox, a pull quote, a short biography and a commissions section with an email link and a copy button.

The name, biography, email address and artwork are placeholders. The plates are SVG compositions drawn in code (see `src/components/artworks.tsx`), so the project ships without image files. Swap them for scans of real work before publishing.

Built with React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui components on Radix, lucide-react icons and Motion.

## Requirements

- Node.js 20.19 or newer (22.12 or newer also works)
- npm, which comes with Node.js

## Install

```bash
npm install
```

## Run the development server

```bash
npm run dev
```

Vite prints a local address, usually http://localhost:5173. Edits reload in the browser as you save.

## Build for production

```bash
npm run build
```

This type checks the project and writes a static site to `dist/`. Upload that folder to any static host. To look at the built site locally first:

```bash
npm run preview
```

## Checks

```bash
npm run typecheck   # TypeScript, no output files
npm run lint        # TypeScript with unused code and switch fallthrough checks
```

## Replacing the placeholder content

- Plates: edit `src/data/works.ts`. Each entry has a title, category, medium, size, year, a short note and an `Art` component. To use a real scan, replace `Art` with a component that renders an `<img>` with `className="block size-full object-cover"` and a real `alt`.
- Feature plates: `src/components/Hero.tsx` (Plate 01) and `src/App.tsx` (Plate 08).
- Biography and working facts: `src/components/About.tsx`.
- Email address: the `EMAIL` constant in `src/components/Commissions.tsx`. The `.example` domain never delivers mail.
- Name: `src/components/Masthead.tsx`, `src/components/Footer.tsx` and `index.html`.

## Where things live

```
src/
  App.tsx                 page order
  styles.css              colour tokens, type scale, fonts
  data/works.ts           gallery content
  components/             page sections and the SVG plates
  components/ui/          shadcn/ui button, dialog and tabs
  lib/                    class name helper and shared motion values
```

Colours live as CSS custom properties on `:root` in `src/styles.css` and reach Tailwind through `@theme inline`, so `bg-primary` or `text-muted-foreground` always use the same values.

Fonts (Bodoni Moda, Newsreader and IBM Plex Mono) load from Google Fonts in the browser. Nothing is fetched at build time and the site needs no accounts or keys.
