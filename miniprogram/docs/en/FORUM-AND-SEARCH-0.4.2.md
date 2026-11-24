# Map, bird guide and forum experience · 0.4.2

2026-11-25 · [中文](../FORUM-AND-SEARCH-0.4.2.md) · [Source layout projection](../design/interface-0.4.2.png)

This continues the reviewed 0.4.1 source and team d59be67 integration. Recognition business logic is outside this round. Its page JSON only gains a local header registration after removal of the global registration.

| Feedback | Implemented behavior |
| --- | --- |
| Remember the map | Restore the last settled native center and zoom. Invalid/full storage cannot block the map or trigger location permission. |
| Attribution crosses the list | On phones, shorten the native map above the independent list; wide windows put the list beside it. Attribution stays in the native map. Programmatic resize events preserve the list; user pan/zoom closes it and refreshes. |
| Live bird search | Home, comparison and reply suggestions use a shared 220 ms debounce. Empty input shows no matches. Results scroll in a bounded area and paginate with exact/prefix/stable ordering. Older responses are invalidated on edit/dismiss/hide. Old servers without pagination advertise only the first batch. |
| Photo letterboxing/loading | Size the actual image border to its natural ratio, with transparent background and loading/retry/missing states. Coalesce/cache public guide metadata for 5 minutes, bounded to 32 entries. Keep licensed image endpoints and credits. |
| Unclear guide tabs | Rename to Guide / Places / Related discussions. Places separate name, count and date, with more pages. Discussions offer an explicit species-topic post. |
| Uneven comparison | One centered wider column; equal columns for up to 3 birds with horizontal scrolling. Align image, credit, seven trait rows and sources even when an image or trait is missing. |
| Ornament ratio lock | One toggle restores/locks the original ornament ratio; another click unlocks it. Width and corner resize respect bounds, undo and saved state. Older ornaments remain free until locked. |
| Forum structure | Compact author/time/topic feed with title/excerpt, thumbnail, like/reply/bookmark controls, top refresh, pull-to-refresh and paging. Full title/body composer, draft and publication preview. |
| Reply flow | Visible reply chains, reply target and moderation state; optional species suggestion. Failed requests retain text, target and retry ID; edited content gets a new ID. Load earlier replies in 100-row pages. |

Replies add an optional parent, validated as approved and in the same post. The additive SQLite migration preserves existing rows, moderation and idempotency. Public counts include approved replies; pending replies are visible only to their author. Bookmark totals stay private. Species topics apply only to standalone posts and cannot override private observations or external/map records.

The client checks `features.threadedReplies` / `features.speciesPosts` before sending new fields. Old servers retain ordinary replies and existing reactions; full threads and accurate public counts require the updated business service. This uses the existing Python gateway and moderation system; no unconfigured WeChat cloud functions are introduced.

Qwen trip advice already uses the backend harness and `qwen-plus`. Text-only writing now defaults to `BIRD_BUSINESS_QWEN_TEXT_MODEL=qwen-plus`; explicitly selected photos retain configurable `BIRD_BUSINESS_QWEN_MODEL=qwen3-vl-plus`. Server-only variables are documented in the team backend `.env.example`. The deployment drop-in now optionally loads `/etc/bird-assistant/writing.env`; the administrator manages this 0600 file. No live request or deployment was performed.

For a Beijing workspace, the base URL template is `https://<workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`. Verify region/workspace/model access in the console; see [Alibaba's official endpoint documentation](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope). Offline transport tests do not prove a live account is enabled.

Validation: client 132 tests passed plus structure/runtime syntax/type checks; backend 469 passed / 51 environment-related skips, 86.60% coverage; pinned Ruff 0.17.2 lint and 113-file format check passed. Layout projections cover six views at 320 / 390 / 768 widths using actual WXML/WXSS and original sample content. The print renderer has native-control, keyboard, map and flex limitations; projections are not WeChat screenshots or device acceptance.

The two application-owned console warnings are addressed with local header registration and a class selector in `bird-crop`. SDK preload/canary/worker messages remain separate platform diagnostics. Pull in the existing Windows checkout, run `npm run verify`, then compile the existing DevTools project. Check attribution/resizing, keyboard/search/replies, portrait/landscape retries, real forum integration, and ornament drag/undo on actual devices. Dependencies and local project configuration are unchanged. Other pages remain for the next round.
