# Social and media decisions after the uploaded experience build

28 November 2026. This is a client/design handoff. Existing backend files, CloudBase functions, transport, credentials and deployment are unchanged. The server is being recovered separately; there were no live business, model or messaging calls during this revision.

## Current versus proposed

| Area | Working client against current contract | Needs a later server contract |
| --- | --- | --- |
| Friends | Discoverable member lookup, explicit request/accept/decline/cancel/remove, profile and DM entry, copy own handle | Request notes, abuse throttling beyond current limits, QR/deep-link discovery if later approved |
| DM | Text history, send/retry/reference, server read cursor, block/report, local drafts/remarks/pins/hide | Private media, attachments, read receipts to the sender, composite history cursor, realtime delivery, robust multi-device outbox |
| Groups | Create, consent invitation, owner/member display, member search, text, read cursor, leave/disband; local group remark | Shared rename/announcement, administrator role, remove member, owner transfer, permissions revision and audit history |
| Forum | Existing moderated text and threaded replies; local draft/quote recovery, folded thread display; existing post reactions and reporting | Image replies, per-reply likes, report targeting a reply, composite thread pagination and moderation tombstones |
| Forwarding | Public content reference through existing DM/group text API; explicit recipient review; resolve visibility when opening | A typed/versioned message-card payload and future journal/media cards with audited visibility |
| Notifications | Current inbox/activity/invitation data, local recoverable hiding | Account-wide read/hide settings, push subscriptions and moderation/mention delivery |

Do not add an action that reports success for a missing endpoint. A local group remark is explicitly **not** the shared group name. Local unread preference only hides the badge on this device and does not unsubscribe push notifications. Current API reports accept public posts, received DMs or visible group messages; a reply is not yet a separately supported report target.

## Proposed group rules to discuss

The standalone HTML demonstrates a proposal, not an implemented backend. Group owners can rename, maintain announcements, invite, appoint/remove admins, remove members, transfer ownership and disband. Admins may maintain name/announcement, invite and remove ordinary members; they cannot appoint admins, remove an owner/admin, transfer ownership or disband. Members can view participants and leave. These choices are reviewable product decisions, not course requirements.

Invitations require acceptance; no one gains history merely by receiving an invite. A private join record and membership revision should be checked inside every mutation and file read. Transferring ownership should require an existing joined, eligible recipient and acknowledgement; retain exactly one owner. Removing someone ends future access immediately; decide separately whether the removed user's previously received message history is retained. Avoid claiming revocation can erase a screenshot or a downloaded image.

Any future rename/admin/remove/disband mutation needs an operation reference, expected room revision, role check within the same transaction and a minimal audit event. A stale permission snapshot must return a clear conflict and reload roles, not optimistically act as owner. Pending requests and invitation outcomes belong in the same notification centre, not a second disconnected badge list.

## Proposed reply and message media flow

A reply can quote a stable reply ID, with a root ID for retrieval. Display nested ancestry compactly rather than shrinking the text into an ever-narrower column. Keep the quoted author visible. Withdrawn/moderated parents should retain a non-sensitive placeholder so descendants do not jump into an unrelated thread. A future four-image maximum is a **prototype assumption for feedback**, not a deployed limit. Do not give submitted attachments a public URL until moderation approves them.

Keep save, upload, submit, moderation and publication states separate. A completed upload is not a delivered DM or approved reply. Use stable operation references and media IDs after upload, never local file paths or expiring signed links in message bodies. Retries must preserve order and avoid duplicate sends; deleting an attachment draft must not delete an original referenced by a journal or observation. Replies with no text but images, partial upload failure and withdrawn parent targets need explicit later contract decisions.

Current forwarding uses a bounded text envelope with a whitelisted internal publication ID and title for compatibility with the existing message API. It never opens an arbitrary external URL from that envelope. Older clients will see plain envelope text. Opening always follows the normal authorization route; withdrawn/private content becomes unavailable rather than being copied into a newly public snapshot. The eventual typed card schema should keep this reference behavior.

## Storage mapping

| Content | Current location / lifetime | Future CloudBase decision |
| --- | --- | --- |
| Original observation photos and journals | Existing persistent local repository; not cleared with previews | Explicit opt-in upload, original ownership and export retained; no automatic public migration |
| Memos and unsent replies/DMs | Local revision-aware notes or account-scoped drafts | Decide sync/conflict policy before cross-device claims; separate draft storage from moderation-visible content |
| Journal previews | Existing regenerable preview cache, protected-reference cleanup | Regenerate from originals; keep renderer version in cache identity |
| Public guide photos | New anonymous-route cache: 32 files / 16 MiB; seven-day freshness, bounded 30-day offline fallback | Public derivative cache/CDN only after licence and source identity are preserved |
| Public forum/sighting thumbnails | Existing public routes, no newly persistent cache in this pass | Sized thumbnails + content revision; approved visibility first; do not precache full originals in a scrolling feed |
| Private message/group attachments | Not added | Private objects with participant/membership checks; scoped, expiring reads; revoke future reads when membership changes |
| A forwarded publication | Internal ID + bounded title, not copied image bytes | Resolve current visibility; thumbnail only if permitted, with a withdrawn-content state |

CloudBase must reuse the existing canonical account and permissions rather than creating a parallel “cloud friend” identity. Private object IDs, access scope and media ownership need to be verified by the server; do not embed provider tokens in client assets or permanent shared links. Sensitive EXIF/coordinates should be omitted from public derivatives unless explicitly selected. Cache clearing must remain limited to owned derivative directories. Preserve local notes/originals when switching transports or rolling back.

## Review and research notes

The library separates species lookup, a small image-led starting point and personal saved/recent entries; the external feed separates image browsing from a date view and labels the scope of filters. This is our layout choice, informed by the primary [eBird species exploration guide](https://support.ebird.org/en/support/solutions/articles/48001255128-find-birds-with-ebird) and [iNaturalist search guide](https://help.inaturalist.org/en/support/solutions/articles/151000169670-how-to-search-inaturalist-observations). No third-party artwork or UI code was copied. Native layout fixtures use existing original project illustrations and label invented taxonomy/sample names as test data.

Resume server work only in the separately agreed restoration pass: verify capabilities, private identity and two-account isolation before enabling new contracts. Review existing inactive [CloudBase preparation](CLOUDBASE-0.4.17.md) at that time; this candidate does not initialize it.
