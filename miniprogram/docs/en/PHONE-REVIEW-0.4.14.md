# 0.4.14 phone-review candidate

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


27 November 2026, Beijing time. Based on team main `36c3e34212dc57bed6d041255352c06800cdc109`, which contains merged PR26 / the uploaded 0.4.13 client. The 42 screenshots in the user's Pura 70 Pro+ feedback archive were reviewed. This revision has not been uploaded or deployed. Keep 0.4.13 available for the teammate's existing reproduction.

## Changes ready for native testing

| Area | Candidate behavior |
| --- | --- |
| Journal filters and symbols | Recently modified / ratio labels have no appended arrow character. Navigation, selection, add, close and disclosure controls use existing image assets or CSS shapes instead of decorative Unicode glyphs. Numeric multiplication/zoom units remain text. |
| Journal deck | Home reads a disposable metadata index. Detailed documents and Undo/Redo load when opened. Settled neighboring cards receive small PNG previews of the actual composed page; swiping moves existing bitmap nodes. Thumbnail preparation uses disposable photo derivatives, with stale-revision and missing-image handling. Existing journal content and embedded edit history remain authoritative. |
| Map selection and order | The chosen distance/date option stays selected even against the older service. The UI requests observation-date ordering, sorts the loaded batch defensively, and warns when the service has not confirmed the ordering contract. A sighting's **定位** action centers and highlights its displayed region. Public coarse regions stay coarse. |
| Location search | The native place-picker result survives hide/show callback ordering. A stale viewport read cannot immediately replace the selected Shanghai Disney point. Deliberate map gestures still cancel the pending focus. |
| Drawers and AI sheets | A one-result map drawer shrinks to its content allowance. Shared sheets use measured body/header sizes and a bounded scroll area, including keyboard/rotation changes. History replaces its parent assistant panel while open. Safe-area padding stays inside the scrollable body. |
| Trip advice | Weather, observation tips, reference regions and plans have distinct headings, accents and independent expand/collapse controls. Earlier conversational output can collapse too. |
| Bookmarks | Saved posts/observations have dedicated cards with image, kind, title, excerpt, source/date, open action and separate remove action. |
| Device import | The primary photo action uses the original-photo selector directly. Video and audio use separate selectors. Cancelling does not silently launch a second picker. A native return while the page is hidden still adds the selected material. |
| Shutter and observations | Requests `quality: original` and capture metadata. A shutter photo is durably saved as a private observation while the viewfinder stays open. Background analysis uses that photo, not a preceding preview frame. Per-target human decisions remain separate from model candidates and survive first save, updates and reopening from My Observations. |
| Live / waiting | Analysis preview frames are separate from original shutter photos. Waiting mode backs off on stable targets and recovers on scene changes, never faster than the server's interval. Uploads remain single-flight. At most two recent useful returned analysis frames are retained within time/byte bounds. Video/audio recording pauses visual streaming explicitly. |
| Sharing | A regular Share action offers a composed PNG, a local forum draft, or the available WeChat image-share menu. Long-pressing the centered paper opens a drag surface: up opens sharing, down opens deletion confirmation. Horizontal/cancelled drags do not delete. Public post details support native link forwarding. Private/group chat, PSD and multipage PDF are not implemented. |
| Writing | Hosted readiness is checked before preparing photos or sending a model request. Text/layout context includes destination, existing text, selected photo shapes, permitted styles and a fitted character budget. No-space destinations stop locally. Preview plus one Undoable application and saved-name protection remain. |
| Diagnostics/package | Settings can copy a small local fault summary containing categories and code locations, without private text/media/keys. Four services used only by the field subpackage moved into that subpackage. Bundled image/audio size optimization remains open. |

## Evidence

- `npm run verify`: **329 passed**, zero failures/cancelled/skipped; routes, config, assets, handlers, duplicate WXML attributes, tag balance, TypeScript and runtime syntax checked.
- Full team-based backend suite: **493 passed, 51 skipped**, coverage **87.02%**. Skips are unverified capabilities, not successes. Provider calls are mocked.
- Source layout projections: 7 states at 320×568, 412×931 and 768×1024; no horizontal overflow, inaccessible AI Generate footer or oversized empty history in the 21 fixtures. These are browser projections, not native WeChat component emulation.
- Warm-deck Node proxy: 18 six-photo journals with eight additional text boxes and bounded history. Home no longer reads the 424,941-byte full library; 100 deck changes reduce serialized bridge updates from approximately **4,743,817 bytes / 200 calls** to **1,541 bytes / 100 calls**. Excludes first migration, PNG creation, native decoding and animation FPS. Reproduce with `node scripts/benchmark-journal-deck.cjs` after `npm test`.
- Layout review can be regenerated with `node scripts/review-phone-layouts.mjs`; choose an output directory with `BIRD_LAYOUT_OUT`. Fixtures use packaged illustrations only. User screenshots, original photos, local AppID, caches and credentials are not committed.

Native Windows Compile, WeChat rendering, camera dimensions, gesture arbitration and phone performance still require acceptance. Passing source checks does not establish a bug-free experience package.

## Hosted services still block phone acceptance

Read-only public checks at **16:55:40 Beijing time, 27 November**:

| Check | Observed | Required next step |
| --- | --- | --- |
| Vision readyz | 502 | Teammate checks the active vision process, upstream/proxy and model readiness. |
| Audio readyz | 404 | Deploy/expose the intended audio service before real bird-sound acceptance. |
| Journal suggestions / capabilities | 404 / 404 | Deploy the writing router and current business checkout on the active hosted service. |
| Trip-plan GET | 405 | Route exists; does not prove journal writing exists or that a model request succeeds. |
| Private map unauthenticated GET | 401 | Expected protection; normal WeChat login still needs phone verification. |
| Species distance-order probe | 200 with old contract | Deploy current business ordering before claiming globally correct distance/date pagination. |

The writing backend source now supplies authenticated capabilities, photo captions, safe provider-error categories and shared trip/writing credential fallback. See [maintainer deployment steps](../../../backend/deploy/course/JOURNAL-WRITING.md). It has **not** changed the live deployment. Phones ignore the DevTools localhost flag. The running Windows writing helper needs no restart for this client revision; keep its `.venv`, untracked `image/` and key local.

The recurring native “鉴权失败：网络请求失败” and rejected-null render errors remain unresolved. Copy the first full console stack, request URL path/status, device/OS/WeChat/library/build and triggering action; the new local summary may help if the error reaches App handlers. Render-layer failures are not guaranteed to reach those handlers. Do not silently suppress them or assume they are the vision 502.

## First native acceptance batch

Update the existing private candidate branch using the canonical English [Next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md). Keep journals, drafts and media; do not clear storage as setup. Compile in the existing DevTools project with its valid local AppID before any experience upload.

1. **Import:** primary photo button → choose one original → confirm exactly one card appears; cancel → no second picker. Repeat video/audio separately and return from the native selector after backgrounding.
2. **Map:** choose Shanghai Disney → Done → centered destination; leave/return and drag deliberately. Choose a bird → distance/date toggle stays selected. Sighting 定位 highlights the matching displayed region; one 丑鸭 result has compact height. Global pagination waits for the updated hosted service.
3. **Journal:** swipe heavy journals before opening them, inspect actual-page thumbnails, resume and verify existing dates/Undo/Redo. Reopen after restart. Test an old missing photo with explicit preview retry. No content/history may be lost.
4. **Sheets:** 320px-wide / short Android / tall iPhone profiles; empty and long journal/forum histories, keyboard open/closed, notch/home-indicator safe area, rotation where supported. Generate, close and back must remain reachable. Check trip disclosures and bookmark removal separately from opening.
5. **Capture:** original shutter saves one private observation and stays live; rapid captures, background during persistence, save failure and later review must not replace the newer card or duplicate it. Reopen from My Observations. Record actual photo pixel dimensions at 1×. Real analysis waits for the hosted service.
6. **Share/gesture:** ordinary Share; long press then vertical threshold; horizontal swipe and cancel; decline deletion; PNG album/share permission denial. Forum action creates a local draft and never publishes it. Keep the editable journal after export.
7. **Hosted writing:** after the maintainer establishes capabilities readiness, explicitly generate once using the user's own chosen photo/text, preview, apply and Undo. Repeat forum only if its separate scope needs checking. No paid generation was initiated for this revision.

Record phone model, OS, WeChat/library, build, network and a short expected/actual result. Repeat on the friend's phone after the first blocking failures are fixed.

## Remaining design work

The waiting-mode design is only partly implemented. This is adaptive preview analysis plus bounded returned-frame recovery; it is not a full pre-capture recording ring, native-resolution replay, continuous BirdNET audio or tested audio/vision association. Next experiments must measure camera/microphone concurrency, heat, battery, track stability and timestamp association on actual phones. The accepted architecture keeps preview, analysis copies and intentional high-quality capture separate.

`quality: original` asks WeChat for its best supported shutter output. It cannot guarantee Huawei's OEM 4:3 HD+ 25MP pipeline, postprocessing or 4096×3072 output. Preserve the original and expose actual dimensions; the system camera followed by original-photo import remains available for photography.

AI layout planning remains bounded and deterministic. Evaluate real outputs against goal completion, factuality, readability/fit and number of user interventions. Useful cases: one portrait photo with no prompt; six-photo layout with selected two-photo writing; preserve a selected paragraph's uncertainty; add notes below photos; overview without renaming; long multilingual text; no-bird image; insufficient space. An open-ended autonomous designer, larger-than-four-image AI calls and learned layout selection remain future work.

Preserve the original 48 backlog IDs and R01–R46. R47–R56 track this phone batch; implemented source remains pending native/service acceptance where stated.
