# 0.4.7 candidate and acceptance boundary

[Development continuation:229 client passes and501 local backend passes](SPRINT-2026-11-26.md). Installed0.4.6 remains unchanged. Counts195/184 below describe earlier stages, not the current candidate total.

26 November 2026, Beijing time. [中文](../ACCEPTANCE-0.4.7.md) · [Full backlog](BACKLOG.md)

The user's current native acceptance baseline remains0.4.6. Candidate code is prepared on `fix/recognition-acceptance-0.4.7` for review. No current pull/recompile, team merge or backend deployment is requested.

The candidate shares visual/audio explanation padding and rejects stale measurements; makes import controls compact; accommodates complete media cards; reveals the photo fallback only after picker failure; uses natural-ratio transparent review photos with separate video layout; and improves review spacing. Normal simulator and phone connections use public HTTPS. Local SSH is an explicit simulator-only setting. Empty502/504 errors preserve materials, while domain rejection and local/public network errors remain distinguishable. The helper reports success only after a live SSH process and model readiness, and cleans up on failure.

`npm run verify` passes184 checks with no failures, cancellations or skips. Eight new regressions cover connection selection, empty502 preservation, picker fallback/cancellation and stale callbacks/measurements. Four mocked Python launcher checks pass. The optional helper tests add no application dependency. Source structure was reviewed; attempted print projections distorted the layout and were excluded from acceptance evidence and publication.

Native equal-height explanations, unclipped cards, scrolling, picker compatibility, photo/video sizing and detection overlay alignment still require acceptance. Public vision returned Caddy502 at00:26–00:29 Beijing on26 November. These client changes do not repair that upstream outage or prove real inference, phone GPS, audio/video recognition or Qwen quality.

Continue testing unpublished forum drafts/previews, species navigation and local profile edits on the existing0.4.6 build. The infrastructure maintainer must inspect the active Caddy route, GPU readiness and tunnel before identification acceptance can resume.

The expanded candidate now passes195 client checks, retaining the original184 and adding eleven post-media/draft regressions. [Post media details](POST-MEDIA.md) cover the square deck,9/3 visuals/journals, recovery and companion backend/moderation changes. Deployment and native acceptance remain pending.
