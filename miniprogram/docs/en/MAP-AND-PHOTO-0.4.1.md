# Map home and true photo deformation · 0.4.1

2026-11-24 · [中文](../MAP-AND-PHOTO-0.4.1.md)

Merged team main `d59be67a73e0f77fb779635a9b27b15f69f32231` using real two-parent Git ancestry. The merge retains viewport clustering, cursor pagination, the bird catalogue, guide/comparison screens and trip adviser, together with PR #24’s durable journal and shared Python Qwen writing adapter.

The home map now fills the space between the shared header and tab bar. Search and equal-width filters form a compact toolbar. Numeric clusters replace persistent species callouts. Location/refresh controls and a regional summary stay within the map; records scroll and page inside a bounded panel. A shared-location panel uses its own count. Search dismissal/edit/hide and list closure invalidate late responses. Wide windows limit panel width; short windows use a single action row. A 36px bottom strip leaves native map attribution visible. Failed observation photos collapse their media box and can retry on refresh.

[Source-driven layout projection](../design/map-home-0.4.1.png). Its background is explicitly a packaged placeholder, not a native WeChat screenshot. Runtime still uses Tencent’s native map.

| Photo choice | Result |
| --- | --- |
| Crop to fill / 裁剪填充 | Retains the bird’s proportions; changes the visible source area |
| Free deformation / 自由变形 / 拉伸画面 | Scales the two axes independently, making the bird flatter, wider or thinner |
| Original ratio lock | Restores the source aspect ratio and crop-to-fill behavior |
| Current ratio lock | Captures the current shape for proportional resizing |

The optional `photoFit` value is persisted separately from the frame lock. Legacy documents default to cover, including old free frames, so saved work is not silently distorted. Stretch keeps original file references/dimensions and existing crop parameters. Opening crop temporarily previews cover; cancel restores the previous deformation, apply selects cover and supports undo. Editor, template thumbnails and Canvas export share the same source rectangle and destination geometry. [Crop/stretch comparison](../design/photo-fit-0.4.1.png) is generated from that actual helper.

Validation: client source/assets, TypeScript and **114 tests passed**. Merged Python backend: **461 passed, 51 skipped, 86.46% coverage**; Ruff passed. Optional audio/GPU/external-model skips are not live inference or Qwen acceptance. Test dependencies emit two deprecation warnings. Dependency pins remain typings 5.2.3 / TypeScript 6.0.3.

The field-map component now uses supported class selectors. The supplied DevTools output (Stable 2.02.2609250 / base library 3.17.1) also shows a map SDK authentication/network failure; CSS changes do not establish that this failure is fixed. No native DevTools/phone run was performed here. Map overlay order, marker labels, gestures and image exports still need device validation. Future adaptation includes iPhone, Huawei/other Android phones, iPad/tablets, Windows WeChat, foldable/dual screens, split windows and multiple displays/DPI; window-geometry tests do not establish acceptance on those devices.

Qwen remains our responsibility. The user is starting from zero and has not checked the module yet. No account/key creation, deployment, paid request or real Qwen call is part of this patch. Later setup proceeds through account, region/model, server environment, one request and client integration. Full observation cards in Issue #23 remain pending.
