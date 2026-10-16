# Verification — 2026-10-16

The delivered application runs locally in production mode at http://localhost:3000, backed by FastAPI at 127.0.0.1:8765. Actual crawl results are persisted in SQLite; no mock fallback or seeded production records.

## Automated checks

- Backend: `uv run pytest -q` — **39 passed**, including cancellation/recovery, metadata exclusions, deduplication, review preservation, CSV safety, and playlist/Shorts provenance across retries and restart.
- Backend Ruff check/format and lock validation passed.
- Frontend: **9 tests passed**; ESLint, TypeScript and `next build` passed.
- Launcher: **1 regression passed**, covering descendants surviving an exited process-group leader.
- Production-only npm audit: **0 vulnerabilities**. Full development-tool audit still reports 9 transitive advisories; no forced dependency downgrades applied.
- Backend test client emits one dependency deprecation warning recommending httpx2. Tests and runtime are functional with the locked dependencies.

## Real YouTube integration

- `scripts/smoke.py`: **16 checks passed**. Three full video records from a Vietnamese keyword search took **7.552 seconds** in this run. Saving, refresh, review preservation, channel drilldown, FTS and CSV verified.
- `scripts/source_smoke.py`: **7 checks passed**. Bare channel mixed tabs, Shorts-only channel, native channel/playlist search, quick playlist enrichment, search URL and direct video URL.
- `scripts/browser_check.py`: created a real two-video keyword crawl through the UI, selected and saved both records, and downloaded the actual CSV. Final repeat used that existing job to avoid unnecessary further YouTube requests.
- Normalized records inspected for removed fields; backend data directory contains SQLite files, no downloaded image/video/audio/subtitle files. Public thumbnail URLs are rendered remotely by the browser.

## Browser acceptance

Headless Chromium against the production build: **20 checks passed**. Review survives reload and API readback; Back/Forward restores the unsaved draft; Escape confirms discard and restores keyboard focus. Channel, playlist, category and all-video warehouse navigation, empty search, history and explicit unavailable-service errors verified.

Six axe audits (desktop discovery, video detail, warehouse, native-filter dialog, mobile discovery, mobile warehouse) reported **no WCAG 2/2.1 A/AA violations**. This is automated coverage, not a claim of complete accessibility conformance. No JavaScript/React console errors. At 390px, no horizontal page overflow.

## SQLite scale experiment

`scripts/benchmark_sqlite.py` creates and removes a separate temporary database with **100,000 synthetic rows**. It never inserts those rows into the real warehouse. Timings on this machine:

| Operation | Milliseconds |
| --- | ---: |
| First 50 videos | 216.13 |
| Video page 1000 | 448.43 |
| FTS search, first 50 | 499.53 |
| First 24 channel groups | 343.04 |
| Channel drilldown | 35.11 |
| Category groups | 366.11 |
| Existing video upsert | 8.31 |

This checks database pagination and query behavior, not the time to crawl 100,000 YouTube videos. Real descriptions and tags may increase page size and query cost.

## Review and remaining limits

Independent review found and verified fixes for playlist provenance on retry (including a failed video observed in two playlists), browser-navigation draft loss, completed-job retry actions, and launcher orphan cleanup.

Scope remains a single-user local application with one worker. No account cookies or public hosting configuration. YouTube availability/rate limits and missing metadata are exposed honestly. The category catalog is a cached list including historical IDs, not a fresh region-specific YouTube API response. Only observed playlist memberships are known. Extraction has bounded subprocess time and output; restarting an active job marks it interrupted.

Detailed machine-readable outputs and screenshots are generated under ignored `.runtime/` and `test-results/`. Reproduction commands are in the root README.
