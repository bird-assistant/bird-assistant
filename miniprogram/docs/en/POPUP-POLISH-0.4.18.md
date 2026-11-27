# Popup and visual polish — 0.4.18

28 November2026, Beijing time. Focused follow-up to the user's0.4.17 acceptance. No server, provider, CloudBase activation, identification workflow or new social feature is changed in this pass. The user accepted the downward delete effect and the improved forum interaction synchronization; both remain.

| ID | Change | Native smoke check |
| --- | --- | --- |
| R87 | Native saved-place marker is a solid forest-green bookmark with a solid gold border. Ripple strokes use six-digit RGB, start green, interpolate toward warm white as they expand and thin away; center is green. Geographic anchoring and9-second lifetime remain. | Inspect marker fill on light/dark map tiles; focus, drag and zoom during the wave |
| R88 | Cloud opacity follows the paper's actual leading edge, including scale and rotation. It rises in an approach zone capped at64px and bounded by the resting gap and is fully opaque16px before the date-control boundary; no fixed45% gesture gate. Fog and card motion update together. Resting hold still has no fog; downward delete stays fog-free. Soft moving wisps sit below an opaque cloud body; reduced-motion disables the drift. | Slow upward drag: date blocks are already covered before the paper reaches them; pause/reverse/cancel |
| R89 | Deck lane width derives from available card height and screen width. Shorter phone cards become narrower while keeping existing canvas ratios and whole-page previews. Gesture travel uses the same lane width. | Pura80 simulator portrait, narrow/short screen, all3 ratios, side swipe and footer reachability |
| R90 | All15 custom sheet headers own downward drag/flick dismissal. Crosses and backdrop taps remain. Short/upward/sideways/multi-touch gestures snap back instead of closing; no idle timer. Calendar header grip has a real touch area. Page-level scroll lock covers all modal flags; the forum's native background scroller/refresher are also disabled while open. Modal content keeps its own bounded native scroller with bounce disabled. The panel does not catch content touchmove above that scroller. | Vote/search, short choices, long writing/history, calendar and sharing: header drag closes, content scroll stays inside, underlying page offset stays unchanged, then normal page scrolling returns |

R01–R86 and all original48 backlog IDs remain historical records; R87–R90 extend them. All current custom popups are covered, including journal AI/history/crop/layers/templates/sharing/filters, forum tools/writing/history/journal picker, home place panel, voting, choice sheet and calendar. System-owned WeChat dialogs remain system-owned.

## Validation

Client421 tests pass, zero failed/skipped; bundled WCC22 WXML and WCSC24 WXSS compile. Regression tests cover drag/flick/cancel/multi-touch, no idle timeout, fog full before contact and green-to-white wave progression. Source audit finds15 wired headers. Bookmark face/border pixels are fully opaque.

900 browser source projections across30 supplied/custom sizes pass horizontal/panel/card/close-button/hint/draft-action geometry checks. Representative Pura80 journal rest/early-up/full-up/delete and vote/calendar states were visually reviewed. These are source projections, not native touch/permission/FPS evidence. Backend source and dependency locks are unchanged; its previous local510/53 result is not a new server deployment.

## Quick path before experience upload

Keep the existing candidate checkout, AppID/private config, local data and helper terminal. Follow the canonical English Windows update commands, run npm ci/setup/verify, then full Compile in the existing DevTools project. Expected version0.4.18 and421 tests.

Briefly check the five user-facing behaviors: solid bookmark; green washing ripple; early opaque fog with no fog while holding/downward deleting; narrower card; close vote/choice/calendar/share by X, backdrop and header drag while keeping content/background scrolling separate. Check one short popup with no scrollable content and one long popup at its scroll limits. Then upload through the normal user-controlled experience workflow if native checks pass. No experience upload was performed here.

## Next pass

After this experience candidate: continue the existing CloudBase/server preparation, profile/personal-notes design and the six More modules (species library, external sightings, friends, inbox, groups, drafts). Keep identification/journal expansion for the teammate's return as requested.0.4.17 CloudBase source/instructions remain prepared and inactive. Hosted writing404 and withdrawal405 are separate rollout work, not part of this quick patch. Post-forward success redesign remains pending. No team merge, production deployment, paid model call or credential change.
