# 0.4.10: one material review and independent Qwen testing

26 November 2026, Beijing time. The user reports the focused 0.4.9 retests are good for now, explicitly including native audio highlighting. Keep those results; the changed 0.4.10 flow needs its own focused check.

## One review flow

Import now only collects originals. **进入素材复核** opens the same review used by camera captures and retained live frames. Photo/audio/both scope and submission checkmarks live in review; the current thumbnail preview is independent of selection. The batch action uploads only selected files without an existing analysis. Captured/live results, per-file candidates, notes and confirmations remain attached to their original asset; individual existing results can be explicitly reanalyzed. Video and sample illustrations remain outside real recognition. Cancellation/exit stops later queued uploads and retains completed results.

Retest: retain a captured result and note, add two photos plus audio, continue to review, switch scope/checkmarks, preview a different thumbnail, and identify once. Existing results must remain unchanged; only selected new files are submitted. Cancel during the first request and check that later files do not upload. Import itself never starts identification. Both public service failures remain separate dependencies.

## Why map dates look unordered

The screenshot says collection/import time descending; the right-hand date is the observation date. A 2006 observation can be freshly imported above a 2025 observation. Imported snapshots refresh collection timestamps together and use ID as a tie-break, so their visible years need not be chronological. Current client code requests `sort=recent`; current source supports global `day DESC,created DESC,id DESC` before cursor pagination. The older deployed response lacks that capability and falls back honestly to collection order. Deploy the companion business version to get global observation-date order; sorting just the loaded page would be misleading. The end-of-list label now follows the actual response order.

Birda's GBIF dataset `6ff8b3b0-ef0f-4f79-a310-5a5615c6aa0b` returned 8,522,201 records and zero `mediaType=StillImage` records in this session's live query; sampled records had empty media arrays. This concerns the GBIF export, not all content inside Birda. The importer uses the same allowlisted `media_candidate` path for both datasets; it does not intentionally drop Birda photos. No species reference photo is substituted for a sighting photo.

## Two urgent public failures

GET-only checks this session reproduce journal suggestions/capabilities 404, vision readiness 502, audio readiness 404, and trip-plan 405. The user's attached console additionally proves actual journal POST404 and vision analyses POST502. No login, image upload, inference or paid provider call was made by these checks.

The current upload contract matches the backend (`POST /api/v1/vision/analyses`, multipart `image`). A failed public readiness check does not depend on that payload. A teammate's older working build needs an endpoint/time comparison; it does not prove today's same public upstream is healthy. Check the active Caddy include and business process version, campus 18000 readiness, actual GPU 8000 readiness and supervised tunnel. Retain the existing production configuration/database; no server changes were made here.

## Own-account Qwen without GPU

Follow [local writing setup](WRITING-LOCAL-0.4.10.md). A loopback-only Python app reuses production writing routes, image redraw, schema, quota and provider code. It uses a temporary scoped developer session, not a second production identity. The provider key is entered privately in Python or read from the local environment. The opt-in only affects DevTools journal/forum writing; phones and ordinary sessions keep the normal HTTPS business route. An unavailable explicit local test fails locally without falling back to a billable public route. ASR remains its separate default-off feature.

Independent direct text/selected-image checks need an enabled Qwen account/key. Full phone use needs a deployed secret-holding HTTPS backend/serverless endpoint, not a GPU host. Doubao text/vision and Seedream image generation are distinct APIs/capabilities; no provider migration was made. Multipage journals, optional generated decorations/covers and all six More modules remain queued, alongside the original 48 items and R-series findings.

Verification is recorded in the PR and current next-steps page. Automated tests do not establish new native acceptance, actual Qwen output quality or public service recovery.
