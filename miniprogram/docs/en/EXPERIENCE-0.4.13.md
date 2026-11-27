# 0.4.13 experience-build handoff

27 November 2026, Beijing time. The full mini-program package is prepared for a new team PR based on the team's current main, after PR24 was merged by a teammate. No team merge, production deployment or experience upload is performed here.

## Current behavior

- Both journal AI entry points remain blank and idle. After an explicit Generate, selected photos can use a short, natural, visible-details-only default. User instructions take precedence. Selected existing text can similarly use a conservative polishing default; a request with no usable material still stops locally.
- Destination explanations distinguish an independent new text box, rewriting the selected box, and the page's opening overview. The saved journal name is independent; the preview shows the affected target before applying.
- A direct **AI建议记录** entry sits in the editor. Successful suggestions are scoped to this journal or post draft. Loading only restores a preview. Old results that were never stored cannot be backfilled.
- All nine existing shared bottom sheets measure their body and header. Short content shrinks, long content has a viewport cap and native internal scrolling. Updates are coalesced, results arriving during a measurement trigger a fresh measurement, and closed sheets add no selector-query work to dragging/feeds. The separate native map component and other popups remain in the wider X01–X03 space audit.
- The deck shows the journal's actual composed page using the editor's text layout and photo crop functions: paper, text, images, tape and ornaments. Only the current and adjacent pages have render projections; editing history stays outside the render data. Bad thumbnail paths are remembered until the source changes. Lower deck padding is reduced.
- Posts already allow nine visuals including up to three journal snapshots. A single AI request still references at most four, matching the working gateway. The UI now names that distinction.
- Startup logging and package metadata say0.4.13. No dependency, backend or helper restart is required.

## Evidence and limits

The user accepts0.4.12 draft dates, restored Undo/Redo across reload, a new edit clearing the abandoned Redo branch, deletion and forum labels. Keep those accepted results. The one-photo empty-prompt screenshot was local validation, not a returned provider failure; its confusing default is addressed above. The generic native authentication/null errors remain unresolved without their first complete stack and request details.

`npm run verify`: **307 passed, zero failed/skipped**, including route/config/asset/handler checks, WXML tag balance, TypeScript and runtime syntax. Eleven added behavior tests cover default requests, bounded/async/resized/unloaded sheets, thumbnail projections and the direct record entry. Two older tests now reflect the intended photo-only Generate action. An additional offline syntax pass parsed20 WXML files/1,765 template expressions and22 WXSS files, with no duplicate template attributes or syntax errors. No assistant-initiated paid generation was made.

This is not a native DevTools compilation claim. An isolated miniprogram-ci attempt stopped at a network-blocked project-metadata response before compiling; no code upload occurred. Compile the existing Windows project with its valid local AppID before uploading an experience version. Native scrolling/rendering and phones remain acceptance checks.

## Quick release check

Keep the running writing-helper terminal unchanged. Update the existing private candidate branch and run setup/verify; new team clones run `npm ci`, setup, verify inside the outer `miniprogram/` folder. Setup preserves an existing AppID. Leave journals/drafts/media intact.

1. Compile in the existing DevTools project; check0.4.13 startup and no WXML/WXSS/TS compile errors.
2. Inspect the composed journal thumbnail, swipe between journals, open and return without changing their content or names.
3. Open AI records from the editor: empty content stays compact; long records scroll below a fixed header. Repeat the empty forum-history case. Open layers/templates to check short versus long contents.
4. AI opens empty and idle. One optional useful provider test: choose one original photo, leave the request empty and explicitly Generate. Review the default request and returned suggestion, then change destination before applying. This uses the user's model allowance; do not repeat already accepted paid flows.
5. Test narrow/notched/tall Android/iPhone profiles, then the user's and friend's actual phones on the chosen experience build. Record model/OS/WeChat/build and failures for keyboard/safe areas, overlap, scrolling, media and permissions.

Phones need hosted HTTPS; the Windows localhost helper supports DevTools only. This team PR updates the full client package, leaving the team backend and deployment untouched. Recognition, ASR, publication and hosted AI each need their actual services; they are not proved by local tests.

## Preserved follow-up requirements

Track these alongside all original48 IDs and R01–R39, not as completed features:

| ID | Requirement / decision |
| --- | --- |
| R40 / Q03 | Photo-only explicit Generate works with blank optional instructions; clear new/selected/overview scope. Candidate implemented; native/provider retest pending |
| R41 / X01–X03 | Content-driven minimum/maximum sheet height and bounded overflow across the app; nine shared sheets implemented, wider whitespace/popup audit remains |
| R42 / Q05 | Actual journal composition in deck thumbnails and less bottom padding; bounded neighboring projections implemented, native device review pending |
| R43 / X02/Q05 | Press-and-drag paper interaction: upward threshold opens share options, downward previews a bin and asks confirmation. Keep horizontal deck navigation, vertical page scroll, cancellation, regular buttons and reduced motion usable. Do not remove data or publish during a gesture |
| R44 / Q01–Q03 | AI should infer purpose, source scope, destination, tone/length and layout constraints from the user's goal, ask only necessary questions, and minimize manual intervention. Next design: structured intent → bounded content/layout plan → deterministic fit/readability validation → preview and one Undoable application. Evaluate goal completion, factuality, fit and intervention count rather than prompt wording alone |
| R45 / F01/X02 | Post forwarding and journal sharing destinations. A WeChat post link need not wait for private/group chat implementation; track those channels separately. Prefer PNG for a single-page finished journal, PDF for later multipage export; retain the editable original. Formats and destination availability need actual native capability/permission checks before implementation |

Do not implement the gesture and messaging work as a last-minute change before this experience build. The user will choose upload timing after the final Compile and smoke check.
