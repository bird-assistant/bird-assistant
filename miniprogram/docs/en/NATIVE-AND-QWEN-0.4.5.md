# Native interactions and photo journals · 0.4.5

25 November 2026 · [中文](../NATIVE-AND-QWEN-0.4.5.md)

The user's 0.4.4 screenshots reject the close icon, transparent attribution strip, search-panel seam, cold marker taps and import presentation. Earlier release notes remain historical; this document describes the current source.

The phone drawer now spans the width and meets the Tab boundary. Its base is opaque, the upper paper remains translucent, and content fades upward from the base. There is no reserved clear attribution strip. Existing PNG close icons avoid the native button pseudo-element collision. Search results begin exactly at the complete toolbar's lower edge. The visible Tab shell sits above application overlays, with the central recognition button highest within it; focused editors retain their existing hidden-Tab behavior.

Equivalent clusters keep stable native marker IDs. A bounded target history accepts delayed callbacks and string IDs, unchanged marker arrays avoid unnecessary native updates, and the first tap immediately opens records while native fitting focuses the group. Hidden-page callbacks cannot reopen the drawer. Zoom-only regrouping and count conservation remain; real native frames still require device testing.

Observation details link to the original discussion. Reactions and threaded replies appear on the discussion post, while location, attribution, reporting and the return link remain on observation details. No existing posts or replies were deleted. Photos flip to a faded-image metadata face and back; missing settings show feedback, while image enlargement has a separate action. File and author-entered provenance stay distinct, and display-copy dimensions are not original resolution. Known Chinese administrative source names are translated; unknown localities remain unchanged. The redundant feed refresh button is removed, custom pull refresh remains, and the zoom label no longer wraps vertically.

Imported material appears as a visible selection deck with its own identification action. Users can select a photo, an audio clip or both. Photos use the existing real upload path. Audio requires an explicitly installed audio provider; the current client has no audio network provider, so unsupported audio/combined submissions fail before any upload and retain the material. Combined results remain separate rather than mixing scores. Videos remain retainable material. Name avatars use one English initial or up to two leading Chinese characters in local and community profile editing; upload/crop flows remain.

## Qwen and the teammate's photo-to-journal request

The trip service already makes real qwen-plus requests. The revised prompt requests a short recommendation and a validated brief containing reasons, birds to watch for, preparation and uncertainty. The client renders sections, itinerary rows and collapsible sources/full explanation. Older service responses are split at sentence boundaries; the richer brief requires deployment of this backend change. Evidence IDs, destination IDs and itinerary limits remain validated, and historical sightings do not become claims of guaranteed present sightings.

Stops open either the app map or the WeChat location page through wx.openLocation. Navigation-app availability is controlled by WeChat and the device; no arbitrary installed-app chooser is promised. Public sighting grid centers stay explicitly approximate, while named parks use their park coordinates. See [WeChat location API](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.openLocation.html).

Journal setup adds a direct photo-to-journal action for 1–4 personal photos. Before the action, the UI explains that bounded copies and explicitly included notes are sent to Qwen. It creates an editable local draft, requests title/body/layout suggestions through the existing team gateway, and previews before applying. Users can apply text or text plus layout, undo the edit, cancel before or during photo preparation, and reject results after concurrent document changes. Originals remain; samples cannot be presented as real photo observations. Unknown species, GPS, capture time, weather and personal experiences are not invented.

Text-only requests use the configured qwen-plus text model; image requests use the configured vision model, currently qwen3-vl-plus by default. Secrets remain server-side. This round did not reuse a credential from chat, make paid provider calls, or deploy cloud services. JSON Object plus application validation is retained; JSON Schema support is not assumed for the deployed model. See [Alibaba structured output](https://help.aliyun.com/zh/model-studio/qwen-structured-output).

## Validation and acceptance

Client verify: **162 passing**. Local Python3.12 backend: **468 passing, 55 skipped, 85.36% coverage**, with Ruff checks passing. Deployment locks are unchanged; exact-head locked and real-CPU CI are separate environments and their counts must not be added together. There are 45 source projections across 320/390/768 widths and 15 states, using original sample artwork. [Projection](../design/interface-0.4.5.png) is a print layout check, not native-device acceptance.

| Priority | Pending acceptance | Required evidence |
| --- | --- | --- |
| P0 | Actual identification | Real bird/no-bird/multiple/unknown photos, import/capture, cancellation, page return and failure recovery; correct service/tunnel configuration |
| P0 | Posting and interactions | Personal-photo publication/moderation, likes/bookmarks, root/nested replies, unsent text, at least 20 repeated visits and Tab switches |
| P1 | Real Qwen flow | Deploy the structured brief, verify evidence; use real personal photos with the visual journal model, preview/undo and failure handling |
| P1 | Native map | Cold first taps at low zoom, pinch-only regrouping, circle spacing, bottom coverage, toolbar seam and central-button layering |
| P2 | Personal profile | Upload/crop/cancel/save/reopen and English/Chinese initials; the overall profile is not yet acceptance-tested |

Regional sighting progress remains an optional future design, ideally driven by saved real observations and coarse regions rather than precise public tracks. Coordinated cloud functions, adaptation and further motion effects remain future work. Native SDK authentication/network diagnostics have not been hidden or claimed fixed. Pull the existing Windows project, run verify and fully Compile so component/page JSON changes take effect; preserve local AppID, settings and gallery.
