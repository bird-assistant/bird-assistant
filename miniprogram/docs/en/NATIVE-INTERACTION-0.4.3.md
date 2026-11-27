# Map, forum and camera interaction · 0.4.3

25 November 2026 · [中文](../NATIVE-INTERACTION-0.4.3.md)

This client iteration follows the latest screenshots and feedback within SRS MAP-01/02, ID-01, LIVE-01 and COM-02. Counts remain observation records, never bird counts. Existing vision sessions, evidence review, private saving, public redaction and authentication stay in place.

| Feedback | Resulting behavior |
| --- | --- |
| Single observations become pins too early | A single record remains a numbered circle below query zoom16. At16 and above it becomes a pin; multiple records stay numbered circles |
| Zoom needs a subsequent pan to refresh | Both top-level and detail begin/end event forms are handled. Gestures sample the viewport every160ms; render notifications use a fixed throttle window instead of continually postponing reads. Gesture end reads the final view after30ms |
| Circle taps are ignored during refresh | Removes the global loading lock. Taps immediately move the map or open a loading record panel. Unique marker IDs retain their original filter snapshot and one previous native-render generation |
| Oversized drawer and solid bottom strip | The phone drawer floats over the unchanged native map, capped at300px and46% of map height. It has rounded lower corners, an internal fade and36px of native attribution clearance below |
| Panning dismisses the list | The open drawer shrinks to its header during the gesture. Clusters and records follow the new region; fresh settled records restore expansion. A drawer deliberately collapsed by the user stays collapsed |
| Native More sheet breaks the visual style | An application-styled rounded tool sheet retains library, external sightings, friends, messages, groups and local-draft destinations |
| Refresh lacks a visual cue | Three small staggered bird silhouettes fly through the top refresh control while loading. Pull-to-refresh, retries and reduced-motion handling remain |
| Camera metadata is raw text | A photo information card shows the shared device and focal/aperture/shutter/ISO badges. Missing fields remain missing. A trailing internal device identifier is omitted from the displayed name without changing the record |
| Recognition page lost the older hierarchy | Restores the translucent visual/audio tabs, small start/stop action, zoom shortcuts and shutter row while retaining real live vision and high-quality photo analysis |
| Zoom ruler needs swipe expansion | Swipe up within the zoom area to reveal the ruler and down to hide it. Horizontal drags adjust zoom with direction locking; tap expansion and0.1-step controls remain |

Cluster and record requests have separate generations. Old responses cannot replace a newer viewport or reopen a dismissed panel. Hiding/unloading stops gesture sampling, clears timers and rejects late results. Pagination still deduplicates records and blocks duplicate loads. Viewport failures expose a retry rather than causing a render-driven retry loop.

The forum's initial Page options no longer contain a Set. Reaction locks live in a WeakMap keyed by page instance, addressing the non-simple free-data cloning warning without suppressing other diagnostics.

Zoom availability comes from camera initialization's maxZoom and the actual setZoom response. A recognized Pura70Pro+ name prefers1/2/3.5/5/10 shortcuts. Unknown models offer both3 and3.5, filtered against their reported range. These are ratio requests, **not a promise of selecting a physical lens**. The installed official5.2.3 WeChat type contract exposes no vendor Snapshot, shutter-speed or physical-lens selector. The camera help suggests taking fast subjects with the system camera and importing the original; it does not offer a fictional Snapshot toggle.

Validation: `npm run verify` reports **140 passing, zero failed/cancelled/skipped**. Regressions cover zoom-only gestures under continuous render events, stale responses, taps during loading, compact/restore/manual-collapse behavior, native read failure and recovery,3.5× and actual returned zoom, gesture direction separation, custom menu destinations, instance-owned reaction locks and sparse EXIF. Backend source and dependency versions are unchanged. Old0.4.2 CI results are not evidence for this head.

Seven source-projected views at320/390/768 widths use original project illustrations rather than chat screenshots. See the [review board](../design/interface-0.4.3.png) and [layout readings](../design/interface-0.4.3-bounds.json). Reproduce after `npm test` using `node scripts/review-interface.mjs` and `python scripts/render-interface-review.py`. Optional QA dependencies are WeasyPrint68, Pillow and PyMuPDF, separate from application dependencies. A print projection does not emulate native cameras/maps, touch events or safe areas; native and some print-flex readings cannot establish pixel acceptance.

Design reference: [SmugMug's official EXIF information panel](https://www.smugmughelp.com/hc/en-us/articles/18212410328596-Display-a-photo-s-EXIF-information), using the separation of photo and information, without copying photos or interface assets. Platform checks use the [official WeChat typings repository](https://github.com/wechat-miniprogram/api-typings) and the installed5.2.3 declarations. Tencent's [camera](https://www.tencentcloud.com/zh/document/product/1219/57744) and [map](https://www.tencentcloud.com/zh/document/product/1219/57775) documentation are supplementary; another runtime's contract cannot establish WeChat device support.

Still requires the existing DevTools project and phone: continuous pinch event timing, rapid circle taps, drawer behavior while panning, native attribution/Tab clearance, actual Pura70Pro+ zoom/lens routing, lifecycle transitions, long-press video, real models and original-photo import. The screenshot's SDK authentication/network error and render-layer null rejection cannot be declared fixed by layout changes. Application viewport failure is covered; SDK causes still require real configuration/network investigation.

Next round: Qwen configuration and live calls, then posting/reply acceptance when the shared backend is ready. This iteration performs no deployment, live posting/reply or Qwen call. Journal feedback is recorded as stable for now with further refinement deferred. Guide/search/comparison improvements are preserved; profile review awaits user feedback. Full Issue23 and cross-device acceptance remain open.
