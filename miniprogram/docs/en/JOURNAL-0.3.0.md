# 0.3.0 journals, paced previews and Qwen boundary

20 November2026. [中文](../JOURNAL-0.3.0.md) · [Recognition handoff](../RECOGNITION-HANDOFF.md)

Single-photo pages now offer a hero, portrait and wide-note composition; paired photos offer a diptych, stacked narrative or staggered conversation, using asymmetric columns on short/wide pages. Ratio changes reveal the whole page; composition, content and crop changes remain undoable. Three/four-photo group pages remain secondary. Source-generated SVG previews use example illustrations and are not phone screenshots.

Slider/crop/drag previews use a40ms latest-value queue with partial element patches instead of sending the complete document, all labels and layout on every event. Final release commits one exact undo step; cancellation/document switches clear pending previews. Burst tests establish bridge-load behavior, not phoneFPS or actual latency.

Qwen's server-configurable default is`qwen3-vl-plus`, non-thinking JSONObject output. It suggests copy and a whitelisted style/composition; the local renderer preserves editable documents and original photos. Users preview and explicitly apply copy or copy+design. Cancellation, changed inputs and stale documents cannot overwrite text. No real provider call or spending occurred; speech transcription remains disconnected.

Client ports in`journal-ai.ts` and`journal-gateway.ts` require explicit installation. Selected pictures are redrawn into metadata-free, boundedJPEG copies (up to4,1024px longest edge,1MB each); original local paths do not enter the wire payload. The request uses the team's HTTPS gateway and a short-lived user session, never a provider key.

`server/journal-qwen.mjs` is a Node provider using nativefetch, restricted Beijing Aliyun endpoints, validated inline media,20s timeout,64KB response bound, JSON/schema validation and safe errors. It requires injected authentication and per-user quota functions. It is neither a deployed CloudBase function nor a Python FastAPI module. Wrap it in an appropriate Node host, or implement the same contract in the existing Python gateway; do not duplicate identity/storage systems merely to import this module. The host must bound incoming bodies before JSON parsing, authenticate sessions and enforce quota/rate/concurrency limits.

Server settings are`DASHSCOPE_API_KEY`, account-specific Beijing`DASHSCOPE_BASE_URL` ending`/compatible-mode/v1`, and optional`JOURNAL_QWEN_MODEL`. Keep them in server secrets. The proposed team route is`POST /api/v1/journal/suggestions`:v1 requestId/prompt/purpose/maxChars/images(id,label,dataUrl), responsev1 same requestId/title/body/design(style,variant). Body limits are20–600characters; no generated URLs/code/coordinates are applied. Install the client transport through the gateway bootstrap with a per-page prepare function and remove that binding when the page unloads. No live endpoint is installed in this revision.

Automated checks cover geometry/ratios, crop/source preservation, bursts/undo/cancel, AI preview/apply/stale results, recognition-provider composition and Qwen responses through a fake upstream. Native-phone responsiveness, actual file/Canvas/share behavior and real multimodal quality still require acceptance. Follow the Chinese checklist and record device/WeChat/base-library/commit and evidence. Format-valid JSON is not factual verification.

Official sources: [vision](https://help.aliyun.com/zh/model-studio/vision) and [structured output](https://help.aliyun.com/zh/model-studio/qwen-structured-output). This uses a Qwen service and editable local templates; no Canva API or automatic external publication is implemented.
