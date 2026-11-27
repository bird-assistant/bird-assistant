# 0.4.9: import checks, selected decks and fixed sheet headers

26 November2026, Beijing time. [中文](../IMPORT-AND-SHEETS-0.4.9.md) · [Update commands](NEXT-STEPS.md) · [Backlog](BACKLOG.md)

The user confirmed the equal two-line visual/audio explanation height and padding (U01) in0.4.8. Parameter scrolling works, but tapping to return regressed. Audio-only/both highlighting still failed, reopeningR13.0.4.9 is a source candidate, with phone acceptance pending; retain the existing candidate branch name.

| Finding | Change and remaining evidence |
| --- | --- |
| R17, map strip (M01) | Remove the explicit26px opaque map-base overlay, allowing the native map to reach the tab boundary. Retain safe-area handling; retest on phones and with the drawer open/closed. |
| R18, invalid file types | Validate after the picker and before adding materials: native image/video information, audio extension/container headers. Keep valid files in order and show one native rejection popup naming invalid files/reasons. Identify primary/fallback, post, journal and related avatar photo paths share validation. |
| R19, clipped deck text (U02/U07) | Border-box geometry, bounded audio width and text side padding prevent rounded corners clipping labels; long names retain ellipsis. Native filename/actions testing remains. |
| R13, reopened audio border | Send explicit per-item included paths over setData, bind border colour directly and add a tick. Selected/unselected borders share2px geometry. Bridge regression passes; visible native rendering remains unverified. |
| R20, tap return (R04/M07) | A tap flips the parameter face back. Movement over8px and brief scroll inertia suppress accidental flips. An always-visible top-right return button remains usable at every scroll position. |
| R21, moving close headers | Seven custom sheets now keep title/X outside the bounded body: post writing/journal attachment, journal AI/crop/layers/templates, home location details. Native map/species search and records already had separate headers. |

The remaining speech-note tag selectors now use component classes, addressing the WXSS warning in the screenshot. No backend/model change.

Audio validation is a lightweight container check, not full decoding or a security guarantee. Import permits MP3/WAV/AAC/M4A/MP4/OGG; OGG remains local-only under the existing recognition policy. An MP4 header does not establish audio-only tracks. Actual decoding and server validation remain authoritative; existing recognition format/size/duration limits still apply. No new forum audio/video publishing or arbitrary product cap was introduced.

Stale validation callbacks after leaving or switching journal documents add nothing to the new draft. Original files, existing material and text are preserved.

The team [Qwen issue25](https://github.com/bird-assistant/bird-assistant/issues/25) now includes the [actual client POST404 evidence](https://github.com/bird-assistant/bird-assistant/issues/25#issuecomment-7182645766) from the user's12:10 screenshot. This confirms the real suggestions request path failed, without establishing a bad supplier key. The forum's empty-observation message is local validation, not another upstream error. The maintainer must expose the current writing routes/configuration before real text and explicitly selected-image retests. No admin login, deployment, paid model request or provider migration occurred.

Retest five flows first:

1. Mix valid originals with PDF/DOCX/renamed files in media/audio import; valid files survive, invalid ones never enter the deck, one clear popup appears. Also check post/journal photo import.
2. Check long filenames and audio borders/ticks in photo/audio/both, then deselect/reselect one card.
3. Tap photo→parameters→text to return; scroll in both directions without flipping; use the top-right return anywhere. Save remains centred.
4. Scroll long writing/template/layer sheets to the end: title/X stay visible and closing preserves drafts. Include narrow screens and keyboard-open layout.
5. Check the map has no solid strip below the advisor while tabs/orb/safe area/drawer remain correct.

Then resume the [remaining0.4.8 device list](PHONE-FEEDBACK-0.4.8.md): camera/mic release, multiline journal text, old-work recovery, PNG/album/share, GPS and cluster alignment. Do not request another U01 screenshot after the user's pass.

Local structure/TypeScript/client verification passes **257 tests, zero failures/skips**. Fourteen new regressions cover mixed-file rejection, container mismatch/empty/unreadable files/long names, stale results, explicit native state patches, tap-versus-scroll and all seven sheet structures. Exact-head PR CI is tracked separately. None of these tests ran on the user's Windows/DevTools/phones here.

All48 original IDs andR01–R16 remain;R17–R21 trace new defects, not a re-estimated feature count. Multipage books/combined export, optional Doubao media generation, all six More modules, forum audio/video publication/export and cross-device consultation sync remain queued.
