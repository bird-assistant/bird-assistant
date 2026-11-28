# Interaction stability — 0.4.17

28 November 2026, Beijing time. Follow-up to the user's 0.4.16 screenshots and detailed native feedback. Team main base remains `a6a3f88f028836278dfa91620e5f080b0cfff426`. This candidate retains the teammate's merged vision, original-photo, Dongniao, frame-recovery and identification/adoption work. Source changes are ready for another native acceptance pass; this is not a production deployment or uploaded experience version.

The user confirmed WeChat image sharing, journal→forum composition and the right-neighbour arrival after deletion work. Those paths remain. Their report of the 45-second partial-hold freeze supersedes the previous R71 auto-release approach: that timer is removed entirely.

## Changes and acceptance map

| ID | Implemented in this candidate | Still requires native/deployment evidence |
| --- | --- | --- |
| R75 | Saved-place action moves under the floating locate button, freeing the map dock. Native geographic circles animate at the focused coordinates for 9 seconds; no focus pin. Pan/zoom keeps the ripple alive and recalculates its geographic size; a new focus or reopening the records header replaces/stops it. | Native map layering, geographic tracking and animation cost on both phones |
| R76 | Sighting focus reads the current native zoom, falls back to the last observed zoom and preserves it. The original sorted list/query remains locked; `scroll-into-view` brings the selected row to the relative visible top. Earlier/later records remain scrollable in their original order. The header explicitly refreshes the current area when requested. | Native scroll anchoring and rapid focus→pan→zoom→focus sequences |
| R77 | All observation markers retain integer counts including 1. Public is forest green; private/own groups are blue-teal. Backend clustering separates visibility so own/private points cannot silently merge into public counts. Saved places have bookmark symbols and can be focused. Date presets are all, rolling 7/30/90/365 days. | Deploy visibility-aware cluster responses; old mixed all-scope clusters cannot be reliably recolored by the client |
| R78 | Calendar band continues beneath both rounded endpoints, with different start/end greens and a diagonal one-day range. Tap one date three times: start→one-day range→clear. Tapping a selected endpoint clears that endpoint only. A fresh day adjusts the nearest endpoint, then the opposite endpoint; explicit start/end chips choose an edge. Cross-month taps and dragging remain. Close controls have fixed 1:1 dimensions. | Actual drag/scroll arbitration, short screens and accessibility |
| R79 | Departure time uses a 216px, four-row body and scrolls to the selected hour. Existing 1–4h stay and 10/30/80km radii match the current server contract. Approximate region labels derive from existing curated park regions; named chosen locations are retained. Consultation history has date, conditions, turn count, excerpt and per-account deletion. | Region fallback only covers current curated regions, does not identify administrative boundaries or fabricate a district. New reverse-geocoding integration is not deployed |
| R80 | Journal home occupies a stable viewport; available frame height determines card size. Short screens use a bounded filter sheet. Edge fades sit at the actual left/right viewport edges; outward glow inherits the card radius. Upward paper stays opaque until physically entering the cloud after the intent threshold; downward drag has no cloud. Hints occupy their own area below the card. | Native gesture feel/FPS, slow drag, reduced motion and smallest folding screen |
| R81 | Removed the 45-second hold timeout and reset suppressed taps during explicit cleanup. Native hide/show invalidates stale export jobs, releases busy state and restores the share sheet. Successful/cancelled destinations leave the sheet open; only explicit close restores the default card. Resume titles use bold italic text. | Physical ≥1-minute partial hold, repeated native menu cancellation and background return |
| R82 | Forum interactions use a bounded session-scoped shared store. Partial legacy lists preserve known counts/reactions/polls; old mine/bookmark responses hydrate from publication details with three workers. Read stamps protect newer mutations; cached projection cannot overwrite newer detail changes. Vote badge says 投票 and icons sit at consistent cell anchors. | Hosted two-account synchronization and current withdrawal deployment; no fabricated unknown counts |
| R83 | Drafts use a vertical native swiper with top/bottom fade masks, index/arrows, bounded mounted cards and explicit edit/delete. Short-screen variants keep actions reachable. | Actual native swiper sizing and deletion/reopen behavior |
| R84 | Friend list exposes accepted/incoming/outgoing tabs and explicit request decisions. Group invitation/membership and text chat presentation are refined. Existing privacy, blocking, idempotent references, read cursors and account isolation remain authoritative. | Two real accounts, reconnect/late acknowledgement and all state transitions; see social design |
| R85 | Prepared inactive CloudBase `birdGateway` source, locked SDK, exact action allowlist, normal business bearer forwarding, per-invocation WeChat context checks and deployment/rollback instructions. Writing is disabled by default. No separate cloud account/database or automatic fallback is introduced. | Choose the team's environment, deploy into staging and validate SDK identity before wiring client transport; nothing was deployed here |
| R86 | Free `Map` page state becomes lifecycle/module storage; the source checker rejects future free `new Map/Set` initializers. Native media preview consumes callback and promise failures, including null; hide-keyboard calls have failure handlers. Console triage below separates app fixes from platform messages. | The native map authorization/network failure still needs environment-specific evidence; catching null does not prove every platform fault resolved |

All original 48 backlog IDs and R01–R74 are preserved in history. R34 remains open for native-only failures. This table adds R75–R86 without renumbering earlier work.

## Exact map and calendar behavior

The ripple is a transient map overlay at coordinates, not a screen-fixed animation or pin. It lasts 9 seconds even while dragging or changing scale. Selecting another sighting replaces it. Reopening the record header both cancels focus and requests records for the new area. Focusing preserves relative ordering rather than sorting the chosen record ahead of newer observations. The lock lasts until explicit header/filter/marker/list action; after the ripple finishes, the row remains stable.

The range editor keeps changes provisional until confirmation. If one endpoint is cleared, the other remains selected. After a completed range, a new date adjusts the nearer edge; the next date adjusts the other edge. Explicit start/end controls avoid guessing. Single-day selection has two endpoint colors in a diagonal gradient; a third same-day tap clears both. Day color transitions fade through the unselected appearance. A trip departure picker remains single-day, with past days disabled.

## Console triage

| Message supplied by user | Action/status |
| --- | --- |
| Free `_feedCache` is not a simple value | Fixed: lazy module WeakMap, initialized per page lifecycle. New structural guard prevents recurrence. |
| Uncaught promise null | Native photo preview now handles both callbacks and thenable rejection once; keyboard dismissals consume failure. Platform/map sources still require the first full originating stack; not declared universally fixed. |
| DELETE identification/vote 405 | Existing source route supports withdrawal; deploy current business checkout/proxy. Current ballot is retained on failure. CloudBase transport cannot create a missing backend route. |
| Canary base lib 3.17.1 | DevTools environment notice. Compare against the team's chosen stable base library if native rendering still fails; do not silently edit the user's local version. |
| Domain/TLS/certificate checks disabled | DevTools local setting notice. Actual phone/experience traffic needs the existing HTTPS host and WeChat domain/certificate configuration. Changing UI code cannot hide or resolve this notice. |
| `__dev__/WA*` preload warnings / worker reportRealtimeAction unsupported | DevTools/platform behavior. Do not patch generated WA scripts or add app retries to silence it. |
| Render-layer map authorization/network failure | Check actual AppID, native map/network context and first failing request. It may be independent of the working business API. No AppID, credentials or local data were replaced here. |

## Evidence and public-service state

`npm run verify`: 416 client tests, zero failed/skipped; bundled WCC 22 WXML and WCSC 24 WXSS compile. Backend: 510 passed, 53 skipped, 86.76% coverage; Ruff check/format pass. Skips cover optional model/device/dependency paths, not live success. The bundled template compiler is older; current DevTools full Compile remains required.

The 30 supplied/custom profiles cover 30 states (900 browser source projections). Geometry checks cover horizontal overflow, sheet bounds, armed-card hit targets, journal/tab overlap, round close controls, share-hint overlap and draft-action bounds. These are source projections, not WeChat emulation, native screenshots, permission tests or FPS results. Machine evidence records the final geometry outcome.

Read-only public probe at **04:47:05 Beijing**: vision 200 ready; places ordering 200/current; journal capabilities/suggestions 404/404; audio readyz 404; trip GET405 indicates a route, not a successful generated trip; anonymous private-map request401. No login, provider/model generation, private user request, publication or vote mutation was sent.

## Native acceptance, next in order

1. Keep the current Windows helper terminal, AppID, private config, `.venv`, `image/`, drafts and local storage. Follow the canonical English update commands; run npm ci, setup, verify, then full DevTools Compile in the existing project.
2. Map: zoom to a chosen level, scroll down the list and focus a row. Confirm identical scale, row visible at relative top, upward/downward scrolling preserved; pan/zoom for 9 seconds. Reopen header/new focus. Save/reopen/delete a place and verify its bookmark icon; compare own/public counts.
3. Calendar: same-day three-tap cycle; clear either endpoint; nearest/opposite adjustment; explicit start/end; cross-month span and drag; cancel versus confirm. Time sheet must show the selected hour without becoming full-height.
4. Journal: no outer page scrolling; first/last left/right fades; 1-second hold; wait ≥60 seconds midway up, resume/blank-cancel and immediately tap/drag again. Slow upward cloud entry; no cloud on delete; share save/cancel/native hide/show and forum handoff; each return keeps share choices usable until explicit close.
5. Forum: like/bookmark in all→mine→bookmarks→detail→back; quick separate reactions and delayed detail hydration. Two-account vote/change/withdraw/adopt; old405 must preserve state. Draft swipe/edit/delete and history reopen/delete on both normal and short screens.
6. Social: two real accounts exercise requests, accepted friends, privacy/blocked DM, group invitation accept/decline/leave/disband, unread cursor and interrupted-send retry. Staging CloudBase acceptance is separate.

## Deployment and remaining scope

Deploy business cluster visibility, existing DELETE vote and enriched mine/bookmark routes together; source does not require a new DB schema for this revision. Fix active journal routes/proxy per `backend/deploy/course/JOURNAL-WRITING.md`. The Windows helper cannot deploy the phone's HTTPS service.

See [CloudBase preparation](CLOUDBASE-0.4.17.md) and [social design](SOCIAL-0.4.17.md). CloudBase is prepared and inactive, not a cure for the hosted404/405. Forward-success redesign remains deferred per the user. Full waiting/pre-capture and audio+vision fusion still require separate implementation/measurement and live audio availability; cross-device journal sync, push notifications and richer media chat are not claimed complete. The backlog keeps these visible rather than treating UI source tests as service acceptance.
