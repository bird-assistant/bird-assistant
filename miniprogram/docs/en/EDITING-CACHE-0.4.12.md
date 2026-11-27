# 0.4.12 — timestamps, persistent edits and explicit AI generation

27 November 2026, Beijing time. Client revision; the backend/helper contract and dependencies are unchanged.

## Evidence from the 0.4.11 retest

- The old forum draft exists, opens and can be edited; a second post can be created. This confirms discovery of the old slot. The screenshots show two drafts, with one unlabeled timestamp on the new one and unknown time on the legacy one.
- The user reports that Undo/Redo disappears after closing the mini-program. Source confirms those stacks were session-only. Previous discarded stacks cannot be reconstructed.
- The journal deck looks acceptable for now; further visual polish is deferred. This is not exhaustive date/filter/device acceptance.
- The saved journal name stays intact. The new photo-journal screenshots show an overview plus two separately editable photo explanations; this confirms a real caption preview, not full factual or application acceptance.
- The photo-journal shortcut still inserts a preset request and starts generation immediately. Ordinary **AI 写作** opens blank; the shortcut bypassed that behavior.
- Forum image-association labels are visibly squashed beside the thumbnails. No new all/subset provider-result acceptance was supplied.
- DevTools shows non-simple Page free-data warnings for `_failedPhotos`/`_failedCovers`, image loads referencing `127.0.0.1:12168/__tmp__/...`, and an unhandled null promise. The precise null/authentication stack is still absent.
- Empty/five-image guards, E1, V1 and native export are not newly accepted. Earlier accepted 0.4.9 checks remain preserved.

## Resulting behavior

**Draft dates:** cards show labeled creation and modification timestamps. Ordering uses latest modification first, creation time for a missing/tied modification time, then a stable ID. Legacy creation dates stay **未记录**; editing that draft records an actual modification time without inventing when it was created.

**Persistent Undo/Redo:** the document and its matching editing history commit together. Up to 20 nearby steps per journal are cached across closing/reopening and Compile, including the current selection and Redo branch. A new edit after Undo clears the old Redo branch. Cached history has a shared 350 KB budget; the oldest cached steps can be trimmed, while current journal content is never evicted to make room. Snapshots exclude embedded histories to avoid recursive growth. Corrupt history warns without discarding the journal. Storage failure retains the prior saved document/history. Lost pre-0.4.12 editing steps are not backfilled.

A close checkpoint protects newer text from an older pending media save. Media referenced only by retained Undo/Redo steps is persisted too; a removed photo can still return after restarting and Undo. Current required-media failure preserves the draft. If only an old step's media cannot be retained, that step is excluded from the disk cache with feedback instead of blocking the current journal forever.

**Journal deletion:** **删除** appears beside rename on library cards and in the editor name row. Confirmation is required. Deletion waits for an in-flight save, removes the chosen document and embedded editing history, clears its last-open hint, and attempts to remove its scoped AI suggestions. It leaves source photos and shared/exported post images intact. Another journal or forum history is unaffected. A failed storage write does not report deletion success; optional AI-record cleanup failure is separately reported.

**AI generation:** the setup shortcut is now **打开照片AI写作**. Both entry points open blank and idle. Purpose, target and photo choices can be prepared first; only an explicit **生成** action with a writing request starts a provider call. The user can close or edit before sending.

**Two different histories:** **AI建议记录** stores successful requests and generated suggestions for that document/draft. **载入建议** fills a preview, leaving the journal/post unchanged and making no new request. Undo/Redo restores canvas edits. The UI explains that distinction. Editing a page heading also keeps the independently named journal intact.

**Photo labels:** association cards explicitly use a vertical layout with a bounded image and their own full-width label row. Labels cannot be squeezed beside the image. Full names remain in accessibility labels; long visible labels truncate to fit. Selection borders retain the same card dimensions.

**Native warnings and image paths:** failure Maps/Sets are created per instance in `onLoad`, rather than stored as non-simple Page defaults. Saving a temporary photo updates every current image consumer: editor, AI thumbnails, picker/selected assets, template previews and retained history. The installed official typings 5.2.3 document that `FileSystemManager.saveFile` moves its temporary source; the former `rememberMedia` missed those AI/picker consumers. The new regression models an actual move and verifies the durable paths. This addresses a concrete path-lifetime gap; it does not identify every native authentication/null-promise cause or recover a previously lost temporary file.

## Verification and limits

Local client: **296 passed**, zero failed/skipped; structure, runtime syntax and TypeScript pass. Fifteen new behavioral tests cover dates/order, legacy edits, restart Undo/Redo, immediate close, branch invalidation, history bounds, storage failure, malformed history, moved/Undo-only media, explicit AI generation/history preview, native-like free-data cloning, deletion races/scope, reversible naming and late-save checkpoints. Existing tests now assert the requested new behavior rather than session-only history/automatic generation.

Source-CSS projections measure both photo cards at widths 320, 390 and 768 px: all six labels are below their image, use its full width and remain within the card. These are WeasyPrint measurements using sample illustrations, not native WeChat screenshots. No paid provider calls or production operations were made. Backend code/dependencies are unchanged; exact new source-head GitHub CI is recorded separately after publication.

## Short native retest — no paid generation required

1. Update the existing app candidate to **0.4.12**, verify and Compile. Leave the working helper running; no helper update, reinstall or key re-entry is required for this client-only change. Preserve storage.
2. **讨论 → 草稿箱:** verify separate **创建**/**修改** labels. Change an old draft's words and save; modification becomes current, creation remains unknown if it was never recorded. Confirm recently modified wins over recently created.
3. In an expendable saved journal, edit a text box twice, Undo once, then close/reopen or Compile. **Redo should still be enabled** and restore the second text. No AI is needed to test this. Then make a different edit after Undo and verify the old Redo branch clears.
4. Try **删除** on the expendable journal: cancel first, then confirm. It disappears; another journal, source photos and a post snapshot remain. Old sessions from before this update cannot gain retroactive history.
5. **新建 → 选照片 → 风格与比例 → 打开照片AI写作:** input is blank, no spinner/request starts. Close it without generating. Ordinary **AI 写作** behaves the same. Existing **AI建议记录** can restore a preview without changing the canvas.
6. Open forum AI with the existing two attachments. **照片 1/2** should sit below each image. Change the active parameter preview; association checkmarks remain independent. Report a remaining native layout issue without spending another generation.
7. For repeated errors, keep the first full URL/stack/status with secrets removed. Check that newly saved AI thumbnails use the durable path, and Page-map cloning warnings are gone. Native null/auth errors and legacy missing temp files remain separate diagnosis work.

E1 local-gateway stop/restart, V1 configured domestic voice, native PNG/album/share, real multi-photo forum output and phone HTTPS deployment remain open. The shared service's earlier 404/502 observations are not changed by this client revision. The original 48 backlog IDs and all R-series are preserved; R35–R39 track the new requirements and R34 carries the new console evidence.
