# Stable0.4.20 and reviewer/development candidate0.4.21

28 November2026, Beijing time. **Keep0.4.20 as the upload checkpoint.** The user said they intend to upload; the console upload itself was not verified here. Frozen copies are `release/experience-0.4.20`. The existing `fix/recognition-acceptance-0.4.7` runtime stays0.4.20. New work is separate on **`feat/engineering-review-0.4.21`** in both owned repositories; this is the morning review candidate, not an automatic experience replacement. Team PR#30 and earlier0.4.18 remain intact.

[Engineering review / console triage](ENGINEERING-REVIEW-0.4.21.md) · [Window and Back design](WORKSPACE-NAVIGATION-0.4.21.md) · [Independent CloudBase deployment](CLOUDBASE-VAULT-0.4.21.md).

What changed: integer ripple widths; deferred/batched launch migration; note-list summaries instead of full bodies; a real list/editor workspace for wider windows, preserved draft/list scroll and failure-safe selection; header rotation/zero-status/no-capsule handling; improved functional caption contrast. Native unsaved-note protection is enabled while dirty where supported.

CloudBase is **not intrinsically blocked by the business server**. New `birdPrivateVault` reads/writes a private, revision-checked bookmark snapshot directly in CloudBase. The old gateway remains only a proxy. Cloud activation still needs the team's environment ID/type, real AppID binding, private permissions and legitimate owner deployment access; configuration stays disabled/empty until staging checks. No resources, paid plan, cloud deployment or business-server changes happened. Free usage has real quotas/expiry; inspect the actual team environment rather than assuming an unlimited entitlement. Journal photos continue using the complete portable backup.

**475 client tests pass;25 WXML/27 WXSS compile.4 offline SDK checks and clean-install dependency audit pass (0 advisories).684 source cases across38 window sizes and152 focused note-pane cases are reviewed.** Native Compile, ripple/auth/passive-listener reproduction, keyboard/rotation/fold behavior and live CloudBase IAM/two-user access remain pending. R34 remains open; runtime/tool messages were not silenced.

## Review this separate branch in the existing Windows checkout

Preserve the helper terminal, AppID/private config, `.venv`, `image/` and all local originals. Stop for local edits. To keep preparing the current0.4.20 experience, stay on its existing/frozen branch instead of switching to this review build.

~~~powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Workspace\bird-assistant\bird-assistant-miniprogram'
    function Invoke-CheckedGit {
        & git @args
        if ($LASTEXITCODE -ne 0) { throw 'Git stopped; inspect the error before continuing.' }
    }
    $birdChanges = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the working tree.' }
    if ($birdChanges) { throw 'Keep local changes before upgrading; nothing was reset.' }
    Invoke-CheckedGit fetch origin feat/engineering-review-0.4.21
    Invoke-CheckedGit switch feat/engineering-review-0.4.21
    Invoke-CheckedGit merge --ff-only origin/feat/engineering-review-0.4.21
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation stopped.' }
    & npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup stopped.' }
    & npm.cmd run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verification stopped.' }
    & node -p "require('./package.json').version"
}
~~~

Expected0.4.21 /475 passed /25 WXML /27 WXSS. Fully Compile the existing DevTools project. Optional `npm run verify:cloud` installs only the function's pinned dependencies, runs offline checks and audits; it does not deploy or require cloud credentials.

## Morning feedback / next work

1. Notes: create/open, scroll the list, edit and resize/fold. Wide windows should retain the list next to the editor. Back closes the inner link picker, then the note, then the page. Test failed-save preservation with independent test data; actual keyboard/native unload protection remains to be confirmed.
2. Repeat map focus while dragging/zooming and check the circle-width warning. Re-measure real startup; compare the installed stable SDK with the reported canary when isolating native auth/passive warnings. Keep the actual failed request/stack instead of clearing data or rotating credentials speculatively.
3. Inspect **My → 本机备份与恢复 → 云端收藏副本**. It correctly says not open in the unconfigured build. The prepared CloudBase path does not need the teammates' server. When available, provide/select the team environment ID and PG/traditional type through a legitimate owner session; no password/provider key is requested in chat.
4. After this visual feedback: library/detail and forum list/thread workspaces; per-note private sync/conflict handling; private original-photo cloud archives with explicit retention. Keep social/moderation/account authority on the existing business backend. Identification/deeper journal expansion remains coordinated with the teammate.

## Added follow-ups

| ID | Work | State |
| --- | --- | --- |
| R109 | Integer native map ripple widths | Payload regression passed; native renderer retest pending |
| R110 | Defer/batch startup original protection | Launch callback/one-pass migration tested; native total latency pending |
| R111 | Bounded note-list view model and readable captions |300-note bridge test and source review passed |
| R112 | Adaptive notes workspace, Back/scroll/draft ownership | Window/failure/unload-guard tests passed; real keyboard/fold acceptance pending |
| R113 | Resize-aware header, valid zero status bar and absent capsule | Pure/header lifecycle regressions passed |
| R114 | Independent private CloudBase bookmark snapshots | Client/function source tested; environment/IAM activation pending |
| R115 | Cloud SDK dependency hardening and offline verification |4 SDK checks and clean-install0-advisory audit passed |
| R116 | Engineering findings, console triage and wider-screen roadmap | Review published; native auth/passive/idle defects remain open |

All48 original IDs and R01–R108 remain. Earlier plans below are historical; the blanket CloudBase pause is superseded only for this independent private-vault preparation. Business-server restoration/deployment remains with the teammates.

---

# Current candidate — 0.4.20 dates and original-data backup

28 November2026, Beijing time. The user chose **keep server work paused; add backup/restore now**. This patch extends0.4.19 on the same candidate branch.0.4.18 remains the user-reported uploaded experience version, frozen in `release/experience-0.4.18`; team PR#30 is unchanged. No server deployment, CloudBase activation or new experience upload happened.

New-journal/home/filter date buttons now share a horizontal layout; solid green map bookmarks have a white border. Saved places and journal records have verified alternating user-file snapshots, independent of disposable preview/reference caches. **My → 本机备份与恢复** exports all saved places plus selected journals with original photos, including retained Undo/Redo-only photos. Restore verifies/stages everything, preserves current records and creates conflict copies.

**A full WeChat data clear can still remove all local files. Download/save the generated backup outside WeChat first.** Generating it in the mini-program or returning from file sharing alone is insufficient. Previously erased content without a prior copy cannot be reconstructed. [Backup steps and boundaries](CACHE-SAFETY-0.4.20.md).

**458 client tests pass;24 WXML/26 WXSS compile.240 focused source layout cases across30 sizes pass.** Native file permissions/share/picker, real-device restore and full DevTools Compile remain pending. This is a candidate for review, not an upload instruction.

## Update the existing Windows client

Keep the helper terminal, `.venv`, `image/`, AppID/private config and all local data. Stop for local edits; do not reset or clear storage. Candidate runtime remains on `fix/recognition-acceptance-0.4.7`; `main` receives working-plan documentation only.

~~~powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Workspace\bird-assistant\bird-assistant-miniprogram'
    function Invoke-CheckedGit {
        & git @args
        if ($LASTEXITCODE -ne 0) { throw 'Git stopped; inspect the error before continuing.' }
    }
    $birdChanges = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the working tree.' }
    if ($birdChanges) { throw 'Keep local changes before upgrading; nothing was reset.' }
    Invoke-CheckedGit fetch origin fix/recognition-acceptance-0.4.7
    Invoke-CheckedGit switch fix/recognition-acceptance-0.4.7
    Invoke-CheckedGit merge --ff-only origin/fix/recognition-acceptance-0.4.7
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Client dependency installation stopped.' }
    & npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup stopped.' }
    & npm.cmd run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verification stopped.' }
    & node -p "require('./package.json').version"
}
~~~

Expected version **0.4.20**,458 passed,24 WXML/26 WXSS. Fully Compile the existing DevTools project, then:

1. New journal: compare start/end controls with the shelf; check both placeholders and selected dates. Map: confirm opaque green with a white outline.
2. Open **My → 本机备份与恢复**. Generate a small backup with actual photos. Download/save it outside WeChat, then select it back to verify counts and restore into independent test data. Check exact photos, editing/Undo and conflict copies.
3. Check both in-app cleanup controls preserve bookmarks, journals and original photos. Do not test a full wipe on the sole original; verify an outside copy first and use isolated test data. Try cancelling/native sharing/back/background return without a stuck page.
4. Continue the0.4.19 local notes/library/social visual review. Dual-account service acceptance remains separate when the existing service is available.

## Deferred work

Server restoration, credentials/deployment and CloudBase remain paused by explicit choice. Do not silently substitute a cloud service for local backup. Existing social prototype feedback, production contracts, image replies, advanced group administration and identification/journal expansion remain in the older plan below. Original48 IDs and R01–R104 remain.

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

## Update the existing Windows client

Keep the helper terminal, its `.venv`/`image` files, AppID/private config and local storage. This stops for local edits instead of discarding them. This is a candidate review, not an automatic replacement upload.

~~~powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Workspace\bird-assistant\bird-assistant-miniprogram'
    function Invoke-CheckedGit {
        & git @args
        if ($LASTEXITCODE -ne 0) { throw 'Git stopped; inspect the error before continuing.' }
    }
    $birdChanges = & git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the working tree.' }
    if ($birdChanges) { throw 'Keep local changes before upgrading; nothing was reset.' }
    Invoke-CheckedGit fetch origin fix/recognition-acceptance-0.4.7
    Invoke-CheckedGit switch fix/recognition-acceptance-0.4.7
    Invoke-CheckedGit merge --ff-only origin/fix/recognition-acceptance-0.4.7
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Client dependency installation stopped.' }
    & npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw 'Setup stopped.' }
    & npm.cmd run verify
    if ($LASTEXITCODE -ne 0) { throw 'Verification stopped.' }
    & node -p "require('./package.json').version"
}
~~~

Expected: version **0.4.19**,446 passed,23 WXML/25 WXSS. Fully Compile the existing DevTools project. Review local notes and journal/cloud first; then library/bookmarks/external filters. Use staging accounts when the existing business service is reachable to check friendship, blocked DM, retry, invitation acceptance, public forwarding and drawer scroll isolation. No native upload was performed here. To inspect the uploaded version instead, use the frozen release branch, preserving any local changes first.

## Decisions for the next session

1. Give visual feedback on clouds/glow, the new library/sightings hierarchy and local field memos.
2. Try the offline advanced-group/image-reply design; decide roles/announcement rules, image-only reply behavior and the proposed four-image cap before contract work.
3. **Server restoration and all server-dependent implementation remain outside this revision**, per the latest instruction. No credentials, deployment, CloudBase activation or provider calls changed. Revisit the existing inactive preparation only in the later restoration pass.
4. Keep identification/fusion and deeper journal/editor expansion in the original backlog until the teammate returns. All original48 IDs and R01–R90 remain; newR91–R104 follow. Older “current candidate” and server-next instructions below are historical and are superseded by this section.

---

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

---

# Current candidate: 0.4.13

[Experience handoff and preserved R40–R45 follow-up requirements](EXPERIENCE-0.4.13.md). User acceptance now covers draft dates, persistent Undo/Redo, abandoning an old Redo branch, deletion and photo labels. Photo-only explicit generation, adaptive shared sheets and composed thumbnails are implemented;307 client checks pass. Native Compile/phone/provider acceptance remain separate. Existing helper stays running. The private repository retains the canonical English update plan. All original48 IDs and R01–R39 remain below.

---

# Current candidate: 0.4.12

[Editing cache and explicit generation](EDITING-CACHE-0.4.12.md) adds draft timestamps/order, persistent Undo/Redo, journal deletion, blank/idle AI entry and photo-label/native-path fixes. Client296 passes; native retest remains pending. The private repository’s canonical English docs/NEXT-STEPS.md holds current update commands. Earlier sections below are historical.

---

# Current candidate: 0.4.11

[Revision and focused native retest](WRITING-AND-DRAFTS-0.4.11.md). The following 0.4.10 plan is historical. Preserve the accepted 0.4.9 checks and all backlog IDs. Use the private repository’s canonical English docs/NEXT-STEPS.md for the current Windows update commands.

---

# Next steps

Updated 26 November 2026, Beijing time. This is our canonical English working plan; update this page on GitHub in place. Team/public handoffs use Chinese.

**Latest user results:** the focused 0.4.9 retests are good for now, including audio highlight borders. Preserve those passes. Current work is **0.4.10**: one material-review flow and independent own-account Qwen testing. [Changes and boundaries](REVIEW-AND-WRITING-0.4.10.md) · [Own Qwen setup and exact commands](WRITING-LOCAL-0.4.10.md) · [Full backlog](BACKLOG.md).

## Immediate priorities

1. Restore actual services. This session still reproduces journal suggestions/capabilities404, public vision readiness502, audio404 and trip GET405. The attached console also shows real journal POST404 and vision analyses POST502. A client update cannot deploy missing business routes or restore the GPU upstream.
2. Test Qwen independently with Baguette's own Beijing Model Studio API account. No GPU, team WeChat secret or production database is needed for the direct checks and explicit DevTools-only local gateway. Real calls require the user's own key/model permissions; phone use later requires a deployed HTTPS gateway.
3. Test the new unified material flow. Import only collects files; **进入素材复核** opens the common camera/import review. Choose photo/audio/both and submission checkmarks there. Only selected unanalysed files are sent; existing results/notes stay attached. Keep the current preview separate from the submission set.

## Update the existing mini-program

Keep the same private candidate branch and Windows project. Runtime promotion to main, team PR merges and deployment remain separate. Dependencies did not change; existing installs need no npm ci.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location 'C:\Workspace\bird-assistant\bird-assistant-miniprogram'
    function Run-BirdStep {
        $program = $args[0]
        $arguments = $args[1..($args.Count - 1)]
        & $program @arguments
        if ($LASTEXITCODE -ne 0) { throw "Stopped: $program $arguments" }
    }
    $birdChanges = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Could not check the repository.' }
    if ($birdChanges.Count) { $birdChanges; throw 'Local changes found; preserve them and share this output.' }
    Run-BirdStep git fetch origin
    Run-BirdStep git switch fix/recognition-acceptance-0.4.7
    Run-BirdStep git pull --ff-only origin fix/recognition-acceptance-0.4.7
    Run-BirdStep npm.cmd run setup
    Run-BirdStep npm.cmd run verify
    Run-BirdStep node -p "require('./package.json').version"
}
```

Expected: version **0.4.10**, **264 client tests passing**. Then Compile/编译 in the existing DevTools project and upload a new experience build for changed native-flow checks. Setup preserves AppID; preserve drafts, journals and media. Do not clear storage or automatically stash/reset local changes.

## Focused 0.4.10 checks

- Add photos/audio on the import screen: no model request starts there. Continue to material review; all originals and filenames remain.
- Combine a camera/live result with external files. Preview a different thumbnail, switch modes and change checkmarks: preview and submission remain independent; existing result/notes are retained.
- Identify selected new files only. One failure must preserve other results; cancel/leave during the first request and confirm no later queued upload starts. Already analysed files require an explicit individual reanalysis.
- The 0.4.9 border/filename/parameter-return/fixed-header/map-strip checks are accepted for now. Do not ask for the same passed screenshots again.

## Own-account Qwen now

Open [Alibaba Cloud Model Studio](https://bailian.console.aliyun.com/), use **华北2（北京）**, create a key and retain its API Host. Keep the key local and out of chat/screenshots/Git. Use the [exact local setup](WRITING-LOCAL-0.4.10.md).

The companion Python helper can make one actual text request, optionally one selected-image request, and serve the normal journal/forum UI only at localhost for DevTools. It uses the production writing schema/provider code, with no automatic paid retries. A missing explicit local helper fails locally; phones ignore the opt-in flag. Real provider success, native acceptance and public deployment remain separate evidence.

Qwen handles text/selected-photo understanding and editable layout suggestions. Seedream is an optional image-generation API under an authorized Volcengine Ark account/key; it does not replace the editable journal document. No Doubao migration or paid call was performed in this implementation turn.

## Map order and Birda photos

Current public results use collection/import time; displayed dates are observation dates. Snapshot imports share timestamps and may tie-break by ID, so 2006 can appear above2025. The client already asks for recent observation order; the companion backend implements global date sorting before pagination. Deploy that business version; do not falsely sort only one loaded page.

The live Birda GBIF dataset query returned zero StillImage records; sampled media arrays were empty. This is a limitation of the feed we consume, not proof that the Birda app has no photos. iNaturalist and Birda pass through the same media parser. Do not substitute a species guide photo for an observation photo.

## Infrastructure handoff

The [existing Chinese team Qwen issue](https://github.com/bird-assistant/bird-assistant/issues/25) records the missing writing route/shared configuration. The public source [0.4.10 handoff](https://github.com/NoctisBaguette/bird-assistant/blob/fix/forum-media-drafts-0.4.7/miniprogram/docs/REVIEW-AND-WRITING-0.4.10.md) adds current routing evidence for review; no messages or production operations were performed here.

The current client vision path and multipart image field match the backend. A public readyz502 occurs independently of the photo payload. Compare the teammate's working URL, time and path (public HTTPS versus a local/private tunnel), then inspect active Caddy include, business commit/process, campus18000/GPU8000 readiness and supervised tunnel. An old version label alone cannot resolve that difference. Web moderation access is not a GPU/process-control channel.

## Remaining queue

The original48 IDs andR01–R21 are preserved;R22–R26 track this feedback. Resume local journal title/multiline/reopen/PNG/album/share and system camera/mic release; map GPS/cluster rendering; real community moderation/replies; identity/session/account/profile recovery; separately ready photo/live/audio/advice/ASR services; then devices and polish.

Multipage books/combined export, optional Doubao covers/backgrounds/decorations, all six More modules, full forum AV publication/export, outside-community retrieval and cross-device history remain queued. Current post candidate supports9 visuals including3 journal snapshots;10s video/60s audio publication limits remain proposals. Footprints remain optional. All previous failure/recovery/privacy boundaries persist.

## Validation

Local client264 pass; local backend520 pass/51 optional skips,87.49% coverage; Ruff and121-file formatting pass. New local tests use fake upstreams; they do not establish actual Qwen quality or phone support. Exact-head GitHub CI is recorded in the updated PR when available.
