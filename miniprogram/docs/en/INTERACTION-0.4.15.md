# Interaction and profile revision — 0.4.15

28 November 2026, Beijing time. Candidate source built directly on team main `a6a3f88f028836278dfa91620e5f080b0cfff426`. PR27/0.4.14 is merged. This revision retains the team's bird-selector changes, identification polls/voting/adoption, original-photo review gateway, domestic Dongniao fallback, frame recovery and tab motion. Backend and all other root entries are unchanged.

## 0.4.15 compilation correction (R64)

The earlier bulk press-feedback edit treated the `>` in a quoted `>=` expression as the end of a tag. It inserted attributes inside the identify zoom-in button's disabled binding. This introduced the reported DevTools compile failure. The earlier360 tests and browser projections missed it and did not establish that the project compiled.

The complete `zoom >= (demo ? 5 : maxZoom)` binding is restored, with press-feedback attributes outside it. A strict validator now consumes all WXML attributes/bindings, including before browser projection. `npm run verify` also requires the bundled WeChat WCC/WCSC from pinned `miniprogram-compiler@0.2.3`: all20 WXML and22 WXSS files compile. The reported broken fixture fails both the validator and WCC; a missing style import fails WCSC. The corrected build passes368 tests. Run `npm ci` for the added development dependency. Runtime version remains0.4.15.

The bundled binaries are WCC v0.5vv_20200413_syb_scopedata and WCSC v0.4me_20190328_db. This is an offline template compilation gate; full current DevTools project Compile and phone acceptance remain required. The previous green CI and layout projections are not native acceptance evidence.

## What changed

- **Map controls:** the locate icon is replaced by one centered spinner during location. The redundant floating circular refresh is removed; viewport loading and explicit error retry remain.
- **Journal deck:** only the current card and two neighbours are mounted. Horizontal movement moves cached page thumbnails; composing missing previews waits until movement settles. A stationary hold of at least one second arms the same card with a soft mist border. Vertical travel has resistance and requires 130–210 px of deliberate, predominantly vertical movement. Short drags return, sideways movement cancels, and no action occurs before release. Downward release still requires deletion confirmation. There is no intermediate gesture popup.
- **Sharing:** an app-styled, content-sized sheet shows the actual page preview and three destinations: save a PNG, add the page to a local forum draft, or explicitly invoke WeChat image sharing. It does not use a native action sheet as its destination chooser. Closing during export preparation cancels subsequent external actions; the editable original stays intact. Saving a temporary original does not invalidate an otherwise unchanged preview.
- **Buttons and sheets:** plus icons have contrast on solid green buttons; image/text buttons share alignment and press feedback. The discovery close icon is centered. Discovery now has a measured body, fixed header and bounded scrolling. Sharing/discovery hide the tab bar while open, preventing it from covering the lower actions, and restore it on close.
- **My page:** entries are grouped by records, community and preferences. Local observation favourites and community bookmarks have distinct labels; journals have a direct entry. Real, device-local saved locations replace the demo-only activity view. Save from the native location selector, reopen the exact GCJ-02 point on the map, or explicitly remove it. Saving is not treated as a check-in; old demo storage is untouched.
- **Settings:** inspect/clear only rebuildable journal previews and their index. Source journals, Undo/Redo, forum drafts/recoveries, AI history, originals, avatars and unrelated vision caches remain. Referenced preview files are protected; unreadable source collections stop cleanup. No global clear-storage call is used.
- **Phone writing check:** Settings can check the hosted writing capability after normal community login. This sends neither media nor draft text and makes no model call. It reports deployment/configuration/authentication/network failures and ignores late results after hiding or session changes.
- **Social:** preserve the existing private/group-chat APIs and identification-poll notifications. Add the shared app header, clearer conversation/group cards, unread counts, compact empty states and a bounded message composer. A late send acknowledgment cannot clear a newer draft or affect a hidden page. Failed messages retain their request identifier for safe retry.
- **Motion:** retain teammate tab motion; add subtle button feedback, sheet arrival, card resistance/spring-back, mist and bin feedback. Reduced-motion rules disable the decorative movement. Continuous jitter is not a default effect.

## Evidence and boundaries

`npm run verify`: **368 passed, 0 failed, 0 skipped**, including the team's 340-test baseline and 28 new regression cases. Strict WXML attributes/expressions, actual WCC/WCSC compilation, structure, assets, handlers, TypeScript and runtime syntax checks pass. Latest team-main client, backend and real CPU dependency CI checks are green; this patch does not change backend code.

Source layout projections cover **66 state/viewport cases**, including 320×568, 412×931 and 768×1024. Steady-state horizontal overflow and off-screen sheet bounds: zero. These are browser projections, not WeChat emulation. Native Compile, long-press/scroll arbitration, frame rate, camera quality, native permissions, WeChat sharing and actual two-phone acceptance still require DevTools/phones.

The warm deck proxy uses 18 six-photo journals, extra text and edit history. Across 100 index changes, it reads no complete journal/history collection and transfers 77,340 bytes in its serialized update proxy, versus 4,743,817 bytes for the pinned 0.4.13 baseline. This is not a native FPS result or a comparison against 0.4.14. Only three shelf cards are mounted, independently of library size; an explicit open/share may read the selected editable document.

Reproduce from the full team-source checkout:

```sh
cd miniprogram
npm ci --ignore-scripts
npm run setup
npm run verify
node scripts/review-phone-layouts.mjs
node scripts/benchmark-journal-deck.cjs
node scripts/check-live-services.mjs
```

`review-phone-layouts.mjs` emits local source projections outside the package. It is not a screenshot of live services or a substitute for native testing. Machine-readable results: [INTERACTION-0.4.15.evidence.json](../INTERACTION-0.4.15.evidence.json).

## Live services: recovered health versus outstanding deployment

Read-only GETs at **00:45:03 Beijing, 28 November** returned:

| Service | Evidence | Remaining acceptance |
| --- | --- | --- |
| Vision | 200 ready, all three CUDA model entries ready | Real selected-photo/live identification was not called by this review |
| Species places | 200, current distance-order contract | Recheck phone ordering and map focus against this deployed version |
| Journal/forum writing | suggestions 404; capabilities 404 | Active hosted checkout/proxy still lacks the writing route; requires maintainer deployment |
| Trip planning | GET 405, route present | Does not establish writing readiness |
| Audio | readyz 404 | Provider/service acceptance remains open |
| Private map | anonymous 401 | Authentication protection still present |

Source already mounts the writing router and includes `/api/v1/journal/*` in the course proxy. The live 404 narrows the problem to the active deployment/routing path; it does not identify which process/proxy is stale. Follow the existing full-source `backend/deploy/course/JOURNAL-WRITING.md` with the maintainer's server access. Require unauthenticated suggestions405/capabilities401, then normal user-session capabilities200/configured=true, before one explicit user-chosen writing request. No production deployment, login, model call, upload or publication was performed here.

The Windows localhost writing helper remains for DevTools only. Keep its existing terminal, `.venv`, `image/` and local key. The Aliyun compatible-mode URL is the model provider; the phone calls the team HTTPS business service first. A working local helper does not deploy that business service. Restarting that helper cannot enable phone writing. The unresolved native authentication/network and rejected-null errors remain R34; retain the first complete stack and matching request/status rather than hiding them.

Admin access is separate from SSH. Repository history places the admin credential helper in the original24 November backend commit; it is unchanged by this client revision. The helper preserves an existing password unless explicitly invoked with `--rotate`, or the password file is absent. This does not establish what happened on the active server. Investigate the actual failed login and server logs without resetting credentials or pasting them into Git/chat.

## Native acceptance before another experience upload

1. Update the existing client checkout using the canonical English [next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md). Keep AppID and local data. Verify version0.4.15, then full Compile in the existing DevTools project.
2. Map: compare locate idle/loading centering, permission denial and retry. Open a saved location and a bird's sighting region; test the recovered distance/date contract on the phone.
3. Journal: tap opens; normal left/right settles; hold less than one second does not arm; a stationary one-second hold produces mist. Short vertical drag returns, side movement cancels, two-finger/background/rotation cancel. Up opens the custom preview; down shows the bin and asks confirmation. Cancel deletion and confirm the journal remains.
4. Share: inspect all three options on a short viewport and with safe areas; close during preparation; test album denial/cancel, local forum-draft handoff and the actual WeChat share capability. No post publishes from the share sheet alone.
5. My: save/cancel/reopen/remove a real location; inspect preview-cache count, clear it, then verify journals, Undo/Redo, originals and drafts still reopen and thumbnails rebuild. Revisit profile/edit/account/privacy/bookmarks.
6. Community: discovery close and every module entry; restored plus icons; private/group messages, requests/invites and the teammate's poll voting/adoption/notifications. While a send is pending, type another draft, navigate away and retry a failed send.
7. Use a narrow simulator, Pura70Pro+, the friend's phone and a wide/tablet profile. Record model, OS, WeChat/base-library and build. Hosted writing should currently show the deployment message; use Settings readiness again after the maintainer fixes it before any paid generation.

## Continued development

R57–R64 extend the preserved 48 original IDs and R01–R56. Full waiting-mode pre-capture/audio/vision fusion, real device resource measurements, whole-app whitespace/accessibility, bundled-media optimization, deeper AI plan/evaluation, cross-device journal sync and unimplemented cloud functions remain tracked. Existing REST-backed cloud/social capabilities are reused; this revision does not introduce an unconfigured second cloud platform. No team PR was merged and no experience build was uploaded by the assistant.
