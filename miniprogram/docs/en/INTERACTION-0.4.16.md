# Interaction follow-up — 0.4.16

28 November 2026, Beijing time. This follows the user's screenshots of corrected 0.4.15. Team main remains `a6a3f88f028836278dfa91620e5f080b0cfff426`; the teammate's identification polls/adoption, bird selector, original-photo gateway, Dongniao fallback, frame recovery and tab motion are retained. This revision changes the client and the business poll/feed contracts described below. It is source ready for native acceptance, not an uploaded experience version.

## Changes and acceptance map

| ID | Changed behavior | Remaining native/deployment check |
| --- | --- | --- |
| R65 | Map scope/date/source and journal sort/ratio now use app-styled choice sheets. Journal library/material dates use a range calendar. Tap a start and end, or select a start and drag from it; cross-month ranges support two taps. Selection stays a draft until confirmation. Journal filter chips are smaller. Trip condition controls use the same styling. | Native map layering, date drag versus scrolling, dismissal and short-screen/keyboard behavior |
| R66 | Sighting location uses drawn concentric rings; the focused row briefly ripples. Map dock has an explicit 收藏地点 entry that saves the chosen GCJ-02 point. | Actual map focus and location permission; bookmark save/cancel/reopen/remove on phone |
| R67 | Trip origin, date/time, duration/radius, optional question and generated sections have separate visual hierarchy. Condition cards balance the width and keep chevrons beside their values. Existing output collapse/expand remains. | Actual generated long text, large font and native controls |
| R68 | Same-card one-second hold has a thicker green-to-white fading glow. Hold no longer calls vibrateShort, which could shake the simulator. A closed bin opens and turns red at the deliberate deletion threshold. Drag scale reaches .54 with reduced opacity; resistance and 130–210 px intent thresholds remain. | Real finger arbitration, glow appearance and reduced-motion/native performance |
| R69 | Upward release shrinks/fades into the cloud boundary before the share sheet arrives. The card stays hidden behind it and fades back without glow after close, success or external cancellation. Downward release shrinks into the bin before confirmation. Cancel restores the original; deletion brings the right neighbour in, otherwise the left. Tap blank space or move sideways to cancel. | Album/share cancellation, repeated deletion of first/middle/last, background/resize and interrupted animation |
| R70 | Share preview respects 3:4, 1:1 and 4:3, and the sheet gets more vertical room. Measured deck height keeps normal phone footers clear of the tab bar. Share hint sits below the shrunken card; delete hint stays above. | Tiny/landscape screens still scroll when necessary; actual WeChat image-sharing UI is invoked only after selecting that destination |
| R71 | Hard JS deadlines release missing native login/request callbacks and ignore late completions. Map fallback polling slows from 240 ms to 2500 ms; real region/zoom events still refresh immediately and hiding stops polling. Lost journal holds release after 45 seconds; page/resize transitions clear gesture timers. | Does not prove every reported idle freeze is fixed. Keep R34 open for first full native stack/request/device/build evidence and a physical foreground/background soak |
| R72 | 最新讨论, 我的发布 and 我的收藏 share the same feed renderer and preserve their scroll positions. A spring-like white indicator slides between tabs. Profile links also select these tabs. Reaction icons stay at fixed anchors while labels change to their right. | Old/new feed races, real counts on hosted mine/bookmarks, two-account reactions and native scroll restoration |
| R73 | Compact upper-right identification badge shows ballot total and opens a separate vote panel. Choose a bird then explicitly confirm/change the vote; withdraw explicitly. Candidate bars show counts and author adoption remains. Replies no longer silently cast votes. Inline bird search fixes the nested input overlap. | Deploy DELETE identification/vote and enriched mine/bookmarks responses; old 404/405 keeps the ballot and explains the missing withdrawal route. Verify two accounts, withdrawal and author closure |
| R74 | Device matrix records all 28 supplied simulator profiles plus custom 320×568 and 375×600. Reproducible layout reviewer covers 22 states per size. Hosted AI deployment and physical Pura70Pro+ testing remain separate. | Native full Compile, real Pura70Pro+/friend's phone, safe areas, touch/permissions/FPS and actual hosted Qwen |

All original 48 backlog IDs and R01–R64 remain in the historical backlog. The earlier R64 compile correction and mandatory strict WXML/WCC/WCSC gates remain active.

## Journal lifecycle and recovery

The gesture remains on the existing card. Upward/downward movement only commits on release after the deliberate distance/direction threshold. The departure lasts 360 ms, then opens sharing or deletion confirmation. A 340 ms return clears the glowing state. Share export errors preserve the sheet for retry; success, closing or native cancellation returns the default card. Missing journals, lost holds, hiding, resize and cancelled departures release the transition rather than leaving an invisible input blocker.

The cloud starts above the measured date underline. The drag layer stays above the blank-space dismissal layer, so the armed card continues to receive touch events. The up hint stays inside the visible deck below the reduced card. The bin lid is a separate drawn part that opens at the threshold. Only the current card and two neighbours are mounted; the prior deferred bitmap composition and shelf index remain. This revision does not establish native frame rate or physical camera quality.

## My places and cache

Use **Home map → 收藏地点 → choose a real place → confirm**. Reopen or remove it through **My → 收藏地点**. This saves a device-local bookmark; it does not create a check-in, public observation or cross-device record. The existing native location selector is a map selection surface, not one of the app filter menus being replaced.

**My → Settings/cache → clear journal previews** removes only rebuildable previews/index entries owned by that cache. Journals, Undo/Redo, original media, drafts and AI histories remain. Cache size is not a count of saved places. Actual check-ins remain a future feature and are not fabricated from bookmarks.

## Backend change and deployment handoff

`DELETE /api/v1/community/publications/{record}/identification/vote` removes only the authenticated member's vote. It is idempotent while the poll is open, returns the updated poll summary, and respects visibility, blocked relationships and author closure. No database migration is needed. `/mine` and `/bookmarks` now include feed reaction counts and poll summaries; existing fields remain.

Deploy these business changes together with the current client. An older host may still display the tabs but lack their full counts or return 404/405 on withdrawal. The client keeps the current vote and reports that deployment is needed instead of pretending it was retracted. No public voter-name list was introduced; the user's corrected requirement is bird-identification voting.

Hosted writing is still a separate deployment blocker. Read-only GETs at **02:31:36 Beijing on 28 November** found writing suggestions/capabilities **404/404**, audio404, tripGET405, vision200 ready and species-place ordering200/current. Private map anonymous401 remains protected. No login, model call, upload, publication, password change or production deployment was performed.

The Aliyun compatible-mode endpoint is the provider. The phone first needs the HTTPS business writing route and server-held configuration. The current source mounts the route; a working localhost terminal or trip route does not deploy it. The maintainer needs access to the active service/proxy, using `backend/deploy/course/JOURNAL-WRITING.md`. Keep the existing Windows helper, `.venv`, untracked `image/`, AppID and local data. Do not put provider/admin/server secrets into Git or chat.

## Evidence

| Check | Result | Boundary |
| --- | --- | --- |
| Client verify | **391 passed, 0 failed, 0 skipped** | Source/bridge regression tests, not phone acceptance |
| Strict parser and bundled WeChat compilers | **22 WXML + 24 WXSS compile** | Older bundled WCC/WCSC; full current DevTools Compile still required |
| Backend suite | **509 passed, 53 skipped; 86.78% coverage** | Optional model/dependency/device paths skipped; no hosted provider call |
| Backend static checks | Ruff check and format pass across src/tests/scripts | No production deployment |
| Source layout review | **660 cases / 30 sizes**, zero horizontal overflow, off-screen panels or blocked armed cards | Browser projections, not WeChat emulation; no native FPS claim |
| Synthetic idle map soak | One simulated hour bounded at one fallback check/2.5 s; hide stops bridge work | Fake time, not a one-hour physical heat/battery test |
| Native Compile, Pura70Pro+ and friend's phone | **NOT RUN here** | Required before the next experience upload |

Machine-readable evidence: [INTERACTION-0.4.16.evidence.json](../INTERACTION-0.4.16.evidence.json). Screen profiles: [device-profiles.json](../testing/device-profiles.json).

Reproduce source checks in the full-source checkout:

```sh
cd miniprogram
npm ci --ignore-scripts
npm run setup
npm run verify
node scripts/review-phone-layouts.mjs --followup
```

The optional Python browser review uses Playwright/Chromium and a generated projection directory. Run `python scripts/review-layout-projections.py --help` for explicit input/output paths; its screenshots are source projections. Backend checks run from `backend/` with the repository's test environment: `ruff check src tests scripts`, `ruff format --check src tests scripts`, then `pytest`.

## Focused native acceptance before upload

1. Fast-forward the existing private candidate using the canonical English [next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md). Verify **0.4.16 / 391 tests**, then full Compile in the existing DevTools project; do not clear storage.
2. Open every map filter and journal sort/ratio/date control. Confirm the app sheets, draft cancellation, cross-month range and drag from the selected start. Check tiny/short and wide layouts. Save/reopen a real map bookmark.
3. Hold one second without motion. Inspect green→white glow, closed/open/red lid and damping. Try short drag, side exit, blank-space exit, two fingers, hide/return and resize. Share up into the cloud with the hint below; cancel each destination and check fade-back without glow. Delete middle/last/only journals, cancelling first, with the right/left arrival rule.
4. Inspect all three canvas ratios in sharing. On a normal phone the three choices should fit; a genuinely tiny outer/fold screen may need bounded scrolling. Check album permission denial and WeChat native image sharing separately.
5. Switch forum tabs repeatedly while requests finish out of order. Toggle like/bookmark on a long-count post and check icon anchors. Open a poll, choose a candidate, explicitly confirm/change/withdraw, then author adoption with two accounts. Replies with a bird reference must not cast a ballot. Old-host withdrawal should preserve the vote and explain the missing route.
6. Check trip date/time arrows, condition balance, long generated output and expand/collapse. Leave the app idle, background/return and retry login/network failures; report the first full stack and matching request/build if anything locks up.
7. Recheck Settings → online writing after maintainer deployment. Require unauthenticated suggestions405/capabilities401, then normal-session capabilities200/configured=true, before one explicit user-selected generation. Test Pura70Pro+ and the friend's phone on their actual viewport/WeChat versions; supplied simulator profiles do not identify the older Pura70Pro+'s exact CSS viewport.

Full waiting-mode pre-capture/audio-vision alignment, heat/battery/FPS measurement, broader accessibility/adaptation, cross-device journal sync and unimplemented cloud modules remain queued. No team merge or experience upload is part of this revision.
