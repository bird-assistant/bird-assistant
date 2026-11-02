# 音频识别 API v1

## 1. 基本约定

开发联调地址（本机）：

```text
音频服务   http://127.0.0.1:8100
视觉服务   http://127.0.0.1:8000
业务服务   http://127.0.0.1:8200
```

正式环境由业务网关统一暴露 HTTPS，长期服务密钥只放在网关，不放进小程序包。三个服务使用
同一套鉴权与错误信封：

```http
Authorization: Bearer <server-api-key>
X-API-Key: <server-api-key>
```

除 `/healthz`、`/readyz` 和接口文档外都需要凭证；`BIRD_AUDIO_ALLOW_ANONYMOUS=true` 只用于开发/测试。
每个响应都带 `X-Request-ID`（可由调用方传入，1–128 位字母、数字、`.`、`_`、`:`、`-`）。

OpenAPI：

```text
GET /openapi.json
GET /docs
GET /redoc
```

仓库内快照：[`openapi-audio.json`](openapi-audio.json)。

### 错误信封

```json
{
  "error": {
    "code": "AUDIO_TOO_LONG",
    "message": "audio exceeds the configured duration limit",
    "request_id": "req_8f0c...",
    "details": {"max_duration_seconds": 60.0, "detected_min_seconds": 61.2}
  }
}
```

`429`/`503` 额外带 `Retry-After: 1`。**业务判断只看 `error.code`，不要解析 `message`。**

## 2. `POST /api/v1/audio/analyses`

同步 multipart 上传，一次请求完成一次识别（本期不做异步任务、不做流式）。

### 2.1 请求

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `audio` | file | 是 | 录音文件；支持 MP3 / WAV / AAC(ADTS) / M4A |
| `top_k` | int | 否 | 候选数量 1–50，服务端再受 `BIRD_AUDIO_MAX_CANDIDATE_COUNT`（默认 20）限制；缺省用服务配置 |
| `client_reference` | string | 否 | 调用方自己的 id（≤128），原样回显，用于丢弃旧响应 |

首版支持的录音格式（微信小程序 `RecorderManager` 可产生）：

| 格式 | 容器 | 常见 Content-Type | 说明 |
|---|---|---|---|
| MP3 | `ID3` / 帧同步（Layer III） | `audio/mpeg`、`audio/mp3`、`audio/x-mp3` | 小程序默认推荐 |
| WAV | RIFF/WAVE | `audio/wav`、`audio/x-wav`、`audio/wave`、`audio/vnd.wave` | 无损、体积大 |
| AAC | ADTS | `audio/aac`、`audio/x-aac`、`audio/aacp`、`audio/adts`、`audio/x-hx-aac-adts`、`audio/vnd.dlna.adts`、`audio/mp4a-latm` | 含 CRC 保护与 MPEG-2/4 两种 ADTS 头 |
| M4A / MP4 | ISO BMFF（`ftyp`） | `audio/mp4`、`audio/m4a`、`audio/x-m4a`、`video/mp4`、`audio/3gpp` | iOS/Android 常见的 AAC 载体 |

判定规则：

1. **字节说话**：先按容器魔数嗅探，MP3 与 ADTS 都用 `0xFFF` 同步字，因此按帧头 **layer 位**区分
   （`00` = ADTS AAC，`01` = MPEG Layer III）；`0xF0/0xF8` 这类**带 CRC 的 ADTS** 也正确判为 AAC。
   ID3v2 标签会先被跳过再嗅探（最多读到 8 KB）。
2. **AAC 视为同一族**：`audio/aac` 声明 + M4A 容器（iOS 录制 AAC 常是这样）会被接受，反之
   `audio/mp4` 声明 + ADTS 内容也接受。只有跨族（如声明 `audio/wav` 实际是 MP3）才报
   `AUDIO_FORMAT_MISMATCH`。
3. **魔数无法判定时交给 ffmpeg**：未知包装（自定义头、加壳容器）不再一律 415，而是让 ffmpeg
   识别并解码；确实无法识别任何音频流的才报 `UNSUPPORTED_AUDIO_FORMAT`，能识别但无法解码的报
   `AUDIO_DECODE_FAILED`。
4. **明确不在本期范围的容器**（FLAC / OGG / OPUS / AIFF / AMR / WMA）仍直接 415，错误详情带
   `detected_format` 与 `head_hex`，便于前端判断是否需要补充支持。

`application/octet-stream` 与空 Content-Type 会退化为按魔数嗅探；判断失败时响应详情会带上
`accepted_content_types` / `accepted_formats` / `head_hex`，方便前端对照修正。

请求示例（开发联调，模型用真实引擎）：

```bash
curl -sS -X POST http://127.0.0.1:8100/api/v1/audio/analyses \
  -H "X-API-Key: $BIRD_API_KEY" \
  -F "audio=@A2_mp3_44k_mono.mp3;type=audio/mpeg" \
  -F "top_k=3" \
  -F "client_reference=wx-demo-1"
```

只想先跑通接口（不需要模型）时，用 mock 引擎启动：

```bash
BIRD_AUDIO_ENGINE_BACKEND=mock bird-audio --port 8100
```

### 2.2 限制

| 限制 | 默认值 | 配置 |
|---|---:|---|
| 最大体积（实际字节） | 10 MB | `BIRD_AUDIO_MAX_AUDIO_BYTES` |
| 最大时长 | 60 s | `BIRD_AUDIO_MAX_DURATION_SECONDS` |
| 最短时长 | 1.0 s | `BIRD_AUDIO_MIN_DURATION_SECONDS` |
| 上传超时（含慢速上传） | 20 s | `BIRD_AUDIO_UPLOAD_TIMEOUT_SECONDS` |
| 处理超时（解码 + 推理） | 30 s | `BIRD_AUDIO_PROCESSING_TIMEOUT_SECONDS` |
| 并发分析 | 1 | `BIRD_AUDIO_MAX_CONCURRENT_ANALYSES` |
| 排队上限 | 4 | `BIRD_AUDIO_MAX_QUEUED_ANALYSES` |

原型演示里的 5 s 上限**不再适用**；60 s 覆盖小程序 `duration` 上限（60000 ms）。
超过容量立即返回 `429 AUDIO_CAPACITY_EXCEEDED`，不会无限排队。

### 2.3 成功响应 `200`

```json
{
  "analysis_id": "aud_9c1f0d1b6f5f4b2e9d1a2f0a3c4b5d6e",
  "state": "candidate",
  "candidates": [
    {
      "rank": 1,
      "species_id": "avibase-88BB4F2A",
      "scientific_name": "Turdus merula",
      "common_name_zh": "乌鸫",
      "common_name_en": "Eurasian Blackbird",
      "score": 0.975,
      "score_type": "birdnet_confidence",
      "confirming_windows": 6,
      "mapped": true,
      "match": "scientific_name",
      "model_label": "Turdus merula_Eurasian Blackbird",
      "window_scores": [0.93, 0.96, 0.97, 0.97, 0.95, 0.91]
    }
  ],
  "model": {
    "name": "BirdNET_GLOBAL_6K_V2.4",
    "backend": "ai-edge-litert",
    "device": "cpu",
    "ready": true,
    "score_type": "birdnet_confidence",
    "details": {
      "model_sha256": "55f3e405...",
      "labels_sha256": "b50b77b7...",
      "window_samples": 144000,
      "sample_rate": 48000,
      "version": "2.4"
    }
  },
  "audio": {
    "filename": "A2_mp3_44k_mono.mp3",
    "content_type": "audio/mpeg",
    "format": "mp3",
    "size_bytes": 439214,
    "duration_seconds": 10.0,
    "sample_rate": 48000,
    "channels": 1,
    "original_sample_rate": 44100,
    "original_channels": 1,
    "window_count": 6,
    "zero_padded_seconds": 0.5
  },
  "policy": {
    "min_score": 0.5,
    "min_confirming_windows": 2,
    "required_windows": 2,
    "min_margin": 0.0,
    "candidate_count": 3,
    "window_seconds": 3.0,
    "hop_seconds": 1.5,
    "min_duration_seconds": 1.0,
    "max_duration_seconds": 60.0,
    "max_audio_bytes": 10485760,
    "score_type": "birdnet_confidence",
    "decision": "candidate",
    "reason": "candidate_above_threshold"
  },
  "timing": {"decode_ms": 44.4, "inference_ms": 125.5, "aggregate_ms": 9.6, "total_ms": 179.5},
  "notes": [],
  "diagnostics": {
    "top_labels": [{"model_label": "Turdus merula_Eurasian Blackbird", "score": 0.975, "is_bird": true}],
    "non_bird_top": {"model_label": "Human vocal_Human vocal", "score": 0.02, "above_threshold": false},
    "windows": [{"index": 0, "start_seconds": 0.0, "end_seconds": 3.0, "padded": false, "inference_ms": 20.9}]
  },
  "client_reference": "wx-demo-1",
  "created_at": "2026-10-27T11:58:12.345678Z"
}
```

字段语义：

| 字段 | 说明 |
|---|---|
| `state` | `candidate`＝有可靠候选；`unknown`＝推理完成但无可靠候选（**不是错误**） |
| `candidates[].score` | 该标签在**所有窗口中的最大值**；`score_type=birdnet_confidence` 是模型 sigmoid 输出，**不是校准后的正确率** |
| `candidates[].confirming_windows` | 达到阈值的窗口数，必须 ≥ `policy.required_windows` |
| `candidates[].species_id` | AviList 目录 ID；未映射时为 `null` |
| `candidates[].mapped` / `match` | 是否对齐目录；`scientific_name` / `common_name` / `null` |
| `policy.reason` | `candidate_above_threshold`、`no_label_above_threshold`、`insufficient_window_confirmation`、`non_bird_dominant`、`top_margin_too_small` |
| `audio.duration_seconds` | 解码后的真实时长（按采样数计算，不信任文件头） |
| `audio.window_count` | 送进模型的 3 s 窗口数量 |
| `notes` | `short_clip_zero_padded`、`reduced_window_confirmation`、`non_bird_labels_excluded`、`unmapped_candidates_present`、`mock_engine` |
| `diagnostics` | 排查用；`BIRD_AUDIO_INCLUDE_DIAGNOSTICS=false` 时为 `null` |

`unknown` 示例（车流噪声，推理成功）：

```json
{
  "state": "unknown",
  "candidates": [],
  "policy": {"decision": "unknown", "reason": "no_label_above_threshold"},
  "diagnostics": {"top_labels": [{"model_label": "Porzana porzana_Spotted Crake", "score": 0.124}]},
  "notes": ["non_bird_labels_excluded"]
}
```

完整样例：[`mock/analysis-candidate.json`](mock/analysis-candidate.json)、
[`mock/analysis-unknown.json`](mock/analysis-unknown.json)、
[`mock/error-example.json`](mock/error-example.json)。

### 2.4 错误码

| `code` | HTTP | 触发条件 | 前端处理 |
|---|---:|---|---|
| `VALIDATION_ERROR` | 422 | 缺少 `audio`、`top_k` 越界等表单错误 | 修正请求 |
| `EMPTY_AUDIO` | 422 | 0 字节文件 | 提示重录 |
| `AUDIO_TOO_LARGE` | 413 | 实际字节或 Content-Length 超限 | 提示缩短录音 |
| `AUDIO_TOO_LONG` | 413 | 解码后时长 > 60 s | 提示缩短录音 |
| `AUDIO_TOO_SHORT` | 422 | 解码后时长 < 1 s | 提示重录 |
| `UNSUPPORTED_AUDIO_TYPE` | 415 | 声明类型不在白名单（详情含 `accepted_content_types`） | 检查 `format` 参数 |
| `UNSUPPORTED_AUDIO_FORMAT` | 415 | 明确不支持的容器（FLAC/OGG/AMR…），或 ffmpeg 无法识别任何音频流（详情含 `detected_format` / `head_hex`） | 换成 MP3/WAV/AAC/M4A |
| `AUDIO_FORMAT_MISMATCH` | 415 | 声明类型与实际容器**跨族**不符（详情含 `accepted_formats`） | 修正 Content-Type |
| `AUDIO_DECODE_FAILED` | 422 | 文件损坏/无音频流 | 提示重录 |
| `AUDIO_DECODE_TIMEOUT` | 408 | ffmpeg 解码超时 | 重试/缩短录音 |
| `AUDIO_UPLOAD_TIMEOUT` | 408 | 上传阶段超时 | 重试（弱网缩短录音） |
| `AUDIO_PROCESSING_TIMEOUT` | 504 | 解码+推理超过处理期限 | 重试 |
| `AUDIO_CAPACITY_EXCEEDED` | 429 | 并发 + 排队已满 | 按 `Retry-After` 退避 |
| `ANALYSIS_CANCELLED` | 499 | 客户端在推理前断开 | 忽略该响应 |
| `SERVICE_NOT_READY` | 503 | 模型未加载完成 | 稍后重试 |
| `AUDIO_RUNTIME_UNAVAILABLE` | 503 | ffmpeg 缺失/路径错误 | 服务端问题 |
| `INFERENCE_FAILED` | 500 | 模型执行异常（≠ 无候选） | 上报并重试 |
| `INVALID_CANDIDATE_COUNT` | 422 | `top_k` 超过服务上限 | 降低 `top_k` |
| `INVALID_MULTIPART` / `INVALID_CONTENT_LENGTH` | 422 | multipart 或头部不合法 | 修正请求 |
| `AUTH_REQUIRED` / `AUTH_INVALID` | 401 | 缺少/错误凭证 | 网关处理 |
| `INTERNAL_ERROR` | 500 | 未预期异常 | 上报 `request_id` |

**区分要点**：`unknown` 是 200 且 `state=unknown`；模型不可用是 503，执行失败是 500，
参数/媒体问题是 4xx。前端不要把 `unknown` 当失败提示，也不要对 4xx 自动重试。

### 2.5 取消与超时

- 前端取消（用户点“取消”）时，请**保留素材**、忽略该次响应；服务端无状态，重试即新建一次
  分析（用 `client_reference` 区分新旧结果）。
- 若客户端在**解码完成后、推理开始前**断开，服务端会检测到并返回 `ANALYSIS_CANCELLED`(499)，
  不再占用推理时间。
- 若推理已经开始，同步请求中断**不会终止**服务器推理：本次任务会跑完并把结果丢弃，
  临时文件仍会被清理。理由是本机 LiteRT 调用不可抢占，强制中断会破坏解释器状态。
- 客户端超时建议 30–60 s（含上传），小于服务端 `处理超时 + 上传超时` 即可。

## 3. 其它端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/healthz` | 进程存活（不代表模型可用） |
| `GET` | `/readyz` | 模型 + ffmpeg 就绪时 200，否则 503；`details` 含标签/目录统计 |
| `GET` | `/api/v1/models` | 模型名、版本、后端、标签与目录版本/哈希、阈值策略，以及 `formats`（可接受的容器与 Content-Type 列表、体积/时长上限） |
| `GET` | `/metrics` | Prometheus 指标（`bird_audio_*`） |

## 4. 前端调用示例（微信小程序）

```js
// 只在微信开发者工具/真机里调用；服务密钥由业务网关注入，不放在小程序
function analyzeRecording(filePath, clientReference) {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: `${GATEWAY}/api/v1/audio/analyses`,
      filePath,
      name: 'audio',
      timeout: 60000,
      formData: {
        top_k: '3',
        client_reference: clientReference,
      },
      success: (res) => {
        const body = JSON.parse(res.data || '{}');
        if (res.statusCode === 200) {
          // body.state === 'candidate' | 'unknown'
          resolve(body);
        } else {
          reject(Object.assign(new Error(body.error?.message || 'analysis failed'), {
            code: body.error?.code,
            requestId: body.error?.request_id,
          }));
        }
      },
      fail: reject,
    });
    // 用户取消：忽略旧响应，但保留本地录音
    cancelRef.set(clientReference, () => resolve({ cancelled: true }));
    return task;
  });
}
```

录制参数建议（与后端接受的格式一致）：

```js
const recorder = wx.getRecorderManager();
recorder.start({
  duration: 30000,        // 最长 60 s，后端上限 60 s
  sampleRate: 44100,      // 后端统一转 48 kHz
  numberOfChannels: 1,
  format: 'mp3',          // 或 'aac' / 'wav'
  encodeBitRate: 96000,
});
```

前端注意：

1. `format` 必须是 `mp3`/`aac`/`wav`（`PCM` 无容器头，本期不支持）。
2. 录音 ≤1 s 会得到 `AUDIO_TOO_SHORT`，UI 需要有最短时长提示。
3. 容器/声明类型不匹配的判定：`AUDIO_FORMAT_MISMATCH` 只在**跨族**时出现（MP3↔WAV 等）。
   AAC 的两种载体（ADTS 与 M4A/MP4）互为兼容，`audio/aac` 声明配 `.m4a` 文件会被正常识别，
   iOS 真机录音即属于这种情况。
4. `unknown` 不等于失败：提示“没有可靠候选，可以靠近再录一次”。
5. 每次请求带唯一 `client_reference`，丢弃非当前 id 的响应。

## 5. 单张照片识别（视觉服务适配）

小程序拍照页只需要一次识别，因此视觉服务新增一次性适配端点（复用同一检测器/物种 Provider，
不经过会话与跟踪）：

```http
POST /api/v1/vision/analyses
Content-Type: multipart/form-data

image=<JPEG/PNG/WebP>
```

```bash
curl -sS -X POST http://127.0.0.1:8000/api/v1/vision/analyses \
  -H "X-API-Key: $BIRD_API_KEY" \
  -F "image=@image/bird.jpg;type=image/jpeg"
```

响应与音频保持同一风格：

```json
{
  "analysis_id": "pho_...",
  "state": "candidate",
  "candidates": [
    {
      "rank": 1,
      "species_id": "avibase-...",
      "scientific_name": "Egretta garzetta",
      "common_name_zh": "白鹭",
      "common_name_en": "Little Egret",
      "score": 0.93,
      "score_type": "relative_similarity",
      "similarity": 0.41,
      "region_match": true
    }
  ],
  "subjects": [{"rank": 1, "bbox": {"x1": 0.24, "y1": 0.18, "x2": 0.76, "y2": 0.82}, "state": "candidate"}],
  "model": {"name": "bioclip-2-zero-shot", "backend": "open-clip", "device": "cuda:0", "ready": true},
  "image": {"width": 1280, "height": 960, "size_bytes": 231231},
  "policy": {"decision": "candidate", "reason": "candidate_above_similarity", "max_subjects": 3},
  "timing": {"decode_ms": 8.1, "detection_ms": 45.2, "species_ms": 120.4, "total_ms": 173.7},
  "notes": []
}
```

- 无检测框：`state=unknown`、`reason=no_bird_detected`
- 目标太小：`reason=subject_below_minimum_size`
- 分类器未启用：`reason=species_backend_disabled`
- 超过 `BIRD_VISION_MAX_IMAGE_BYTES` / 像素数：`IMAGE_TOO_LARGE` / `IMAGE_DIMENSIONS_INVALID`
- 样例：`docs/视觉识别后端/mock/photo-analysis-candidate.json`（随照片适配 PR 一起提交）

## 6. 观察记录（业务服务）

用户确认候选后由前端（或网关）写入业务服务，音频/照片服务不保存原始素材：

```http
POST /api/v1/observations
Content-Type: application/json

{
  "source": "audio",
  "source_analysis_id": "aud_9c1f...",
  "species_id": "avibase-88BB4F2A",
  "scientific_name": "Turdus merula",
  "common_name_zh": "乌鸫",
  "common_name_en": "Eurasian Blackbird",
  "score": 0.975,
  "score_type": "birdnet_confidence",
  "observed_at": "2026-10-27T11:58:12Z",
  "latitude": 31.8206,
  "longitude": 117.2272,
  "note": "校园梧桐树上",
  "client_reference": "wx-demo-1"
}
```

`201` 新建；同样的 `(source_analysis_id, species_id)` 重试返回 `200` 与同一条记录（幂等）。
`GET /api/v1/observations?limit=&offset=&source=` 只返回当前凭证自己的记录。
详见并行的「照片与观察记录」PR（`docs/业务后端/README.md`）。
