# Fernbank Dental website

A one page website for Fernbank Dental, a small family dental practice. It shows the services the practice offers, the weekly opening hours with a live "open now" indicator, and directions by bus, car and train. Visitors can also fill in an appointment request form.

The practice, its address, phone number and travel details are sample content. Replace them before publishing (see "Editing the content" below). The appointment form is a demonstration: it validates the fields and shows a confirmation, but it does not send anything anywhere.

Built with React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui components on Radix, lucide-react icons and Motion for animation.

## Requirements

- Node.js 20 or newer
- npm (comes with Node.js)

No accounts, API keys or external services are needed.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Vite prints a local address (usually http://localhost:5173). Open it in a browser. The page reloads as you edit files.

## Build for production

```bash
npm run build
```

This type checks the project and writes a static site to the `dist/` folder. Upload the contents of `dist/` to any static host. To look at the built site locally:

```bash
npm run preview
```

## Other scripts

- `npm run typecheck` runs the TypeScript compiler without writing files.
- `npm run lint` runs the same check and also fails on unused variables and parameters.

## Editing the content

- Practice name, address, phone number, email and map link: `src/lib/hours.ts` (the `PRACTICE` object).
- Opening hours: `src/lib/hours.ts` (the `WEEK` array, Monday first, times in 24 hour format). The open and closed status is worked out from the visitor's device clock.
- Services: `src/components/Services.tsx`.
- Travel directions and the illustrated map: `src/components/Directions.tsx`.
- Colours, fonts and the type scale: `src/styles.css`.

## Connecting the appointment form

The form lives in `src/components/BookingDialog.tsx`. The `handleSubmit` function currently waits 1.4 seconds and then shows the confirmation. Replace that wait with a request to your own booking system or form service, and update the demonstration notice in the same file.

## Project layout

```
src/
  main.tsx              entry point
  App.tsx               page composition
  styles.css            Tailwind setup, colour tokens, type scale
  components/           page sections and small motion helpers
  components/ui/        shadcn/ui components (button, dialog, input, label, textarea)
  hooks/useNow.ts       current time, refreshed every minute
  lib/hours.ts          practice details and opening hours
  lib/motion.ts         shared easing curve
  lib/utils.ts          class name helper
```

Animation respects the operating system's reduced motion setting.
