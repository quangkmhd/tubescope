# Storage and collection workflow

User requirements: rename the warehouse to Kho lưu trữ, show first saved timestamps, put arriving discovery results first, show actual elapsed/completion times and an honest ETA, explain failures, support cancellation, open discovered YouTube sources without starting jobs, and separate collection prefilters from richer result filters.

Implementation decisions:

1. Preserve existing SQLite data and the 17 metadata groups. First-save timestamps already exist and must survive metadata refresh and repeated saves.
2. Order discovery by first membership in the current job, descending. Global metadata updates cannot change this order. Continue polling while jobs run.
3. Apply result filters in SQLite before pagination and use the same filters for CSV. Filters use optional duration, view and like ranges, category, metadata completeness, live status, upload dates and saved dates. Saved calendar dates use the browser's IANA time zone.
4. Keep listing duration/view prefilters visible in the source panel. YouTube's native search controls are a separate section, available for keyword/search sources. Result-only filters do not trigger extraction or alter existing results.
5. Show elapsed processing time from started_at to now/finished_at. Compute ETA only when discovery is complete and at least three candidates have completed; explicitly mark it as an estimate. Older jobs lacking timing counters show no invented ETA.
6. Cancellation retains results. Failure messages show the persisted underlying reason and per-source details; legacy interrupted jobs explicitly say the old version did not record a cause.
7. Discovered source actions use external links, never POST /api/jobs.

Validation: backend regression tests for filter/count/export consistency, arrival ordering, preservation and lifecycle counters; frontend helper tests for serialization and clocks; production build, lint and typecheck; browser checks on desktop/mobile including URL persistence, category selection, saved timestamps, source link behavior, error messages and accessibility. Controlled lifecycle checks use isolated temporary test data, never the user's warehouse. Deploy only when no user job is active.
