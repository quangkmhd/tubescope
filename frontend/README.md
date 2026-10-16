# TubeScope frontend

Vietnamese research workspace built with Next.js 16, React 19, TypeScript, Tailwind CSS 4 and official shadcn/ui Radix components.

Use the repository's launcher to run the frontend and backend together. For frontend development alone:

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3000
```

The `/api` rewrite uses `TUBESCOPE_API_URL` (default `http://127.0.0.1:8765`). The backend must be running. There are no demo records or offline fixtures. Geist is served locally from the installed font package, including Vietnamese glyphs, without fetching Google Fonts at build time.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The URL records the current workspace, job, warehouse group, video detail, search, sort, filters and page. Video pages contain at most 50 rows; group pages contain 24 cards. SWR deduplicates shared queries and polls only active jobs and their results.

Unsaved review changes are kept in versioned per-video browser session storage. Browser Back or reopening the sheet restores the draft. Saving removes the draft. Closing a changed sheet with Escape or its close button asks whether to discard it.

The source form defaults to 100 results per source and full metadata. Durations entered in minutes become seconds in API requests; the under-three-minute and over-twenty-minute presets use strict integer-second boundaries. Native YouTube filters apply to keyword and search URL sources, while advanced metadata filters apply after extraction.
