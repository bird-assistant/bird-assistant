# 0.4.20 — date controls, white bookmarks and portable originals

28 November 2026, Beijing time. This client candidate extends 0.4.19 on the existing candidate branches. The user explicitly chose **keep server work paused; add backup/restore now**. Backend, credentials, deployment and inactive CloudBase preparation are unchanged. Uploaded 0.4.18 and the source under team PR #30 remain frozen.

## Changes

The new-journal material picker, journal home and filter drawer now share one horizontal date-control rule. A flex-specific zero width had been applied inside the picker's grid, producing vertical labels. Both placeholders and selected dates now stay on one line. Saved-place map markers keep solid green fill and use an opaque white border instead of yellow.

Saved places and journal records now have protected user-file snapshots. Launch/read migrates existing valid records; two complete snapshots alternate with revision/integrity checks. The latest valid file is authoritative; key-value storage is a compatibility mirror. A failed mirror write does not conceal a successful original-record save, and an interrupted file write leaves the prior valid snapshot available. Each domain is migrated independently.

**My → Local backup and restore (`本机备份与恢复`)**, also linked in Settings, exports all saved places plus selected journals. It includes text, layout, current original photos and photos referenced only by retained Undo/Redo. No photo compression, automatic upload or login is involved.

## What survives which cleanup

| Action | Result / boundary |
| --- | --- |
| In-app journal preview cleanup | Removes only regenerable preview PNGs and indexes; bookmarks, journal records/history and their original photos remain. File-backed journals participate in reference protection even when the KV mirror is missing. |
| In-app public guide-photo cleanup | Own disposable reference-photo directory only; original and backup directories are excluded. |
| KV storage is lost, user files remain | Reads verified protected records; an explicitly deleted empty collection stays empty. |
| WeChat removes all mini-program data/user files | Can remove every local copy. Save a complete backup outside WeChat beforehand, then restore from that file. This is not cloud sync or undeletable storage. |
| Data was already fully erased with no earlier copy | This revision cannot reconstruct it. |

## Export and restore

1. Choose journals, then generate a `.birdbackup` file. Saved places are always included. Each file supports up to64 MiB of original media; split large libraries into batches. Identical source paths are stored once. An unreadable required original causes an explicit failure, never a silently incomplete backup.
2. Press **Send / save backup file**. Send to File Transfer Assistant and download on a computer, or save through an available system-file destination. **Generating a file inside the mini-program or returning from native sharing does not prove it exists outside WeChat.** Confirm the external file before a full data clear.
3. Put the saved backup into a WeChat conversation on the destination device, then choose it from the restore page. Inspect counts/date/size, explicitly confirm, and let every photo verify before the collection commit.
4. Restoration preserves current content. Same-coordinate bookmarks retain the current record; a journal ID conflict creates a `恢复副本` instead of overwriting newer edits. Embedded history IDs follow the restored journal. Failure/cancellation deletes only this attempt's staged files.

The archive covers saved places and selected journals, not account state, community post bookmarks, DMs, field memos or other local records. It contains private photos/coordinates and is not encrypted; retain it in a trusted location. Metadata snapshots have a4 MiB cap, with an explicit error and prior records preserved if exceeded. Original images stream in256 KiB chunks rather than one enormous base64 value. Available device storage still applies; no original is automatically evicted to make room. Checksums detect accidental damage; they are not signatures.

## Verification and remaining acceptance

`npm run verify`: **458 passed,0 failed/skipped;24 WXML and26 WXSS compiled** by bundled WeChat WCC/WCSC. The12 new behavioral tests cover migration, KV loss, both cleanup controls, failed mirrors, interrupted snapshots, full simulated user-file loss followed by external-file restoration, exact active/Undo-only photo bytes, conflict copies, damaged metadata/media, cancellation, arbitrary file-reference rejection and failed restore commit. See [evidence](../CACHE-SAFETY-0.4.20.evidence.json).

The changed/new views have **240 source layout projections across30 sizes /8 states**, with no horizontal overflow; both new-journal date states stay horizontal. Browser projection and mocked filesystem failure tests do not establish native WeChat file-picker/share permissions, phone touch or full DevTools Compile.

Before upload: full Compile in the existing project; compare picker/home date controls and the white bookmark; verify both in-app cleanup controls preserve real bookmarks/journals; export actual photos, download the file outside WeChat, select it back and check restored editing/Undo/photos. Use independent test data for any full-clear acceptance, after confirming a saved external copy; do not erase the sole user original as a prerequisite. Also check native sharing success/cancel, background cancellation and disk-space failure. No new experience upload was performed here.

## Follow-up IDs

| ID | Work | State |
| --- | --- | --- |
| R105 | Shared horizontal journal date controls | Source/30-size geometry passed; native acceptance pending |
| R106 | Solid green bookmark with white outline | SVG/PNG updated; native map acceptance pending |
| R107 | Protected originals separated from disposable caches | Behavioral tests passed; native filesystem acceptance pending |
| R108 | Portable original-photo backup and merge restore |12 recovery/failure tests passed; native file handoff pending |

All48 original backlog IDs and R01–R104 remain. The private repository's canonical English `docs/NEXT-STEPS.md` remains the working plan. Existing social, identification and deferred server work remains visible.
