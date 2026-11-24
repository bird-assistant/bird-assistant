# Bird Assistant native WeChat client — 0.4.2

2026-11-25 · Current0.4.2: [map memory, live search and forum threads](FORUM-AND-SEARCH-0.4.2.md). Client132passed; local backend469passed/51skipped,86.60%coverage. Deployment, live Qwen and native acceptance remain pending. Older records below are historical.

2026-11-24 · **0.4.1**: [map home and true photo deformation](MAP-AND-PHOTO-0.4.1.md). Synced with team d59be67; 114 client tests and 461 backend tests passed (51 skipped). Live Qwen, full Issue #23 cards and native-device acceptance remain pending. Older handoff sections below describe their historical checkpoints; this paragraph and the new release note define current status.

2026-11-24 · **0.4.0**: [手帐恢复、版式与Qwen业务接入](../JOURNAL-0.4.0.md) / [English](JOURNAL-0.4.0.md). 本轮保留c6571c2的视觉/地图/社区接入；完整Issue23观察卡、真实Qwen部署及媒体/真机验收仍待完成。

Current development version **0.3.0**: [journal layouts, preview performance and Qwen setup](JOURNAL-0.3.0.md) · [recognition delivery contract](../RECOGNITION-HANDOFF.md). Client/server adapters are implemented; real gateway/credentials and phone acceptance remain pending. The0.2.9 handoff below describes the imported baseline.

[中文](../../README.md) · [Verification](../../TESTING.md) · [Integration status](../INTEGRATION-STATUS.md)

This is a runnable source checkpoint for team review and continued integration. The five tabs, native components, packaged assets, domain helpers, configuration template, locked dependencies and automated tests are included.

**Live recognition uploads/candidate UI, authentication, cloud synchronization, real map services and public community operations are not connected.** This handoff does not complete Issue #12 or merge map PR #17.

## Run after cloning

Use Node 22.18+ or 24. This handoff was checked on Linux x86_64, Node 24.22.3 and npm 11.9.0.

1. From the team repository, enter the client project: `cd miniprogram`.
2. Install locked dependencies: `npm ci`.
3. Generate local configuration: `npm run setup`. Existing settings are preserved; first setup uses a touristappid placeholder.
4. Run `npm run verify`.
5. Import **<team-repository>/miniprogram/** into WeChat DevTools. This directory contains package.json and the generated project.config.json. The inner miniprogram directory is the upload root, not the project import directory.
6. Select the project's valid AppID supplied by its administrator and ensure you have developer membership. AppSecret belongs on a server and is not needed in client setup. Tourist/test environments do not establish phone or experience-build acceptance.

Reference DevTools version: Stable 2.02.2608040; template base library: 3.17.1. Real camera, recording, Canvas, permissions and safe-area behavior still need device acceptance.

Local project.config.json, project.private.config.json, node_modules, generated JavaScript, .test-build, environment files, gallery and keys are not committed. Setup script messages referring to the root mean this client project root, not the outer team-repository root.

## Responsibilities and boundaries

- Home: illustrative map interaction and example locations; no real map/POI/public-sighting provider.
- Identify: native capture/import, per-material review drafts, capability-driven zoom and explicit private local saving. Analyze remains disconnected; the recognition module only prepares contracts and a cancellable coordinator.
- Journal: editable document geometry, crop/rotation, undo/redo, local explicit saving and Canvas export. Session undo is not persistent history; unsaved work is not guaranteed across restart.
- Community: labeled sample feed/interactions and an explicitly saved local post draft. Publishing/replying and writing/ASR services are disconnected.
- Profile: local profile/avatar operations, history/favorites and example-excluding statistics. Choosing a WeChat avatar is not login.

App shell/components and page controllers live under the inner miniprogram directory. Shared services hold storage/media, observation context, layout/map/zoom, journal/crop/Canvas, numeric and recognition-contract logic. The services folder is a practical grouping, not a claim of strict architecture-layer enforcement.

See TESTING.md for the current 73 automated tests and native acceptance limits. Source files, tests, dependency locks and runtime version are preserved from checkpoint 031cf420cfb20b99b9e016d7b0d7b3958340a584; the handoff adds documentation, CI and local ignore rules. The private repository's history, personal development log and screenshots are excluded.

## Integration and continuation

Follow the team task-branch/PR workflow. Map PR #17 has a different app layout and package configuration; choose one app root and migrate the required map modules deliberately rather than stacking two app entries. Align gateway identity, original-media persistence, unknown/manual observations and public-map queries with the existing backend first. Private observation CRUD alone does not implement the map draft's public/nearby contract.
