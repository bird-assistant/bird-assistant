# Bird Assistant native WeChat mini-program · 0.4.15 candidate

R64: repaired the identify zoom binding that broke Compile; mandatory strict WXML validation and bundled WeChat WCC/WCSC now compile20 WXML/22 WXSS. The earlier360-test green result missed this defect. Run npm ci before verify; still complete full DevTools Compile.

[Interaction/profile changes and native acceptance](INTERACTION-0.4.15.md) · [Canonical English next steps](https://github.com/NoctisBaguette/bird-assistant-miniprogram/blob/main/docs/NEXT-STEPS.md) · [中文](../../README.md)

Built on the latest team main a6a3f88, retaining merged PR27 and the teammate's polls/adoption, bird selector, photo review gateway, Dongniao fallback, frame recovery and tab motion. Adds a same-card one-second hold, damped share/delete, three-card deck and custom sharing sheet; fixes map/button/discovery layout; develops grouped My entries, real saved places, protected preview cleanup and hosted writing checks; improves existing social screens and late message acknowledgments.

Run npm ci, npm run setup and npm run verify in the outer client project, then full Compile in the existing DevTools project. Setup preserves the local AppID; a new clone needs the project's valid identity/developer permissions. Keep all local journals/history/drafts/originals and the existing Windows writing-helper terminal. Phones use hosted HTTPS.

**368 tests pass**, zero failures/skips.66 source-layout cases fit at compact/phone/tablet sizes. Browser projections and storage/bridge proxies are not native compilation or FPS evidence. Native Compile and two-phone acceptance remain required; no deployment, team merge or experience upload was performed by the assistant. Latest read-only service health: vision200 ready and current place sorting; journal writing404/404 and audio404. Phone Qwen still needs the active service/proxy deployment. R34 native auth/null failures remain unresolved.

Runtime is under the inner miniprogram/, review tools under tests/ and scripts/. See ../INTERACTION-0.4.15.evidence.json. All original48 backlog IDs and R01–R56 remain, extended by R57–R64. Team/public handoffs use Chinese; private working plans use English. Backend and all other repository root entries are unchanged in this revision.
