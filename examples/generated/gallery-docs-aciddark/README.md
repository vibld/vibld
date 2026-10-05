# Ion CLI

Documentation for Ion, an open-source command-line tool for building and shipping web projects.

A React, TypeScript and Vite project, styled with Tailwind CSS, with
shadcn/ui components, lucide-react icons and Motion for animation.

## Run it

You need Node.js 22 or later, with npm.

```bash
npm install
npm run dev
```

`npm run dev` starts a development server and prints the address to open.

## Build it

```bash
npm run build
```

This checks the types (`tsc --noEmit`) and then bundles the site into
`dist/`, which any static host can serve. `npm run preview` serves that
build locally.

## Scripts

| Script | Runs |
| --- | --- |
| `npm run dev` | `vite` |
| `npm run build` | `tsc --noEmit && vite build` |
| `npm run preview` | `vite preview` |
| `npm run lint` | `tsc --noEmit` |
| `npm run typecheck` | `tsc --noEmit` |

## Where things are

- `src/App.tsx`: the root component, which src/main.tsx renders.
- `src/pages/`: one file per page.
- `src/components/`: the page's sections and parts.
- `src/components/ui/`: shadcn/ui components, as source you can edit.
- `src/styles.css`: Tailwind CSS and the design's colors, fonts and spacing.
