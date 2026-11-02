# 视觉识别 API v1

## 1. 基本约定

开发地址示例：

```text
http://127.0.0.1:8000
```

正式环境必须使用 HTTPS/WSS。OpenAPI 地址：

```text
GET /openapi.json
GET /docs
GET /redoc
```

除 `/healthz`、`/readyz` 和 API 文档外，接口需要服务端凭证：

```http
Authorization: Bearer <server-api-key>
```

兼容请求头：

```http
X-API-Key: <server-api-key>
```

长期密钥只放在公网业务网关，不放在微信小程序。不同密钥创建的会话彼此不可见；访问别人的会话统一返回 `404`，避免泄露会话是否存在。

每个 HTTP 响应包含：

```http
X-Request-ID: req_...
```

调用方可以主动提供 `X-Request-ID` 以关联网关和 GPU 日志；取值须为 1～128 位字母、数字、`.`、`_`、`:` 或 `-`，不合规时服务端会重新生成。

## 2. 健康与模型

### `GET /healthz`

只证明进程存活，不证明模型已经加载。

```json
{
  "status": "ok",
  "service": "bird-vision-service",
  "version": "0.3.0",
  "timestamp": "2026-10-23T08:00:00Z"
}
```

### `GET /readyz`

检测器、物种 Provider 和推理运行时都准备好时返回 `200`，否则返回 `503`。开发环境中 `disabled` Provider 可用于接口联调；生产配置强制使用 YOLO、BioCLIP 和 CUDA，Mock/Disabled/CPU 无法启动，也不会被探针误判为生产就绪。

### `GET /api/v1/models`

返回当前检测器、物种 Provider、设备、拒识阈值、目录版本/数量/哈希和分数语义。该接口需要鉴权。

### `GET /api/v1/species/catalog/info`

返回当前进程实际加载的名录，而不是只返回配置文件名：

```json
{
  "available": true,
  "path": "/app/config/catalog/avilist_v2026_global.csv",
  "source": "AviList",
  "version": "v2026",
  "license": "CC BY 4.0 (AviList taxonomy)",
  "checksum_sha256": "40152332...",
  "total_species": 11172,
  "enabled_species": 10970,
  "region_counts": {"CN": 1420}
}
```

### `GET /api/v1/species/catalog`

分页查询名录。查询参数：

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `q` | 空 | 匹配稳定 ID、学名、中文名、英文名或 eBird code，不区分英文大小写 |
| `region_code` | 空 | 两位国家代码；提供时只查询带该区域标记的条目 |
| `enabled_only` | `true` | 是否隐藏已灭绝/停用条目 |
| `offset` | `0` | 非负偏移 |
| `limit` | `50` | 1～200 |

示例：

```http
GET /api/v1/species/catalog?q=avibase-F2858F9F&region_code=CN&limit=20
```

```json
{
  "total": 1,
  "offset": 0,
  "limit": 20,
  "items": [
    {
      "species_id": "avibase-F2858F9F",
      "scientific_name": "Egretta garzetta",
      "common_name_zh": "白鹭",
      "common_name_en": "Little Egret",
      "order": "Pelecaniformes",
      "family": "Ardeidae",
      "ebird_code": "litegr",
      "avibase_id": "avibase-F2858F9F",
      "region_codes": ["CN"],
      "extinction_status": null,
      "iucn_status": null,
      "enabled": true
    }
  ]
}
```

### `GET /metrics`

Prometheus 文本格式，包含 HTTP 延迟、帧处理结果、推理延迟与活动会话数。该接口需要鉴权。

## 2.1 单张照片一次性识别

小程序拍照页只需要一次识别，不需要会话、跟踪与 WebSocket。该端点复用同一个检测器与物种
Provider，只对单张图做一次“检测 → 裁剪 → 分类”，响应风格与音频服务一致，方便前端共用一套
候选渲染与错误处理。

```http
POST /api/v1/vision/analyses
Content-Type: multipart/form-data
Authorization: ******

image=<JPEG/PNG/WebP 文件>
```

| 限制 | 默认值 | 配置 |
|---|---:|---|
| 最大字节 | 6 MB | `BIRD_VISION_MAX_IMAGE_BYTES` |
| 最大像素 | 3840×2160 | `BIRD_VISION_MAX_IMAGE_PIXELS` |
| 单次参与分类的目标数 | 3 | `BIRD_VISION_PHOTO_MAX_SUBJECTS` |
| 目标最小短边 | 64 px | `BIRD_VISION_MIN_RECOGNIZABLE_SIDE_PX` |

成功返回 `200`：

```json
{
  "analysis_id": "pho_3f7a...",
  "state": "candidate",
  "candidates": [
    {
      "rank": 1,
      "species_id": "avibase-F2858F9F",
      "scientific_name": "Egretta garzetta",
      "common_name_zh": "白鹭",
      "common_name_en": "Little Egret",
      "score": 0.93,
      "score_type": "relative_similarity",
      "similarity": 0.412,
      "region_match": true,
      "local_occurrence_count": 120
    }
  ],
  "subjects": [
    {
      "rank": 1,
      "bbox": {"x1": 0.24, "y1": 0.18, "x2": 0.76, "y2": 0.82},
      "detection_score": 0.91,
      "short_side_px": 288.0,
      "state": "candidate",
      "reason": "candidate_above_similarity",
      "candidates": ["…同上结构…"]
    }
  ],
  "model": {"name": "bioclip-2-zero-shot", "backend": "open-clip", "device": "cuda:0", "ready": true},
  "image": {"filename": "bird.jpg", "content_type": "image/jpeg", "width": 1280, "height": 960, "size_bytes": 231231},
  "policy": {
    "max_subjects": 3,
    "min_short_side_px": 64,
    "detection_confidence": 0.25,
    "candidate_count": 5,
    "decision": "candidate",
    "reason": "candidate_above_similarity",
    "score_type": "relative_similarity"
  },
  "timing": {"decode_ms": 8.1, "detection_ms": 45.2, "species_ms": 120.4, "total_ms": 173.7},
  "notes": [],
  "created_at": "2026-10-27T12:00:00Z"
}
```

状态与拒绝原因：

| `state` / `reason` | 含义 |
|---|---|
| `candidate` / `candidate_above_similarity` | 至少一个目标通过相似度与间隔检查 |
| `unknown` / `no_bird_detected` | 检测不到目标 |
| `unknown` / `subject_below_minimum_size` | 有目标但短边小于下限，未送分类 |
| `unknown` / `species_backend_disabled` | 服务未启用物种分类（联调配置） |
| `unknown` / 其它 | 分类器自身的拒识原因（如 `below_min_similarity`） |

错误：`EMPTY_IMAGE`(422)、`IMAGE_TOO_LARGE`(413)、`UNSUPPORTED_IMAGE_TYPE`(415)、
`IMAGE_DIMENSIONS_INVALID`(413)、`IMAGE_DECODE_FAILED`(422)、`INVALID_MULTIPART`(422)、
`UPLOAD_TIMEOUT`(408)、`AUTH_*`(401)，与帧上传一致。

样例：[`mock/photo-analysis-candidate.json`](mock/photo-analysis-candidate.json)（`species_backend=mock`
的形状示例，真实部署会返回 BioCLIP 候选）。

注意：`score_type=relative_similarity` 是候选集合内的相对排序分数，不是概率；
该端点只做一次性推理，不产生会话、不进入跟踪、不写观察记录。

## 3. 创建实时会话

```http
POST /api/v1/vision/sessions
Content-Type: application/json
Authorization: Bearer ...
```

请求：

```json
{
  "client_session_id": "wx-activity-20261023-001",
  "observation_mode": "live",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "region_code": "CN"
}
```

`observation_mode` 默认是 `live`；实时会话提供坐标后会立即预取当前月份窗口。历史图片批量测试使用 `historical`，并应先调用 occurrence 缓存准备接口。GBIF 当地列表拥有严格优先级：当地 Top-1 达到最低相似度即保留当地排名；只有当地 Top-1 低于最低相似度才采用全球模型。

会话响应中的 `coordinates_used_for_inference` 在创建时计算，只表示会话坐标受当前已启用的离线或实时解析器支持，不证明某次分类实际使用了坐标候选。应以每个物种结果的 `species.decision.coordinates_used` 判断该结果是否实际采用当地候选集合，并结合 `fallback_reason` 查看回退原因。帧上传的坐标独立覆盖该帧的会话坐标，不会改写这个会话级标志。

成功返回 `201`：

```json
{
  "session_id": "vs_553d1f...",
  "created_at": "2026-10-23T08:00:00Z",
  "expires_after_idle_seconds": 300,
  "recommended_frame_interval_ms": 200,
  "websocket_path": "/api/v1/vision/sessions/vs_553d1f.../events",
  "observation_mode": "live",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "region_code": "CN",
  "catalog_version": "v2026",
  "coordinates_used_for_inference": true
}
```

客户端先建立 WebSocket，再开始上传帧，避免错过第一条结果。

## 4. WebSocket 事件

```text
GET wss://api.example.com/api/v1/vision/sessions/{session_id}/events
```

首选使用 `Authorization` 请求头。兼容无法设置请求头的客户端：

```text
...?access_token=<key>
```

查询参数可能进入代理访问日志，只应作为开发兼容方案。

鉴权失败关闭码为 `4401`；会话不存在或不属于当前凭证时为 `4404`。客户端断线后可以使用同一会话 ID 重连，但断线期间订阅队列中的事件不保证补发，因此画面始终以最新结果为准。

连接成功后首先收到：

```json
{
  "type": "vision.session.started",
  "event_id": "evt_...",
  "occurred_at": "2026-10-23T08:00:01Z",
  "session_id": "vs_...",
  "details": {
    "recommended_frame_interval_ms": 200,
    "observation_mode": "live",
    "latitude": 31.8206,
    "longitude": 117.2272,
    "region_code": "CN",
    "coordinates_used_for_inference": true,
    "catalog_version": "v2026"
  }
}
```

没有事件时，每 15 秒发送 `vision.heartbeat`。

## 5. 上传帧

```http
POST /api/v1/vision/sessions/{session_id}/frames
Content-Type: multipart/form-data
Authorization: Bearer ...
```

字段：

| 字段 | 必填 | 类型 | 说明 |
|---|---:|---|---|
| `frame` | 是 | JPEG/PNG/WebP | 默认最多 6 MiB、解码后最多 8294400 像素（4K） |
| `frame_id` | 是 | string | 会话生命周期内唯一，1～128 字符，仅字母、数字、`.`、`_`、`:`、`-` |
| `captured_at` | 否 | RFC 3339 | 必须带时区，例如 `2026-10-23T16:00:01.325+08:00` |
| `capture_time_precision` | 否 | enum | `exact`（默认）、`date`、`month`、`unknown`；`unknown` 使用地点全年候选 |
| `latitude` | 否 | number | `[-90, 90]`；必须与经度一起传，覆盖会话坐标 |
| `longitude` | 否 | number | `[-180, 180]`；必须与纬度一起传 |

`live` 会话中的 `captured_at` 必须接近服务器时间，以防旧帧污染实时轨迹；`historical` 会话必须提供 `captured_at`，允许过去时间但不允许明显的未来时间。调用方不知道真实拍摄月份时，不得把文件下载/修改时间伪装为精确拍摄时间，应传 `capture_time_precision=unknown`。

启用实时 GBIF 时，后台查询不占用 GPU 推理槽，也不计入推理时限；GBIF 请求超时作用于每次 HTTP 尝试，不是整个后台查询。首次区域缓存未命中时，坐标会编码在按配置半径生成的查询多边形中，月份作为查询条件发送到 `api.gbif.org`。完成和明确空结果写入有 TTL 和容量上限的云端 SQLite，跨会话及服务重启复用；其中保存哈希区域键和聚合物种计数，不保存原始经纬度。部署可关闭实时查询以停止该外部传输。

批量历史任务在上传图片前调用：

```http
POST /api/v1/species/occurrence/cache/prepare
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "latitude": 31.8206,
  "longitude": 117.2272,
  "observed_at": "2026-05-28T19:06:51+08:00",
  "time_precision": "exact"
}
```

响应 `status=pending` 时按短间隔轮询同一请求，`status=ready` 后再上传该月份图片。`time_precision=unknown` 准备全年键。测试脚本会先按图片涉及月份去重预取，最多并发两个键，不再让某一张图片承担首次 GBIF 初始化。

示例：

```bash
curl -X POST \
  -H 'Authorization: Bearer change-me' \
  -F 'frame_id=frame-000001' \
  -F 'captured_at=2026-10-23T16:00:01.325+08:00' \
  -F 'capture_time_precision=exact' \
  -F 'frame=@frame.jpg;type=image/jpeg' \
  http://127.0.0.1:8000/api/v1/vision/sessions/vs_xxx/frames
```

服务完成图片安全解码并进入队列后立即返回 `202`：

```json
{
  "accepted": true,
  "session_id": "vs_xxx",
  "frame_id": "frame-000001",
  "replaced_frame_id": null
}
```

如果队列中旧帧被替换，`replaced_frame_id` 返回旧帧编号，同时 WebSocket 发送 `vision.frame.dropped`。

重复 `frame_id` 返回 `409 FRAME_ID_DUPLICATE`，不会解码或重复推理。帧率、同时上传数和全局图片内存预算在图片解码前检查；超过限制时客户端应遵循 `Retry-After` 降低发送速率。

## 6. 推理结果事件

```json
{
  "type": "vision.frame.result",
  "event_id": "evt_...",
  "occurred_at": "2026-10-23T08:00:01.482Z",
  "session_id": "vs_xxx",
  "frame_id": "frame-000001",
  "captured_at": "2026-10-23T16:00:01.325+08:00",
  "observation_context": {
    "observed_at": "2026-10-23T16:00:01.325+08:00",
    "time_source": "captured_at",
    "time_precision": "exact",
    "latitude": 31.8206,
    "longitude": 117.2272,
    "coordinate_source": "session",
    "region_code": "CN"
  },
  "image_width": 1280,
  "image_height": 720,
  "tracks": [
    {
      "track_id": 7,
      "state": "confirmed",
      "visibility": "detected",
      "bbox": {
        "x1": 0.3125,
        "y1": 0.1806,
        "x2": 0.5266,
        "y2": 0.6042
      },
      "detection_score": 0.9123,
      "short_side_px": 274.0,
      "recognizable": true,
      "hits": 5,
      "species": {
        "state": "candidate",
        "stability": "stable",
        "model": "bioclip-2-zero-shot",
        "candidates": [
          {
            "species_id": "avibase-F2858F9F",
            "scientific_name": "Egretta garzetta",
            "common_name_zh": "白鹭",
            "common_name_en": "Little Egret",
            "score": 0.71,
            "score_type": "relative_similarity",
            "similarity": 0.287531,
            "region_match": true,
            "local_occurrence_count": 18
          }
        ],
        "decision": {
          "accepted": true,
          "reason": "accepted",
          "top_similarity": 0.287531,
          "margin": 0.018422,
          "min_similarity": 0.2,
          "min_margin": 0.01,
          "candidate_count": 243,
          "region_code": "CN",
          "catalog_version": "v2026",
          "candidate_scope": "local_seasonal",
          "location_profile_id": "hefei-cn-100km",
          "location_profile_name": "合肥及周边 100 km",
          "location_distance_km": 0.0,
          "observation_month": 10,
          "temporal_window_months": 1,
          "occurrence_dataset_version": "2026-10-24",
          "coordinates_used": true,
          "fallback_reason": null
        },
        "note": "candidate passed configured open-set gates; user confirmation is still required"
      }
    }
  ],
  "timing": {
    "queue_ms": 3.1,
    "decode_ms": 4.5,
    "preprocess_ms": 1.2,
    "detection_ms": 10.8,
    "postprocess_ms": 0.9,
    "species_ms": 18.4,
    "total_ms": 38.9
  }
}
```

`bbox` 是相对于原始上传图片的 `[0, 1]` 坐标。前端绘制时乘以实际视频显示区域，并处理 `object-fit` 产生的偏移，不能直接乘整个屏幕宽高。

轨迹显示状态：`visibility=detected` 表示本帧有检测框，`temporarily_lost` 表示检测短暂漏失、`bbox` 是按最近运动速度外推的预测框。预测轨迹不会触发物种分类；超过 `BIRD_VISION_TRACK_MAX_MISSED_FRAMES` 后轨迹从事件中移除，前端应清除对应画框。

`tentative` 轨迹是尚未连续确认的检测假设，可能来自局部重复框或短暂误检，不能计为一只鸟。只有 `state=confirmed` 才能进入物种分类和确认鸟体统计。后端保留 tentative 框供实时反馈和诊断，不会仅因嵌套几何关系删除它，因为真实的小鸟或遮挡鸟也可能位于另一个检测框内。

当某条轨迹已经有通过门控的名称时，单次 `unknown` 会保留当前候选并返回 `species.stability=held`；疑似切换到另一物种时，在累计 `BIRD_VISION_SPECIES_SWITCH_CONFIRMATIONS` 次通过门控的分类证据前继续返回旧名称，并标记 `switch_pending`。名称稳定时为 `stable`。这些状态只用于显示稳定性，`candidate` 仍然不是用户确认的观测记录。

物种相关字段：

- `score`：本次候选空间内 softmax 相对排序分数，地点、月份或目录变化时会变化；
- `similarity`：图像与该物种文本提示的原始余弦相似度；
- `region_match`：物种是否带当前会话国家标记，仅是审计信息，不参与打分；
- `local_occurrence_count`：地点/月度索引中的聚合记录数，仅是审计信息，不参与打分；
- `candidate_count`：本次实际参与排名的物种数；
- `candidate_scope`：`local_seasonal`、`country` 或 `global`；
- `coordinates_used`：`true` 表示该结果实际使用了满足最小目录匹配数的离线或实时当地候选集合；
- `fallback_reason=local_candidates_not_visually_supported`：当地集合没有通过视觉拒识门槛，因此采用全球模型结果；
- `fallback_reason`：没有使用更精细范围的原因；实时查询相关值包括 `live_occurrence_lookup_pending`（后台准备中）、`live_occurrence_no_candidates`（查询无候选）和 `live_occurrence_lookup_failed`（查询失败），`null` 表示无需回退；
- `margin`：实际候选空间中 Top-1 与 Top-2 原始相似度之差；
- `candidate` 只代表通过当前工程阈值，仍需用户确认。

低相似度或候选过于接近时返回：

```json
{
  "state": "unknown",
  "model": "bioclip-2-zero-shot",
  "candidates": [],
  "decision": {
    "accepted": false,
    "reason": "below_similarity_threshold",
    "top_similarity": 0.16,
    "margin": 0.004,
    "min_similarity": 0.2,
    "min_margin": 0.01,
    "candidate_count": 1420,
    "region_code": "CN",
    "catalog_version": "v2026",
    "candidate_scope": "country",
    "coordinates_used": false,
    "fallback_reason": "coordinates_missing"
  },
  "note": "no species passed the open-set gates; alternatives are provided for review only"
}
```

实际 `unknown` 结果仍可能附带 Top-K 备选，前端只能把它们放在“可能是”或人工复核区域，不能把第一项作为识别结果写入观测记录。

## 7. 丢帧与错误事件

旧帧被替换：

```json
{
  "type": "vision.frame.dropped",
  "event_id": "evt_...",
  "occurred_at": "2026-10-23T08:00:02Z",
  "session_id": "vs_xxx",
  "frame_id": "frame-000002",
  "reason": "replaced_by_newer_frame",
  "details": {}
}
```

队列中等待过久：`reason=stale_in_queue`。

某一帧推理失败时发送 `vision.frame.error`，会话不会因此关闭。事件只返回异常类型，不向客户端泄露服务器堆栈。

## 8. 查询和关闭会话

```http
GET /api/v1/vision/sessions/{session_id}
DELETE /api/v1/vision/sessions/{session_id}
```

`GET` 返回接收、处理、替换、过期和失败帧数量。`DELETE` 成功返回 `204`，并清理跟踪状态。长时间无活动的会话由服务器自动关闭。

`GET` 示例：

```json
{
  "session_id": "vs_xxx",
  "client_session_id": "wx-activity-20261023-001",
  "state": "active",
  "created_at": "2026-10-23T08:00:00Z",
  "last_activity_at": "2026-10-23T08:00:05Z",
  "observation_mode": "live",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "region_code": "CN",
  "coordinates_used_for_inference": true,
  "stats": {
    "accepted_frames": 12,
    "processed_frames": 10,
    "replaced_frames": 2,
    "stale_frames": 0,
    "failed_frames": 0
  }
}
```

## 9. HTTP 错误格式

```json
{
  "error": {
    "code": "FRAME_RATE_EXCEEDED",
    "message": "frames are arriving faster than the session limit",
    "request_id": "req_...",
    "details": {
      "max_frame_rate": 5.0
    }
  }
}
```

主要错误：

| HTTP | `code` | 说明 |
|---:|---|---|
| 401 | `AUTH_REQUIRED` / `AUTH_INVALID` | 缺少或无效凭证 |
| 404 | `SESSION_NOT_FOUND` | 会话不存在或不属于当前调用方 |
| 409 | `FRAME_ID_DUPLICATE` | 会话内帧 ID 重复 |
| 409 | `SESSION_FRAME_CAPACITY_EXCEEDED` | 会话达到生命周期帧数上限，应创建新会话 |
| 408 | `UPLOAD_TIMEOUT` | multipart 上传超过时限 |
| 413 | `IMAGE_TOO_LARGE` | 文件字节数超限 |
| 413 | `IMAGE_DIMENSIONS_INVALID` | 解码像素数超限或危险 |
| 415 | `UNSUPPORTED_IMAGE_TYPE` | MIME 不支持 |
| 422 | `IMAGE_DECODE_FAILED` | 图片损坏或伪造 |
| 422 | `CAPTURED_AT_TIMEZONE_REQUIRED` | 时间没有时区 |
| 422 | `CAPTURED_AT_REQUIRED` | 历史会话没有拍摄时间 |
| 422 | `CAPTURED_AT_CLOCK_SKEW` | 实时帧过旧/过新，或历史帧时间明显在未来 |
| 422 | `COORDINATES_INCOMPLETE` | 纬度和经度没有成对提供 |
| 422 | `INVALID_REGION_CODE` | 地区代码不是两位字母 |
| 422 | `VALIDATION_ERROR` | 字段格式错误 |
| 429 | `FRAME_RATE_EXCEEDED` | 超过会话帧率上限 |
| 429 | `FRAME_UPLOAD_IN_PROGRESS` | 同一会话已有上传正在解析或解码 |
| 429 | `PRINCIPAL_SESSION_CAPACITY_EXCEEDED` | 当前凭证活动会话过多 |
| 503 | `SESSION_CAPACITY_EXCEEDED` | 活动会话达到上限 |
| 503 | `DECODE_CAPACITY_EXCEEDED` | 全局上传/解码槽已满 |
| 503 | `IMAGE_BUFFER_CAPACITY_EXCEEDED` | 全局图片内存预算不足 |

`429` 和 `503` 响应带 `Retry-After: 1`。

## 10. 兼容规则

- `/api/v1` 内只增加可选字段属于兼容变更；
- 删除字段、改变状态语义或坐标语义需要新增 API 版本；
- 前端必须忽略未知字段和未知事件类型；
- 前端不能把 `score` 显示成“准确率”；
- 模型版本、目录版本和用户最终选择应分别保存。
