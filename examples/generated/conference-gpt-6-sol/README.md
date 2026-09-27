# Trace / 26

A one-page example site for a two-day developer conference. It includes a draft schedule, illustrative speaker profiles, and an email form that demonstrates validation and feedback without sending or storing information.

The full-screen hero uses layered CSS light and a scrim. There are no external video or image assets to download. Google Fonts are requested by the browser when available; local fallback fonts are provided.

## Requirements

Use a current Node.js release compatible with Vite 8 and npm.

## Install and run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Check and build

```bash
npm run typecheck
npm run lint
npm run build
```

The production site is written to `dist`. The `lint` script runs TypeScript's no-emit checks; this project does not require an ESLint installation. Run `npm run dev` for local development. No account, API key, or backend is needed.

The event date, schedule, and speakers are illustrative sample content. Submitting the form only waits briefly and displays a demo result.