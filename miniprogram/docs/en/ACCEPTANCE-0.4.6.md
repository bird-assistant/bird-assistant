# Interaction fixes, useful places and acceptance · 0.4.6

25 November 2026 · [中文](../ACCEPTANCE-0.4.6.md)

The current screenshots are the requirements. Version 0.4.5's fixed search height, single-file selection and coupled reaction flash were rejected. Source checks do not establish native-device acceptance.

The map drawer uses a fixed top alignment in both states. Search fits one to three 44px options, then scrolls, with a translucent surface flush to the toolbar. An opaque 26px base meets the tab boundary, and the central Identify orb retains its foreground layer. Native map dimensions stay stable while the drawer changes.

Species places default to distance from the last map reference when available, then observation recency; latest-first is also available. The server sorts before pagination. Records within an area use observation date, then collection time and stable ID. A legacy response remains labelled with its actual collection ordering. Known administrative aliases, including Ningxia Hui, are translated without guessing unknown localities.

Species tabs remain usable during independent place/discussion requests. Read-only comparisons no longer demand an event channel and can recover a deep navigation stack. Feed and detail reactions lock by post/action and merge only their own confirmed fields, so reordered like/bookmark responses cannot undo each other. Shared disabled styles and parent tap propagation are removed. Photos advertise flipping only when metadata exists; file-derived and author-entered data remain distinct. The expanded recognition clue area measures its contents and bounds long lists.

Imports select multiple real photos/audio files independently of the active preview. Each selected file is analyzed separately and keeps its result/error; cancellation prevents later queued uploads. Original audio names, ellipsis, size/duration where available and persisted playback labels replace the anonymous microphone tile. Video/examples remain explicitly excluded from photo identification. Audio/combined modes are gated before uploading until a real audio provider exists.

Trip Qwen receives a validated place-specific `visits` format: why go, habitat to scan, watch-for cues, time/weather adjustments and uncertainty. A/P protocol references become named, map-linked places. Unknown IDs are rejected, and coarse public cells are never treated as precise park sightings. Legacy responses expand known source labels without guessing coordinates from array order. Public map records, guide ecology and hourly forecasts remain evidence. Brief, dated official landscape/winter information covers five Beijing parks, including Summer Palace; elsewhere, unsupported local details remain unknown and ecological advice is conditional. Forum-text/external-community retrieval and evidence ranking remain future work.

Profile → Birding consultations retains the current community account's latest 20 local conversations and up to six turns each, including conditions and complete result cards. Re-entry and follow-ups work; expired server conversations start a fresh turn without deleting the old answer. Old trip dates are not reused as new dates. Account switches hide the previous account's content; late requests cannot save into another account. Corrupt storage is retained and failed writes are reported. This is device-local persistence, not cloud sync, and it cannot recover closed outputs from older versions.

Client verify passes 176 tests. Regressions cover multi-selection/failure/cancellation, audio identity, late pickers, concurrent independent reactions, species tabs/sorting races, deep comparison, legacy IDs, history bounds/corruption/re-entry/expiry/account switching and late consultation context. The local Python3.12 backend passes472 with55 skips at85.64% coverage; Ruff and format pass. Exact-head CI is recorded separately, environment counts are not added, and deployment locks remain unchanged. The 54 source projections cover 18 states at 320/390/768 widths and do not emulate native maps, camera, hit testing, 3D or safe areas.

The read-only public snapshot at 12:31 Beijing time reports CUDA-ready YOLO, BioCLIP and inference runtime and a 401 for unauthenticated private map records. The deployed places endpoint still lacks the new sort response: deploy the complete reviewed business-service source before accepting distance sorting and richer trip output. `node scripts/check-live-services.mjs --require-current` checks this without login, uploads, inference or writes. Existing FastAPI services retain their responsibilities; no duplicate WeChat cloud-function system is introduced.

Run acceptance in this order:

1. P0: brief WeChat identity/session/isolation smoke, then immediately actual identification.
2. P0: real photos/live camera, clear positives, small/occluded subjects, no bird/multiple birds, cancel/timeout/navigation/recovery. Record model/catalog version and request IDs; universal unknown on clear positives is not capability acceptance.
3. P0: publishing/approval, independent reactions, ordinary/nested replies and 20 related-detail navigation visits.
4. P1: deployed place advice/history and a real visual-Qwen photo-to-journal preview/apply/undo/cancel flow.
5. P1: profile, restart/storage failure, phone/tablet/font/safe-area/permission checks.
6. P2: broader animation, community retrieval and recommendation ranking; regional progress remains optional.

An eight-file acceptance pack includes licensed bird photos, a real EXIF original, difficult context/small-subject examples, a synthetic no-bird control, silent WAV selection controls and invalid input, with provenance/checksums and 24 blank test cases. It is not an accuracy benchmark. Natural multi-bird scenes, video and real bird calls are still needed. No actual WeChat login, identification upload, paid Qwen call, public post or deployment was performed by these tools; real identification remains the highest-priority pending acceptance task.
