# CloudBase preparation and deployment — 0.4.17

28 November 2026. Prepared source only. The current mini-program still uses its existing HTTPS business transport. `app.ts` does not initialize CloudBase and no environment ID, deployed function or new cloud identity was created here. The existing community service remains the source of truth for accounts, permissions, polls, friendships and messages.

## Architecture and exact prepared surface

`cloudfunctions/birdGateway/index.js` loads pinned `wx-server-sdk@4.0.2`, calls `getWXContext()` inside every invocation and delegates to `handler.cjs`. The handler requires a real SDK WeChat OPENID and an APPID matching the server-configured `BIRD_GATEWAY_APP_ID`. Event-supplied OPENID/APPID are never accepted as identity. An ordinary existing business bearer is still required: the gateway does not mint a business user from CloudBase identity or trust a client-supplied owner ID.

| Gateway action | Fixed business path | Status |
| --- | --- | --- |
| writingCapabilities | GET /api/v1/journal/capabilities | Prepared read transport; host currently404 |
| writingSuggestions | POST /api/v1/journal/suggestions | Prepared, disabled unless server flag is true |
| socialInbox | GET /api/v1/community/inbox | Prepared read transport |
| socialFriends | GET /api/v1/community/friends | Prepared read transport |
| socialGroups | GET /api/v1/community/groups | Prepared read transport |

Only these five own properties are accepted, including rejection of `__proto__`/`constructor`. The origin is fixed to the existing business HTTPS service. No arbitrary URL, redirect, DB proxy, arbitrary method, provider key or social write endpoint is exposed. Existing business auth, visibility checks, moderation, rate limits and quotas still execute. Do not create parallel CloudBase collections mirroring business accounts/messages.

POST input and parsed response are limited to2MiB; timeout12s for reads and60s for writing, no automatic retry. Network/config/HTTP errors are returned with sanitized codes. Tokens, content and user context are not retained across invocations or written to logs by this source. The response size is checked after body read; deployment ingress/egress memory limits and upstream bounds still apply. A gateway404 remains404, not a fake successful fallback.

## Staging deployment procedure for the maintainer

1. Select the team's existing staging CloudBase environment tied to the real mini-program AppID. Inspect its current functions/rules before changing anything. Add `cloudfunctionRoot: "cloudfunctions/"` to the local outer project config only if the existing project uses that same root. Preserve AppID and private configuration; no universal environment ID is committed.
2. Choose an available **Node.js22 or24** regular-function runtime with global `fetch`, AbortController and Buffer support; do not use Node16. The package declares >=18 as a compatibility floor. The CloudBase runtime support page is authoritative for the exact version exposed in that environment.
3. From `cloudfunctions/birdGateway`, run `npm ci --ignore-scripts` (its own lock, separate from the client lock). Use DevTools' cloud-function upload/deploy with dependency installation or the team's managed pipeline. Handler is `index.main`; function name `birdGateway`. Set memory256MiB initially and timeout≥65s if enabling writing; measure actual memory/cold start in staging. Leave concurrency/cost policies with the environment owner.
4. Set server environment `BIRD_GATEWAY_APP_ID` to the actual AppID. Leave `BIRD_GATEWAY_ENABLE_WRITING` absent/false. Existing business/provider secrets stay in their existing server secret configuration; this function needs no new provider key.
5. Expose this function **only through the WeChat mini-program SDK**. Do not attach HTTP access, scheduled/database triggers or admin event execution to this identity handler. Current CloudBase instance-reuse guidance documents stale `getWXContext` risk when SDK and non-SDK invocation types mix. Any future HTTP entry needs a separately verified identity design and handler.
6. Merge the `birdGateway` rule from `security-rules.example.json` into the environment's actual function policy and test it. The file demonstrates a deny default for a new isolated environment; do not overwrite the rules for unrelated existing functions. The nonanonymous rule is an extra layer; handler APPID/OPENID and business-token checks remain mandatory. If the chosen mini-program SDK does not expose the proposed auth rule context, stop and adapt the environment-specific rule in staging instead of opening anonymous invocation.
7. Validate SDK invocation from the actual signed-in staging mini-program with writing disabled. A DevTools cloud console event cannot fabricate a trusted WeChat SDK context. Confirm missing/wrong AppID, absent OPENID, expired business session and unlisted action all fail; two users in warm/cold invocations must remain isolated.
8. Only after the host capabilities route exists and the team approves generation smoke testing, enable writing in staging. Use an explicit user action and existing payload/idempotency contract; check timeout/failure preservation before enabling in a release. This preparation did not call a model.

## Future client switch (deliberately not activated)

Initialize `wx.cloud` with the selected environment only after staging acceptance, then route a narrowly selected operation through `wx.cloud.callFunction({name:'birdGateway',data:{action,token,payload}})`. Reuse the current business session service, never hardcode a bearer, and ignore late results on account/view revision changes. Keep exactly one selected transport per request; do not silently try direct HTTPS after a timed-out generation, which could duplicate cost. Keep original text/photos until a verified result is explicitly applied. No speculative CloudBase initialization occurs at app startup in0.4.17.

## Acceptance and rollback

Pure handler tests cover invalid identity/config/action, disabled writing, size limit, fixed origin/bearer,404 preservation and two-user isolation. They do not test live SDK authorization, cloud egress, deployment IAM, runtime memory or billing. Required staging checks: SDK identity, real JWT rejection/permissions, unreachable business host, timeout, oversized response, cold/warm two-user sequence, disabled writing and an explicit successful read. Do not test by altering a real user's vote, friendships or production content.

Rollback leaves client on existing HTTPS transport, disables the server writing flag and disables invocation for this function/version. Keep the previous function version/rules snapshot. No data migration exists, so rollback requires no collection deletion. Gateway deployment will not repair missing business writing/withdraw routes; deploy those through the existing course deployment workflow.

## Related design and authoritative references

[Social design](SOCIAL-0.4.17.md), [revision acceptance](INTERACTION-0.4.17.md), existing `backend/deploy/course/JOURNAL-WRITING.md` and source business routes.

Primary documentation checked28 November2026: [runtime support](https://docs.cloudbase.net/en/cloud-function/runtime-support), [function access control](https://docs.cloudbase.net/cloud-function/security-rules), [instance reuse](https://docs.cloudbase.net/cloud-function/instance), [mini-program function recipe](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram). SDK version was verified with the npm registry and pinned in the function lockfile. Runtime availability and SDK policy behavior still need environment-specific staging checks.
