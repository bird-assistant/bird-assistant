# Window layout and Back behavior — 0.4.21

## Rules

Choose from the **current app window**, not phone brand, DPR, diagonal size or a claim that every iPad needs two panes. Wide-but-short windows and narrow split view may still need one pane. Never stretch a paper/photo simply to fill horizontal room.

The implemented notes workspace uses two panes at **window width≥860 CSS px and usable height≥440 px after the custom header**. The secondary list is280–352px; the editor receives the remaining width, at least420px. At smaller sizes the current list or editor fills one pane. iPad/desktop resizing is enabled; notes opts into phone auto orientation. Existing camera/journal resize handlers and full-screen presentation remain, with physical keyboard/rotation acceptance still required.

| Module | Narrow window | Wide window and dominant content | Back semantics / state to retain | State |
| --- | --- | --- | --- | --- |
| Notes | List, then editor | Secondary list / dominant editor | Close observation picker → save and clear note focus → return to origin. Preserve search, tags, list offset and draft; a failed save blocks changing selection. | Implemented |
| Map | Map plus bottom sightings drawer | Dominant geographic map / bounded side sightings drawer | Close filter/search → return from detail to the same selected map/list/filter/zoom context. | Existing wide drawer; native retest |
| Bird library | Catalogue → bird detail | Secondary catalogue/search / dominant bird detail; comparisons open a focused view | Close compare/overlay → previous bird/detail selection → catalogue origin. Keep query and loaded page; Back must not refetch/reset by accident. | Design next |
| Forum | Feed → thread | Secondary selected feed / dominant thread and composer | Close poll/attachment view → quoted reply target/composer context → selected feed tab/scroll. Preserve unsent text, not an uncontrolled new route per click. | Design next |
| Messages | Inbox → conversation | Secondary inbox / dominant conversation; group settings are a drawer | Close settings/member drawer → conversation → inbox → origin. Switching conversations first preserves the draft; no duplicate chat history store. | Design next; existing API retained |
| Journal | Fixed deck, focused editor/share | Centered ratio-preserving paper; optional inspector beside the canvas | Close current tool/sheet → editor/deck → origin. Preserve selected paper/element/Undo and share return state. | Existing presentation; inspector deferred |
| Identification | Focused camera/review | Full camera viewport with bounded result region | Dismiss result/tool before leaving a capture session. Do not place a permanently dominant navigation list beside the live camera. | Existing behavior; deeper work waits for teammate |

## Focus and navigation

A pane selection is not a new global tab or a reason to push unlimited native pages. In wide notes, the first Back from an editor clears note focus while keeping the list; the next Back leaves the route. On a phone it returns to the same list first. Both modes therefore have the same semantic hierarchy. The active app tab changes only for an explicit global destination.

Both notes panes own bounded scrolling. The same list-scroll owner/offset survives fold/resize; a different outer-page scrolling scheme is not introduced when narrowing. Unsaved native-navigation protection is enabled while dirty where supported, and a save error keeps the current editor selectable/copyable. A force-killed app or unavailable native guard still cannot guarantee an unsaved in-memory edit.

System/native confirmations are global when their action affects the cloud snapshot or another irreversible resource. In-app tools belong to their current task, with close/backdrop/header-drag and independent content scrolling. Closing a tool should restore the control that opened it. No device-specific physical hinge position is guessed: measured safe-area/window segments, where supplied by the platform, and actual foldable testing govern that later work.

The38 reviewed window sizes include the user's30 DevTools profiles, four landscape iPad scenarios, two split-view sizes and859/860px boundaries. Added dimensions are engineering scenarios, not measured physical devices. Browser source projections check fit; they cannot certify keyboard behavior, touch ownership, camera rotation or a physical hinge. Those remain in the native acceptance queue.
