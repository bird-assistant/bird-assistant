# Friends, DMs and groups — design and implementation contract

28 November2026, candidate0.4.17. This documents the existing business implementation and the newly refined UI. These are account-backed service features; they are distinct from local journal/draft/saved-place storage. CloudBase preparation currently provides read transport only, not a second messaging backend.

## Entry points and screens

Discussion→More→Find birders opens discoverable member search. Member cards link to the public profile with an explicit friend request and private-message action. Discussion→More→Messages shows incoming activity, DM threads and group invitations. Friends separates accepted, incoming requests and outgoing requests, with counts; the initial tab may be selected by route. Groups separates joined rooms from invitations. A chat header states the privacy context; outgoing/incoming text bubbles and timestamps stay separate from composer/send/retry.

This revision does not turn drafts into public posts or journals into a cloud account. Resume names are bold italic. UI counts come from the normal business service. Existing ten-second foreground polling stops on hide/unload; no background realtime or push service is implied.

## Friendship state machine

| Perspective/state | Visible action | Backend change |
| --- | --- | --- |
| none | Add friend | PUT friends/{peer}/request → outgoing for sender, incoming for peer |
| incoming | Accept / decline | accept → friends; decline → none |
| outgoing | Cancel request | cancel → none |
| friends | Private message / remove friend | remove → none, no automatic deletion of prior conversation |
| either account blocks the other | No new request/message | Reachability/privacy checks deny; blocking removes friendship |

`PUT /api/v1/community/friends/{peer}/{request|accept|decline|cancel|remove}` uses canonical unordered pairs plus requester identity. Repeated same accepted/requested/removed operations are idempotent when the resulting state matches; invalid transitions conflict. Self-request is forbidden. Existing service limits apply (currently40 friendship inserts per rate window); do not encode a guessed time period into UI copy.

The UI disables repeated actions until the result, then reloads authoritative membership. Incoming/outgoing tabs use server relationship values; they are not inferred from avatar/name. A failed request retains the current state and offers retry. No notification is sent to another service by this design work.

## DM behavior and privacy

`GET /api/v1/community/inbox`, `GET /messages/{peer}?before=...`, `POST /messages/{peer}` and `PUT /messages/{peer}/read/{message}` supply thread summaries, chronological page results, sends and a monotone read cursor. Recipient privacy may require friendship. Either-side blocks and self-send rules are enforced server-side. A DM is private to participants; a discoverable profile does not grant message permission.

Each send carries an operation reference. Retry the same submitted text using the same reference after an uncertain response; a different body/recipient with the same reference conflicts. Keep the text draft while pending; when an old acknowledgement returns, clear only the exact submitted draft, never newer typed words. Account, chat/view and request revisions invalidate late UI updates. Current sends are text-only. Read a message only after the chat is visible and eligible, not merely by listing the inbox. Existing server limits currently cap sends at60 per rate window; no new time-window claim is made here.

Known scale limit: history pages use timestamp `before` and bounded60-message pages. Equal-timestamp cursor ties deserve a future composite timestamp+ID cursor before high-volume rollout. No guaranteed WebSocket delivery/order across clients, offline outbox, read receipt broadcast, attachment transfer or end-to-end encryption is implemented. Don't label a successful database acknowledgement as another person's reading.

## Group behavior

| State/actor | Action and rule |
| --- | --- |
| creator | POST groups with stable creation reference; creator becomes joined owner |
| owner | PUT groups/{room}/invites/{peer}; mutual friend required, existing membership preserved |
| invited member | accept or decline via membership action; invited is not joined |
| joined member | Read/send text after membership and block checks; leave removes membership |
| owner | disband removes room/membership/messages; owner cannot silently leave without disband |
| nonmember | No history or send access |

Routes: `GET/POST /api/v1/community/groups`, `PUT /groups/{room}/invites/{peer}`, `PUT /groups/{room}/membership/{accept|decline|leave|disband}`, `GET /groups/{room}?before=...`, `POST /groups/{room}/messages`, `PUT /groups/{room}/read/{message}`. Service checks owner/membership, current100-member cap and existing rate limits. Group message reads begin at the member's join timestamp, so invitation acceptance does not expose all prior room history. Blocking suppresses blocked peers' content. Group creation/message references make retries idempotent.

Current roles are owner/member. Admin promotion, ownership transfer, member removal tools, invitation expiry, join links and room discovery are future designs, not hidden existing features. No public join-by-ID shortcut should bypass invitations. Disband is destructive and stays an explicit confirmation in the UI.

## Moderation, notifications and data ownership

Existing report/block/admin paths stay with the business service; no client can approve its own content. Replies and identification activity use existing inbox/activity summaries. Poll badges show total participation, not public voter identities. Push/subscription notifications are not enabled; a future design needs explicit per-user opt-in and actual approved templates, with in-app source state remaining authoritative. Favorites keep account privacy; local saved places remain private local bookmarks.

CloudBase service functions must forward an existing verified business session. Do not mirror friend or membership documents with permissive client writes, cache another user's session in a warm function or make an OPENID string in event data authoritative. Future identity consolidation requires an explicit migration/rollback plan, not duplicate user creation.

## Validation and work remaining

Automated tests cover existing social transitions, authorization/idempotency/read behavior and late-send protection; all backend tests are run for this revision. Native acceptance needs two real accounts: request/cancel/accept/decline/remove, friends-only DM, either-side block, retry after lost acknowledgement, newer words typed during pending send, invitation accept/decline, joining/history boundary, leave/disband, unread and account switch. The new visual states are also included in the900-case source projection matrix.

Next implementation priorities after native acceptance: consistent notification navigation directly into incoming requests; composite history cursors; request/invite history and expiry policy; clearly scoped offline retry if needed. Product decisions for rich media, receipts, notifications, group administration and retention must be agreed before adding infrastructure. [CloudBase deployment](CLOUDBASE-0.4.17.md) is prepared/inactive; the current host still needs the backend rollout listed in [revision handoff](INTERACTION-0.4.17.md).
