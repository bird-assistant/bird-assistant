# 0.4.11 — explicit writing destinations and persistent draft shelves

27 November 2026, Beijing time. Candidate code; native acceptance is still required. Existing app and helper dependencies are unchanged.

## What changed

- Journal AI distinguishes writing purpose from destination: **新增文字框**, **所选文本框**, or **页首概述**. New boxes can go above/below the photo region or be placed freely. The selected box's existing title/body is included when requesting a rewrite. There is no implicit heading fallback.
- Saved journal names and page headings are independent. Applying a suggestion keeps the saved name. **重命名** is available in the editor and library; old journal creation dates remain unknown rather than being fabricated.
- Opening a new journal AI session starts with an empty input and a faded example. The explicit **根据照片生成手帐** shortcut supplies its own request, with a separate overview and optional captions tied to selected photo IDs. Older title/body-only responses still work. Defaults favor ordinary, factual Chinese; literary writing requires an explicit request.
- Suggestions and per-photo captions are editable before Apply. The same preview can change destination/placement without another generation. Explicit title/caption options and a target summary show what will change. Application is atomic and undoable. Full text height is reserved during photo layout; insufficient space produces an error without replacing the original.
- **我的手帐** uses a centered deck with smaller, angled side cards, edge fades and swipe navigation. Search, ratio, date range and creation/modified ordering help find older work. Cards show dates, ratio and title. Only lightweight summaries cross the rendering bridge.
- Forum **草稿箱** is visible from the feed and composer. Multiple drafts have independent IDs, words, attachments, active photo and AI requirements/selection. Edits cache text synchronously and save complete media after a short pause, on leaving, or on explicit Save. Legacy single-slot drafts are discovered automatically. Open/edit/delete are available; deletion preserves originals and files referenced by another draft.
- Draft writes are serialized. Queued old saves cannot replace newer cached words. Complete manifests commit after copies; failure keeps prior complete drafts plus newest text/parameters, identifies missing photos and rolls back new partial copies.
- Forum AI can associate all available photos or a subset, independently of the active parameter preview. The existing four-image request limit remains; larger sets offer **选前4份**. Clear, colored validation explains limits and missing input before sending.
- Journal/forum **写作记录** stores up to 80 successful request/result records in total, scoped to the current document/draft. Restore/delete and applied markers are local; restoring sends no request. Records contain text, selected IDs/labels and results, not image bytes, local file paths, session tokens or provider keys. Existing trip consultation history remains account-separated and bounded. Cross-device sync is not implemented.
- Async photo-picker failures are caught. Failed journal images stop repeated bridge updates and offer explicit retry; a failed forum gallery image gets a placeholder without removing other images. Feed refresh permits retry. These fixes do not establish the cause of the reported native authentication/null errors; their request URL and call stack were not supplied.

## Evidence from the user's 0.4.10 round

| Case | Observed evidence | Limit |
| --- | --- | --- |
| J1 | Selected below-photo box receives the generated text; heading `TEST` stays | One associated photo is visible; this is not a clean zero-photo journal test |
| J2 | Four-photo generation and application; saved name becomes the generated title; no per-photo body | Exact application button and full Undo/Redo sequence are not established |
| J3 | Two selected photos generate and text is applied | Existing heading fallback still occurs |
| J4 | Five selected photos are refused | Muted/generic feedback is weak; no separate no-bird model response supplied |
| F1 | Text-only forum previews and shorter wording | Screenshots alone do not prove stale-preview invalidation between attempts |
| F2 | Photo-assisted identification-help text applied; user reports saving | Requests used one associated photo; all/subset selection is a new revision |
| C1 | `CANCEL-KEEP-123` remains in later composer screenshots | No late overwrite observed; not a timing guarantee for every provider race |
| D1 | Journals survive Compile; the next forum composer is empty | Prior code has one hidden saved slot; this is not proof of physical deletion |
| E1 / V1 | User explicitly did not conduct these | Native network-failure recovery and voice remain unaccepted |
| Export | No PNG result supplied in this round | Export/album/share still need native checks |

## Validation

Local client: **281 passed**, zero failed/skipped; route/config/assets/handlers/tag balance, runtime syntax and TypeScript pass. Seventeen new behavioral tests cover migration, shared media references/deletion, queued saves, quota failure, synchronous recovery, explicit targeting/context/placement/naming, captions/layout, history, filters, multiple photo associations, cancellation/retry and image-error churn. Existing assertions were updated only where requirements changed.

Local Python 3.12: **530 passed, 51 optional skips, 87.50% coverage**. The focused writing file has **37 passed**; Ruff lint and all 121 formatting checks pass. Local pytest uses explicit asyncio/coverage plugins to avoid an unrelated preinstalled pytest/AnyIO-plugin warning. Provider tests use controlled responses; no real Qwen requests were made by the assistant. Locked Python 3.14 CI and real CPU compatibility are reported separately after publication.

Source-projected HTML fixtures use the actual WXSS, and layout-model fixtures cover 1/2/4 photos across all three ratios. Browser screenshot rendering is unavailable in this workspace; these fixtures are not native visual acceptance. Windows DevTools, native keyboard/sheets, real provider caption quality, voice, export and phone HTTPS deployment remain separate acceptance work.

## Focused next retest

1. Update app to 0.4.11 and the companion helper source, then Compile. Preserve local AppID, media, journals and drafts. Do not clear storage.
2. Open **讨论 → 草稿箱** before creating a new post. Find the old saved draft if it exists. Create two drafts; edit/switch/Compile/reopen/delete one and confirm the other keeps words/photos. If no old draft appears, report that result without clearing storage.
3. Use an existing AI preview or history first: choose a new box below photos, edit its text, Apply, Undo/Redo. Name and page heading should stay unchanged. Selected-box rewrite and overview are separate explicit choices. Opening another AI session should show a blank prompt.
4. Try the journal deck/search/date/ratio controls and rename. Check narrow-screen readability and the fixed sheet close button with the keyboard open.
5. For one new paid call, use 1–4 selected photos through **根据照片生成手帐**. Expect an overview plus photo explanations in the preview; apply captions only when desired. Keep `J2 Test` as the saved name. If the provider omits captions, report it; do not regenerate repeatedly.
6. For one forum call, select two photos from a larger attachment set. Only those two should be listed in the summary and response request. Save/reopen and restore its writing record without a call.
7. E1, when ready: while the localhost helper is stopped, request writing from the same AI sheet; original words/photos stay and a local connection error appears. Restart the helper and retry once in that sheet. This tests gateway failure, not provider authentication. V1 remains deferred until domestic ASR is enabled and configured; do not treat the localhost writing key as voice-service setup.
8. On a repeated native render error, retain the first full stack/request URL/status (with secrets redacted). Do not repeatedly recompile or hide all console errors. Native PNG/album/share checks remain in the wider queue.

Public journal 404, vision 502 and audio 404 were earlier observations, not rechecked or repaired by this revision. No team merge or production deployment is included. The canonical private English plan remains `docs/NEXT-STEPS.md` on GitHub; all original 48 backlog IDs and R-series history remain.
