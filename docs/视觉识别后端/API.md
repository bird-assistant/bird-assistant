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
  "version": "0.2.0",
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
  "latitude": 31.2304,
  "longitude": 121.4737,
  "region_code": "CN"
}
```

经纬度和地区代码均可省略；地区默认由 `BIRD_VISION_SPECIES_DEFAULT_REGION_CODE` 决定。当前推理只使用显式/默认 `region_code`，不会根据经纬度自行反查国家或栖息范围；响应中的 `coordinates_used_for_inference=false` 明确这一点。地区只影响候选排序先验，不会把全球其他物种从候选空间删除。`client_session_id` 会随会话查询结果返回，仅供调用链关联，不作为服务端会话 ID。

成功返回 `201`：

```json
{
  "session_id": "vs_553d1f...",
  "created_at": "2026-10-23T08:00:00Z",
  "expires_after_idle_seconds": 300,
  "recommended_frame_interval_ms": 200,
  "websocket_path": "/api/v1/vision/sessions/vs_553d1f.../events",
  "region_code": "CN",
  "catalog_version": "v2026",
  "coordinates_used_for_inference": false
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
    "region_code": "CN",
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
| `latitude` | 否 | number | `[-90, 90]`，用于请求上下文，不写入名录 |
| `longitude` | 否 | number | `[-180, 180]` |

示例：

```bash
curl -X POST \
  -H 'Authorization: Bearer change-me' \
  -F 'frame_id=frame-000001' \
  -F 'captured_at=2026-10-23T16:00:01.325+08:00' \
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
  "image_width": 1280,
  "image_height": 720,
  "tracks": [
    {
      "track_id": 7,
      "state": "confirmed",
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
            "region_match": true
          }
        ],
        "decision": {
          "accepted": true,
          "reason": "accepted",
          "top_similarity": 0.287531,
          "margin": 0.018422,
          "min_similarity": 0.2,
          "min_margin": 0.01,
          "candidate_count": 10970,
          "region_code": "CN",
          "catalog_version": "v2026"
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

物种相关字段：

- `score`：全量启用目录内 softmax 相对排序分数，目录变化时会变化；
- `similarity`：图像与该物种文本提示的原始余弦相似度；
- `region_match`：物种是否带当前会话区域标记；
- `candidate_count`：本次实际参与排名的物种数，应为全量目录中的启用数；
- `margin`：加入地区先验后 Top-1 与 Top-2 的分数差；
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
    "candidate_count": 10970,
    "region_code": "CN",
    "catalog_version": "v2026"
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
  "region_code": "CN",
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
