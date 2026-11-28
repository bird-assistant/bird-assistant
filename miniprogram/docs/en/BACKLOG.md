# Current candidate — 0.4.20 dates and original-data backup

28 November2026, Beijing time. The user chose **keep server work paused; add backup/restore now**. This patch extends0.4.19 on the same candidate branch.0.4.18 remains the user-reported uploaded experience version, frozen in `release/experience-0.4.18`; team PR#30 is unchanged. No server deployment, CloudBase activation or new experience upload happened.

New-journal/home/filter date buttons now share a horizontal layout; solid green map bookmarks have a white border. Saved places and journal records have verified alternating user-file snapshots, independent of disposable preview/reference caches. **My → 本机备份与恢复** exports all saved places plus selected journals with original photos, including retained Undo/Redo-only photos. Restore verifies/stages everything, preserves current records and creates conflict copies.

**A full WeChat data clear can still remove all local files. Download/save the generated backup outside WeChat first.** Generating it in the mini-program or returning from file sharing alone is insufficient. Previously erased content without a prior copy cannot be reconstructed. [Backup steps and boundaries](CACHE-SAFETY-0.4.20.md).

**458 client tests pass;24 WXML/26 WXSS compile.240 focused source layout cases across30 sizes pass.** Native file permissions/share/picker, real-device restore and full DevTools Compile remain pending. This is a candidate for review, not an upload instruction.


## Follow-up IDs

| ID | Work | State |
| --- | --- | --- |
| R105 | Shared horizontal journal date controls | Source/30-size geometry passed; native acceptance pending |
| R106 | Solid green bookmark with white outline | SVG/PNG updated; native map acceptance pending |
| R107 | Protected originals separated from disposable caches | Behavioral tests passed; native filesystem acceptance pending |
| R108 | Portable original-photo backup and merge restore |12 recovery/failure tests passed; native file handoff pending |

---

# Current candidate — 0.4.19 community and personal notes

28 November 2026, Beijing time. **0.4.18 remains the user-reported uploaded experience version.** Its runtime and accepted comments are frozen in `release/experience-0.4.18`; [team PR #30](https://github.com/bird-assistant/bird-assistant/pull/30) is ready for review, with passing checks, and still needs the repository's required teammate approval before merge.

The new candidate uses the existing private candidate branch `fix/recognition-acceptance-0.4.7`; the full source is separate on `feat/community-workbench-0.4.19`. [What to review](COMMUNITY-WORKBENCH-0.4.19.md) · [social/media decisions](SOCIAL-CLIENT-0.4.19.md) · [offline interaction design](../design/social-controls-0419.html).

New work: title-preserving cloud-scroll/bird scene and outward-only armed wave; real local field memos with autosave/search/pin/recoverable trash; per-account DM/reply drafts and safe late acknowledgements; friend-handle entry, local conversation controls and group member drawer; explicit public-post forwarding into an existing friend/group; folded reply groups; full served catalogue pagination, personal guide shelf, external gallery/date views; bounded public-photo cache and clearer growth display.

**446 client tests pass, zero failed/skipped;23 WXML/25 WXSS compile.** Native touch/FPS/permissions and two-account service checks remain to be accepted. The source-layout evidence is in the revision document. The standalone advanced-group/image-reply prototype is clearly demo-only and makes no network requests.

## Revision0.4.19 follow-up IDs

| ID | Work | State |
| --- | --- | --- |
| R91 | Freeze uploaded0.4.18 and prepare team handoff | Frozen; PR30 ready; required teammate review pending |
| R92 | Cloud scene below the journal title | Client implemented; native motion acceptance pending |
| R93 | Outward armed wave without constant green ring | Client implemented; native motion acceptance pending |
| R94 | Local personal field memos | Client tested; device acceptance pending |
| R95 | Account-scoped DM drafts and conversation controls | Client tested; service integration pending |
| R96 | Friend handle entry and group member drawer | Existing contract wired; two-account acceptance pending |
| R97 | Explicit public-post forwarding to friend/group | Client tested; service integration pending |
| R98 | Folded reply chains and durable reply drafts | Client tested; threaded service acceptance pending |
| R99 | Library hierarchy, full served pagination and local shelf | Client tested; native/service acceptance pending |
| R100 | External gallery/date view and page-scoped filters | Client tested; native/service acceptance pending |
| R101 | Bounded anonymous guide-photo cache | Client tested; device filesystem acceptance pending |
| R102 | Truthful profile growth presentation | Existing contract wired; service acceptance pending |
| R103 | Advanced group roles, image replies and media lifecycle | Offline prototype/design; backend contracts deferred |
| R104 | Server restoration and CloudBase activation | Explicitly deferred this pass; earlier inactive preparation retained |

---

#0.4.18 experience checkpoint — frozen for team review

The user reports uploading the current experience version. [Handoff and accepted feedback](EXPERIENCE-0.4.18-HANDOFF.md). Further work uses a separate branch; older not-uploaded statements below are pre-upload history.

---

# Current candidate — 0.4.18 quick popup/visual patch

[Changes and quick native acceptance](POPUP-POLISH-0.4.18.md). Solid green/gold map bookmarks; green→white waves; fog fully covers dates before card contact; narrower height-derived journal cards; all15 custom sheet headers drag/flick to close, with X/backdrop retained and background scroll locked independently of content.

**421 client tests;22 WXML/24 WXSS compile;900 browser source layout cases/30 sizes pass.** Full native Compile and short gesture/scroll smoke still precede experience upload. Keep existing helper terminal/AppID/private config/local data. Server/cloud scope is unchanged; next pass covers CloudBase, profile/personal notes and the six More modules. Identification/journal expansion waits for the teammate's return. All48 IDs and R01–R86 remain; newR87–R90 are in the revision. Earlier counts/behavior below are historical.

---

# Current candidate — 0.4.17 interaction stability

28 November2026, Beijing time. [Revision and native acceptance](INTERACTION-0.4.17.md) · [CloudBase preparation](CLOUDBASE-0.4.17.md) · [friends/DM/group design](SOCIAL-0.4.17.md).

Map:9-second geographic ripple without a focus pin, preserved zoom/row anchor, separate own/public counts and saved-place symbols. Calendar endpoint adjustment/cancellation and single-day cycle; shorter time sheet and richer trip history. Journal: stable viewport/edge fades/outward glow, cloud-entry threshold, **removed45-second timeout**, and share menu retained after success/cancel/native return. Shared forum interactions and legacy-list hydration; labelled voting; vertical draft deck; friend-request tabs.

**416 client tests;22 WXML/24 WXSS compile; backend510 passed/53 skipped,86.76% coverage.**30 profiles×30 browser states=900source projections; native Compile, phone permissions/gestures/FPS and long-idle recovery still require acceptance. The user's accepted WeChat/forum share and right-neighbour deletion remain intact.

CloudBase function source/instructions are prepared **inactive**, retaining existing business identity/permissions. No deployment/environment or client transport switch happened. Read-only probe04:47:05: writing404/404, audio404, vision200ready. Hosted withdrawal405 needs current business deployment; the original vote is preserved on failure. Full waiting/pre-capture/fusion and deferred forward-success redesign remain visible in the backlog. All48 original IDs and R01–R74 below remain; R75–R86 are in this revision. Historical0.4.16's45-second auto-release is superseded.

Follow the canonical English Windows commands below. Keep the helper terminal running and retain AppID/private config, `.venv`, untracked`image/` and local data. Update the existing candidate checkout, npm ci/setup/verify, then full Compile; do not switch to the older main runtime or clear storage.


---

# Current candidate — 0.4.16 interaction follow-up

28 November 2026, Beijing time. [Changes, deployment contracts and focused native acceptance](INTERACTION-0.4.16.md). All original 48 backlog IDs and R01–R64 below remain; this revision adds R65–R74. The previous 0.4.15 records below are historical.

App-styled map/journal choices and a range calendar; ripple location feedback; balanced trip controls; thicker green→white journal glow, closed/open bin, staged cloud/bin departure and fade return; adaptive sharing; same-feed forum tabs with sliding selection, anchored reaction icons and explicit identification voting/withdrawal. My/profile links select the matching feed tab. Home map now exposes 收藏地点, a local bookmark, not a check-in. Cache cleanup still preserves original work.

**391 client tests pass; 22 WXML/24 WXSS compile. Backend:509 passed/53 skipped,86.78% coverage.660 browser layout cases across30 supplied/custom sizes fit, with no blocked armed cards.** Browser projection, fake-time idle soak and the older bundled template compilers do not prove native WeChat touch/FPS or current DevTools full Compile. Test Pura70Pro+ and the friend's phone before uploading.

R71 addresses missing bridge callbacks, excessive fallback polling and lost gesture states; the user's complete idle-freeze root cause remains open under R34 pending native evidence. R73 requires deploying DELETE identification/vote plus enriched mine/bookmarks responses; an old404/405 preserves the vote and explains the deployment gap. Writing still404/404 at02:31:36 Beijing; the active HTTPS business/proxy needs updating. The Windows helper is DevTools-only and stays running. No secrets/passwords were changed and no production deployment, team merge or experience upload was performed.

Use the [canonical English Windows update commands](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md). Keep the candidate branch, AppID and local data; run npm ci, setup, verify, then full Compile. See R65–R74 in the revision handoff for exact scope and remaining checks.

---

# Current candidate — 0.4.15 interaction and profile revision

R64: repaired the identify zoom binding that broke Compile; mandatory strict WXML validation and bundled WeChat WCC/WCSC now compile20 WXML/22 WXSS. The earlier360-test green result missed this defect. Run npm ci before verify; still complete full DevTools Compile.

28 November 2026, Beijing time. [Changes, evidence and native acceptance](INTERACTION-0.4.15.md). Built on team main a6a3f88 after merged PR27, preserving the teammate's polls, bird selector, photo gateway, Dongniao fallback, frame recovery and tab motion. Client368/368 passes. Native Compile/two-phone acceptance remains required; this candidate has not been uploaded by the assistant.

The same-card one-second hold, damped share/delete drag, three-card deck, custom sharing sheet, centered locate spinner, visible plus icons, measured discovery, grouped My entries, real saved locations, protected preview-cache cleanup and safer social drafts are implemented. Latest public health: vision200 ready and current place sorting; hosted writing404/404 and audio404 remain. Settings can check hosted writing without sending photos or calling a model. R34 native auth/null errors remain open.

| ID | New feedback and remaining acceptance |
| --- | --- |
| R57 / M01/X01 | One centered locate/loading slot; redundant floating refresh removed. Native permissions/centering acceptance pending. |
| R58 / X01 | Real image icons with button contrast/alignment; centered discovery close and content-sized scrolling; tabs cannot cover these sheets. Native short-screen check pending. |
| R59 / Q05/X02 | Stationary ≥1s hold on the same card, mist, damped deliberate release, horizontal/multi-touch/background cancellation; only3 cards mounted. Phone gesture/FPS acceptance pending. |
| R60 / R43 | Custom composed-page share sheet and guarded PNG/draft/WeChat destinations. Native album/share permissions and cancellation pending; no automatic publication. |
| R61 / A02 | Grouped My entries, real local saved places and narrowly owned rebuildable preview cleanup. Device persistence/rebuild acceptance pending; no inferred check-ins or cloud sync. |
| R62 / F01 | Existing social APIs/polls retained; clearer inbox/groups and late-send protection. Real two-account friend/group/poll acceptance pending. |
| R63 / Q03/X03 | Preserve latest team integrations; hosted readiness check and motion feedback. Vision health/order recovered; phone writing deployment, R34 logs and wider adaptation remain open. |
| R64 / X01 | Identify zoom binding compile regression repaired; strict complete WXML parsing and actual WCC/WCSC gates now run in verify. Full DevTools acceptance pending. |

All original48 IDs and R01–R56 below are preserved as history. Canonical Windows instructions and next actions stay in the [private English next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md). Keep the existing writing-helper terminal and AppID; do not clear local data. Current native acceptance is in the revision notes above.

---

27 November 2026 · **Current candidate0.4.14:** [Phone review, evidence and acceptance](PHONE-REVIEW-0.4.14.md). PR26 is merged; uploaded0.4.13 stays available for debugging. Client map/import/sheet/deck changes and bounded capture/share work are ready for native testing. Hosted writing404, vision502 and old global ordering remain open. All existing backlog IDs below are preserved.

| ID | Phone-feedback work and current boundary |
| --- | --- |
| R47 / X01 | Remove character-based filter/navigation symbols; existing icons/CSS used. Native visual consistency remains open. |
| R48 / Q05/X02 | Lazy metadata shelf and cached composed-page bitmaps; warm bridge proxy improves. First migration, cache quota and native swipe FPS require phone review. |
| R49 / M01 | Distance/date selection stays selected; loaded-batch ordering and honest old-server warning. Global ordering/pagination requires deployment. |
| R50 / M01 | Native location selection survives hide/show; selected sighting centers and highlights its displayed public region. Native timing/privacy acceptance remains. |
| R51 / Q03 | Hosted writing readiness and writing/config/caption port. Live404 persists; maintainer deployment plus real user generation required. |
| R52 / X01 | Keyboard/safe-area-aware sheets and compact one-result drawer; empty/long projection checks pass. Wider popup/whitespace audit and native profiles remain. |
| R53 / I02 | Original-photo import directly; original-quality shutter request and durable capture. Actual Pura output dimensions and OEM limitations remain. |
| R54 / X01/F01 | Trip disclosures and bookmark cards implemented; test native spacing, long text, open/remove actions. |
| R55 / I01/I02 | Adaptive quick/wait sampling, bounded returned-frame recovery, per-target durable observation review. Full pre-capture ring, live audio/fusion and heat/battery experiments remain. |
| R56 / R34/R46 | Local redacted fault summary, package-only services moved, regression/layout/proxy tools added. Native auth/null root cause and bundled media-size optimization remain open. |


---

# Current candidate: 0.4.13

[Experience handoff and preserved R40–R45 follow-up requirements](EXPERIENCE-0.4.13.md). User acceptance now covers draft dates, persistent Undo/Redo, abandoning an old Redo branch, deletion and photo labels. Photo-only explicit generation, adaptive shared sheets and composed thumbnails are implemented;307 client checks pass. Native Compile/phone/provider acceptance remain separate. Existing helper stays running. The private repository retains the canonical English update plan. All original48 IDs and R01–R39 remain below.

---

# Current candidate: 0.4.12

[Editing cache and explicit generation](EDITING-CACHE-0.4.12.md) adds draft timestamps/order, persistent Undo/Redo, journal deletion, blank/idle AI entry and photo-label/native-path fixes. Client296 passes; native retest remains pending. The private repository’s canonical English docs/NEXT-STEPS.md holds current update commands. Earlier sections below are historical.

---

# 27 November: 0.4.11 revision

[Writing and draft revision](WRITING-AND-DRAFTS-0.4.11.md) implements explicit targets/name preservation (R27), prompt reset, captions, deck/filter/rename, multiple draft discovery/recovery, photo subsets and local histories. Native acceptance remains pending; E1/V1 and PNG were not conducted. Preserve all original 48 IDs and prior findings below.

Latest: focused0.4.9 native retests accepted for now.0.4.10 unifies review and adds isolated Qwen testing; native/real-provider acceptance remains. R22–R26 add map order, Birda media, unified review, own Qwen and urgent vision recovery without replacing the48 original IDs orR01–R21. [Current plan](NEXT-STEPS.md).

# Bird Assistant — user backlog and acceptance queue

**LatestR17–R21 and reopenedR13:** [0.4.9 fixes/retest](IMPORT-AND-SHEETS-0.4.9.md). U01 two-line spacing and parameter scrolling passed; tap return regressed. Keep [R01–R16](PHONE-FEEDBACK-0.4.8.md) and all48 earlier IDs. Multipage books, Doubao and six More-module redesigns remain queued.

Updated 26 November 2026, Beijing time. [Chinese authoritative working copy](../BACKLOG.md)

The Chinese checklist assigns stable IDs to the user's requests and observed defects. The cumulative [private development log](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/development-log.txt) retains their history. Current implementation is determined from the repository.

The user now authorizes upgrading as needed. The user has tested0.4.7 on Huawei/iPhone and supplied0.4.8 feedback. Update and compile0.4.9 on the same `fix/recognition-acceptance-0.4.7` branch. Existing confirmation covers registration, camera entry and04 import/review, not complete identity/inference/publication.

[Upgrade commands and current plan](NEXT-STEPS.md): A identification UI/materials, B posting/drafts, C map/forum/profile, D local journal and independent Qwen acceptance, E each ready model/advice/speech service, F devices/polish. Real Qwen can proceed when its own business configuration works; it need not wait for YOLO. The08:49:05 Beijing public check remains vision502/audio404. Private main changes documentation only; the candidate stays separate for acceptance, with no team merge/deployment.

| IDs | Requests and remaining evidence |
| --- | --- |
| S01–S07 | P0 shared-service repair and restart recovery; normal access on/off campus and mobile data without a personal laptop; explicit local development mode and truthful helper startup; real photo/live identification; capture/zoom/recording lifecycle; independent selected media/audio/both submissions; actual audio/video integration; coordinated backend deployment using the existing identity/data boundaries. Public connection selection cannot repair the upstream502. |
| U01–U06 | Latest UI defects: equal two-line camera/audio detail height, complete unclipped media cards, fallback photo selection only after the main picker fails, smaller photo/audio upload blocks, consistent review spacing, and natural-ratio photos without a solid backdrop. U01 passed in0.4.8; other candidate changes still require native acceptance. |
| U07–U08 | Original audio filenames/ellipsis/playback/persistence; multiple selected photos, independent preview and submission set, per-file results/errors and cancellation. Source exists; device testing remains. |
| M01–M08 | Close icon and map/drawer/tab boundaries/layering; central Identify orb foreground; cold first-tap markers at every zoom; dynamic translucent1–3-row search; global distance/date sorting and pagination after deployment; Chinese region names; working places/discussion/comparison from deep observation navigation; metadata flips with honest absent-field handling; real phone GPS and supported map-app navigation. |
| F01–F04 | Real posting/preview/moderation/comments/nested replies, retained drafts/failure recovery; independent like/bookmark state and visuals; readable relationship between a discussion and its map observation; useful posting tools/menu/refresh. Replies and reactions remain on the original discussion. |
| A01–A02 | Full WeChat/community identity and session expiry/logout/account isolation; profile/avatar upload/crop/cancel/save/restart; one initial for English names and1–2 Chinese characters for Chinese names; history/bookmarks/statistics/storage. Community registration alone is the currently verified subset. Phone binding was discussed, not imposed as mandatory. |
| Q01–Q05 | Readable structured Qwen-plus output; the teammate's photo-to-journal request using1–4 selected images and the visual model; shared journal/forum writing with fact boundaries, preview/apply/undo/cancel and real authentication/quota/deployment evidence; domestic mixed Chinese/English ASR with correction; journal editing/autosave/recovery/templates/crop/proportion locks/export. Qwen remains this workflow's responsibility. |
| T01–T04 | Named map-linked recommendations instead of unexplainedA1–A4; useful species/habitat/season/weather/time/quiet-location guidance supported by real local evidence; profile consultation history and follow-up; approved local forum retrieval in the candidate; outside-community retrieval and further place/freshness ranking remain queued. Current history is bounded, device-local and account-separated, with no cross-device sync. Coarse records do not prove a bird was inside a named park. |
| X01–X03 | iPhone/Huawei/Harmony/other Android, iPad/tablets, Windows WeChat, folding/dual/split screens and changing DPI/window sizes; keyboard/safe areas/large type/permissions/media; later fade/move/dissolve and interaction polish; ongoing offline/background/restart/low-storage/race recovery. Source projection and mocks do not establish native support. |
| O01 | Optional map region-lighting/sighting progress. The user explicitly did not require implementation; it follows the core flows if later selected. |

Follow the small batches in [NEXT-STEPS](NEXT-STEPS.md), patch meaningful failures, and preserve all48 queue items. Installation is not acceptance. The prior0.4.6 registration/camera/import results and candidate CI remain distinct from new device observations.

## New post-media feedback, 26 November

Six additions bring the queue from42 to48; previous responsibilities remain. [Candidate details](POST-MEDIA.md).

| ID | Request | Status |
| --- | --- | --- |
| P01 | Square thumbnails, full-image viewing and balanced parameter spacing | Candidate; original bytes/ratio remain intact; no undecided pixel editor. |
| P02 | Attach saved journals, including multiple works | Candidate: nine visuals total including three rendered journal snapshots; companion business/moderation deployment and native acceptance pending. |
| P03 | Explicit photo/audio/video limits | Visual9/journal3 in candidate; one10-second video and one60-second audio remain proposed follow-ups requiring storage/playback/moderation. |
| P04 | Other users can save post media | Explicit public photo/journal-image save is implemented and needs native acceptance; video/audio export follows their real integration. |
| P05 | Draft saving fails | Screenshot shows file quota; candidate adds reusable byte-preserving managed copies, scoped cleanup, rollback and text/parameter recovery. Real exhausted space still prevents photo persistence. |
| P06 | Extract photo metadata itself | Server allowlisted EXIF extraction exists; original bytes preserved; local JPEG/PNG/WebP/TIFF header reading and per-photo display are implemented in the candidate; unsupported/absent values remain unknown. |

Current0.4.9 local client257 passes; previous pinned backend CI510/56 and CPU92 passed. [Development continuation](SPRINT-2026-11-26.md) covers local EXIF/public saves, scoped recording recognition, cited forum experience, domestic editable ASR and media lifetimes. ASR defaults disabled, audio public readiness is404 and vision502; production/native/model quality remain separate. Upgrade is now authorized; 0.4.9 still needs update/compile and focused native acceptance.

Current S06/Q04/T04/P04/P06: audio transport and scoped mobile authorization are implemented but undeployed; photo/audio batches keep separate results. Journal/forum speech notes use explicit domestic Qwen transcription, editable preview and confirmed append; no OpenAI service, no automatic writing/publication. Approved recent forum experience is linked only to public map regions, with dates and original-post citations; outside-community retrieval remains queued. Explicit saves cover public photos/journal images; video/audio publication and export remain future work.

[Local real BirdNET validation](AUDIO-VALIDATION-2026-11-26.md) covers40 correlated variants from five birds/three controls plus eight invalid uploads. Public connectivity, native recordings and local-species accuracy remain open under S01/S06.
