# Stable0.4.20 and reviewer/development candidate0.4.21

28 November2026, Beijing time. **Keep0.4.20 as the upload checkpoint.** The user said they intend to upload; the console upload itself was not verified here. Frozen copies are `release/experience-0.4.20`. The existing `fix/recognition-acceptance-0.4.7` runtime stays0.4.20. New work is separate on **`feat/engineering-review-0.4.21`** in both owned repositories; this is the morning review candidate, not an automatic experience replacement. Team PR#30 and earlier0.4.18 remain intact.

[Engineering review / console triage](ENGINEERING-REVIEW-0.4.21.md) · [Window and Back design](WORKSPACE-NAVIGATION-0.4.21.md) · [Independent CloudBase deployment](CLOUDBASE-VAULT-0.4.21.md).

What changed: integer ripple widths; deferred/batched launch migration; note-list summaries instead of full bodies; a real list/editor workspace for wider windows, preserved draft/list scroll and failure-safe selection; header rotation/zero-status/no-capsule handling; improved functional caption contrast. Native unsaved-note protection is enabled while dirty where supported.

CloudBase is **not intrinsically blocked by the business server**. New `birdPrivateVault` reads/writes a private, revision-checked bookmark snapshot directly in CloudBase. The old gateway remains only a proxy. Cloud activation still needs the team's environment ID/type, real AppID binding, private permissions and legitimate owner deployment access; configuration stays disabled/empty until staging checks. No resources, paid plan, cloud deployment or business-server changes happened. Free usage has real quotas/expiry; inspect the actual team environment rather than assuming an unlimited entitlement. Journal photos continue using the complete portable backup.

**475 client tests pass;25 WXML/27 WXSS compile.4 offline SDK checks and clean-install dependency audit pass (0 advisories).684 source cases across38 window sizes and152 focused note-pane cases are reviewed.** Native Compile, ripple/auth/passive-listener reproduction, keyboard/rotation/fold behavior and live CloudBase IAM/two-user access remain pending. R34 remains open; runtime/tool messages were not silenced.


---

# Current candidate — 0.4.20 dates and original-data backup

28 November2026, Beijing time. The user chose **keep server work paused; add backup/restore now**. This patch extends0.4.19 on the same candidate branch.0.4.18 remains the user-reported uploaded experience version, frozen in `release/experience-0.4.18`; team PR#30 is unchanged. No server deployment, CloudBase activation or new experience upload happened.

New-journal/home/filter date buttons now share a horizontal layout; solid green map bookmarks have a white border. Saved places and journal records have verified alternating user-file snapshots, independent of disposable preview/reference caches. **My → 本机备份与恢复** exports all saved places plus selected journals with original photos, including retained Undo/Redo-only photos. Restore verifies/stages everything, preserves current records and creates conflict copies.

**A full WeChat data clear can still remove all local files. Download/save the generated backup outside WeChat first.** Generating it in the mini-program or returning from file sharing alone is insufficient. Previously erased content without a prior copy cannot be reconstructed. [Backup steps and boundaries](CACHE-SAFETY-0.4.20.md).

**458 client tests pass;24 WXML/26 WXSS compile.240 focused source layout cases across30 sizes pass.** Native file permissions/share/picker, real-device restore and full DevTools Compile remain pending. This is a candidate for review, not an upload instruction.


---

# Current candidate — 0.4.18 quick popup/visual patch

[Changes and quick native acceptance](POPUP-POLISH-0.4.18.md). Solid green/gold map bookmarks; green→white waves; fog fully covers dates before card contact; narrower height-derived journal cards; all15 custom sheet headers drag/flick to close, with X/backdrop retained and background scroll locked independently of content.

**421 client tests;22 WXML/24 WXSS compile;900 browser source layout cases/30 sizes pass.** Full native Compile and short gesture/scroll smoke still precede experience upload. Keep existing helper terminal/AppID/private config/local data. Server/cloud scope is unchanged; next pass covers CloudBase, profile/personal notes and the six More modules. Identification/journal expansion waits for the teammate's return. All48 IDs and R01–R86 remain; newR87–R90 are in the revision. Earlier counts/behavior below are historical.

---

# Bird Assistant native mini-program — candidate0.4.17

[Interaction stability and acceptance](INTERACTION-0.4.17.md) · [CloudBase preparation](CLOUDBASE-0.4.17.md) · [social design](SOCIAL-0.4.17.md) · [next steps](NEXT-STEPS.md).

Map ripple/zoom/row anchoring, cancellable calendar, fixed journal viewport and hold recovery, retained share choices, forum interaction synchronization, vertical drafts and friend-request states.416 client tests,22 WXML/24 WXSS compile; backend510 passed/53 skipped,86.76% coverage.900 source layout projections; native Compile/phone acceptance remains. CloudBase is prepared and inactive. Keep local config/data/helper terminal, run npm ci/setup/verify then Compile. Existing hosted writing404/404 and withdrawal405 require backend rollout.

---

# Bird Assistant native WeChat mini-program · 0.4.16 candidate

[Changes, evidence and native acceptance](INTERACTION-0.4.16.md) · [Canonical English next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md) · [中文](../../README.md)

App-styled map/journal choices and a range calendar; balanced trip layout; green-to-white journal glow, opening bin, staged cloud/bin departure and fade return; ratio-aware sharing; one forum feed for latest/mine/bookmarks with sliding selection and anchored actions; explicit identification voting and withdrawal. Home map exposes real local saved places. Preview cleanup preserves original work. Team main a6a3f88 integrations remain.

From the outer miniprogram directory run npm ci, npm run setup and npm run verify, then full Compile in the existing DevTools project. Keep its AppID, local data and running Windows writing helper.

**391 client tests pass;22 WXML/24 WXSS compile. Backend509 pass/53 skip,86.78% coverage.660 browser layout cases across30 screens fit.** These do not establish native WeChat touch/FPS, physical Pura70Pro+ acceptance or current DevTools full Compile. R34's complete idle/auth failure cause remains open. Hosted writing still404/404; vote retraction and complete mine/bookmark summaries require the updated business service. No production deployment, credential change, team merge or experience upload was performed.

Runtime is under inner miniprogram/, review tools under tests/ and scripts/. See ../INTERACTION-0.4.16.evidence.json. The client and business poll/feed contracts change in this revision. All original48 backlog IDs and R01–R64 remain, extended by R65–R74. Team/public handoffs are Chinese; private working plans are English.
