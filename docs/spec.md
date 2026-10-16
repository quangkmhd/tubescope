# TubeScope — real application

User explicitly requested real frontend/backend implementation after approving the interactive mock and 17 metadata groups. Proceed directly with implementation; the latest request supersedes earlier mock-only planning gates.

## Scope

Vietnamese, local single-user web application. Next.js/React/TypeScript frontend with official shadcn UI primitives. Python/FastAPI backend invokes yt-dlp without downloading video/audio, images or subtitle files and without collecting comments. SQLite owns persistent metadata, saved state, review notes, jobs and source relationships. Bind to loopback by default. No authentication/account-cookie integration or deployment is requested.

Inputs: multiline keywords, YouTube channel/tab URLs, playlist URLs, video/Shorts URLs, filtered search URLs. Only input sources are required and marked *. Optional limit defaults to 100 per source before filtering. Full metadata defaults on; quick mode can return partial results and saving quick results enriches them first. Duration min/max, views min/max, dates, content types, live state, category, playlist range, YouTube-native filters are optional. UI must distinguish native search filters from post-extraction filters. Errors and empty results must not masquerade as successful data.

17 retained groups: video ID/URL; title; channel name/ID/URL/handle; thumbnail URL; duration; views; upload date; content type/live state; native categories; full description; tags; likes; channel followers; verified; license; chapters; available subtitle languages (manual/automatic). Missing is null/—, not zero. Do not persist or export comment counts, comments, subtitle text, heatmaps, stream formats/codecs/bitrates/FPS or media/image/subtitle files. yt-dlp can still internally process format information.

Warehouse defaults to channels, other views playlists, categories and all videos. One canonical video record, multiple playlist relationships. Saving/updating never overwrites review notes/status/personal tags. Preserve real metadata, no seeded demo rows. Show existing/new distinction, selection, save, review statuses todo/keep/skip, notes/tags, refresh saved metadata, CSV export with quoted cells/formula injection mitigation. Paginate videos (50) and groups (24), indexes and FTS search; do not send 100k rows to the browser. Job state persists; cancelled jobs keep completed results. On server restart mark interrupted jobs, permit retry. Real progress, per-source/video errors, bounded extraction timeouts, bounded queue, cancellation terminates child process.

## Visual direction

Keep familiar bright research workspace from approved mock, improve readability. Subject-specific focal point is video thumbnails and source/warehouse hierarchy, not a marketing hero. Colors: canvas #F5F7FB, surface #FFFFFF, ink #172338, muted #59677C, primary #4055CE, success #18735E. Geist Sans/system fallback with Vietnamese support; body 14–16px, labels >=12px. Wide workspace: compact navigation rail, source/filter panel, spacious result table. Mobile: navigation and forms stack, cards instead of a wide overflowing table. Borders only for containment, modest radius hierarchy, no gradient wash decoration. Standard keyboard/focus, reduced motion, labelled controls, live progress regions, accessible dialog/sheet title and focus restoration.

UI/UX Pro Max search returned a relevant Data-Dense Dashboard style on second query but generic marketing-layout recommendations. Adopt data density/readability guidance; discard marketing hero and default palette in favor of this approved research workflow.

## Acceptance

Start both services with one documented command. Run actual YouTube crawl, save selected records, reload page and verify persistence, update review, browse channel/category hierarchy, export CSV. Automated backend tests cover normalization exclusions, validation, dedupe/review preservation, multiple playlists, filters, pagination/FTS, job errors/cancel/restart. Build/typecheck frontend, browser-test core workflow, mobile layout and accessibility; capture screenshots of real data. Report genuine external limitations and do not fall back to fake data.
