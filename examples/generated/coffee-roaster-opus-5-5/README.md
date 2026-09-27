# Wrenfield Coffee Roasters

A one-page marketing site for Wrenfield Coffee Roasters, a small-batch coffee roaster that sells bags by subscription. The page has a hero with a roast card for the current lot, answers to the questions people ask before a first order, this month's coffees in a scrolling rail, a section on the roastery, subscriber quotes, an FAQ and a subscription form.

Two things to know before you put it in front of customers:

- The subscription form is a demonstration. It validates the fields and shows a result, but it sends nothing and takes no payment. Connect it to your checkout in `src/components/subscribe.tsx`.
- The subscriber quotes are placeholders and are labelled that way on the page. Replace them with real quotes in `src/components/testimonials.tsx` and remove the notice.

## Requirements

- Node.js 20.19 or newer (22.12+ also works)
- npm, which ships with Node.js

## Install

```bash
npm install
```

## Run it locally

```bash
npm run dev
```

Vite prints a local address, usually http://localhost:5173. Edits to files in `src/` show up in the browser straight away.

## Build for production

```bash
npm run build
```

This type-checks the project and writes a static site to `dist/`. Upload that folder to any static host. To look at the production build on your machine first:

```bash
npm run preview
```

## Checks

```bash
npm run typecheck   # TypeScript in strict mode
npm run lint        # TypeScript with unused-code checks turned on
```

## Stack

- React 19 with TypeScript, bundled by Vite
- Tailwind CSS v4, configured in `src/styles.css` (there is no Tailwind config file)
- shadcn/ui components on Radix, kept as source in `src/components/ui/`
- lucide-react for icons and Motion for animation

Fonts (Fraunces and Source Sans 3) load from Google Fonts in the visitor's browser. Nothing is fetched at build time and no API keys are needed.

## Where to change things

| What | File |
| --- | --- |
| Colours, type scale, radii, shadows | `src/styles.css` |
| This month's coffees | `src/lib/coffees.ts` |
| Hero copy and roast card | `src/components/hero.tsx`, `src/components/roast-card.tsx` |
| Questions and answers | `src/components/benefits.tsx`, `src/components/faq.tsx` |
| Subscriber quotes | `src/components/testimonials.tsx` |
| Subscription form | `src/components/subscribe.tsx` |

Animation respects the operating system's reduced motion setting: movement stops and only fades remain.
