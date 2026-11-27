# Current candidate — 0.4.15 interaction and profile revision

28 November 2026, Beijing time. [Changes, evidence and native acceptance](INTERACTION-0.4.15.md). Built on team main a6a3f88 after merged PR27, preserving the teammate's polls, bird selector, photo gateway, Dongniao fallback, frame recovery and tab motion. Client360/360 passes. Native Compile/two-phone acceptance remains required; this candidate has not been uploaded by the assistant.

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
