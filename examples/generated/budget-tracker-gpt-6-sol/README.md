# tally.

A personal budget tracker that runs in your browser. Add income and expenses with an amount, category and date. Switch months to review the balance, expense categories and entries, or download the selected month as a CSV file.

Entries are saved in this browser's localStorage. There is no account or sync service. Clearing site data or using another browser will not carry your entries over, so export any month you want to keep.

## Run locally

Install a current Node.js version and npm, then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Check and build

```sh
npm run typecheck
npm run lint
npm run build
```

The production files are written to `dist/`. You can serve that folder with any static web server. CSV export and browser storage work without a backend.
