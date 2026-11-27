# 0.4.8 phone feedback and next acceptance

Follow-up0.4.9: U01 passed, R13 reopened, parameter scrolling works but tap return regressed. See the [latest fixes/retest](IMPORT-AND-SHEETS-0.4.9.md); the following is the historical0.4.8 record.

2026-11-26, Asia/Shanghai. [中文 / all sixteen findings](../PHONE-FEEDBACK-0.4.8.md) · [Full queue](BACKLOG.md)

The user tested0.4.7 experience builds on Huawei Pura70 Pro+ and iPhone. Those reports are real device evidence, not a blanket acceptance.0.4.8 addresses the immediate defects on the existing candidate branch; production and the team PR remain unchanged.

## Implemented candidate fixes

- Photo parameters accept vertical scrolling; a return action avoids accidental flips. Caption label, centered save and right preview have separate positions.
- Journal editing removes inherited template line caps, preserving titles and authored newlines through save/reflow. New journals clear prior setup titles. Page-edge clipping still applies.
- Personal locate uses native GCJ02 high accuracy and street zoom16. The advisor retains its intentional approximate-area input; public sighting locations retain their privacy grid.
- Cluster count and circle share one PNG, with bounded width, serialized exports, reuse and disposal. Actual Huawei/iPhone rendering needs a new test.
- Identify handles support tap/swipe, shortcut levels have independent tap routing, Huawei shortcuts prefer3.5× without a physical-lens claim. Audio highlighting matches the batch submission set.
- Capture exits dispose microphone work and stop/unmount camera/video, including pending native starts and late callbacks. System camera/mic indicators need real phone verification.
- Whole forum cards open posts; preview/reactions remain independent. Published/bookmark/library cards separate title, metadata and actions; component selector warnings and Page Map initialization are corrected.

## Qwen diagnosis and remaining deployment

Read-only public checks at11:21:45 Beijing returned trip-plan GET405, journal suggestions GET404 and community capabilities404. The trip route exists; the public journal route is absent. This does not identify the deployed provider key or prove a model request succeeds.

A second source defect is repaired: legacy BIRD_BUSINESS_TRIP_API_KEY and TRIP_WORKSPACE now supply missing journal credentials/endpoint; explicit writing overrides remain. Authenticated GET /api/v1/journal/capabilities exposes configured/model flags, never credentials. Stage errors separate image preparation, missing route, session, provider authorization/model/input, rate limit and timeout. See source backend/deploy/course/JOURNAL-WRITING.md. No admin login or paid model call was made.

## Deferred design retained

R03: ordered multipage books with per-page editing/recovery and sequential whole-book export; decide limits and PNG/PDF output after current single-page export/sharing is verified. R02: optional Doubao/Seedream backgrounds/ornaments, preview before applying, original bird photos and editable factual text retained. Official [image API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh&redirect=1) and [tutorial](https://docs.volcengine.com/docs/ark/image-generation-tutorial?lang=zh) confirm generation/editing, with capabilities differing by model. This is research/design, not a provider migration, quality benchmark or billable call. R16: substantial redesign of all six More modules stays queued for the next design conversation. All prior48 backlog IDs remain.

## Focused phone retest

1. Start/stop recording, switch Tab, background/lock and return; system indicators stop and late files do not appear. Tap zoom shortcuts and expand/collapse handles, then drag them.
2. New journal title reset; caption title plus three body lines; save/reopen; export PNG and inspect every line/photo. Then save to album/share, cancel and deny permission without losing the draft.
3. Compare locate with the system map and reported precision; counts of different digit lengths stay centered. Open a forum card anywhere, scroll parameters to the end, compare fixed save position and compact list spacing.
4. After business deployment, use the normal user session for one text and one selected-photo writing request. Vision/audio readiness is a separate gate.

Update in the existing Windows checkout: check git status, fetch origin, switch fix/recognition-acceptance-0.4.7, pull --ff-only, npm ci, npm run setup, npm run verify, then DevTools compile and upload a new experience build. Preserve AppID and stored drafts; stop on a failed command or unexpected local change. Expected package0.4.8. No cache wipe/reset is required.
