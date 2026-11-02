# 验收检查表（issue #13）

> 勾选依据均可在本仓库复现；命令默认在 `backend/` 下执行。

## 1. 前端真机录音能上传、解码并完成真实推理（不能只验证手工 WAV）

- [x] 支持 MP3 / WAV / AAC(ADTS) / M4A(MP4)，按魔数嗅探而不是只信 Content-Type
- [x] AAC 的两种载体与常见 Content-Type 别名均可上传（含 CRC ADTS、iOS 的 `audio/aac`+`.m4a`、
      Android 的 `audio/aacp`/`audio/3gpp`），详见 VALIDATION.md §9
- [x] 用 mp3/aac/wav 三种容器（44.1 kHz、16 kHz、48 kHz 单/双声道）跑通真实模型：
      `docs/音频识别后端/validation/audio-eval.md`、`validation/integration-evidence.json`
- [x] 真实 HTTP multipart 上传（uvicorn + httpx），不是直接调用函数
- [ ] **待前端补**：真机 `RecorderManager` 录制的文件跑一次
      `python scripts/smoke_audio_service.py --base-url <联调地址>`，把结果补进 VALIDATION.md
- 依据：`tests/test_audio_decoder.py`（容器嗅探/解码）、`docs/音频识别后端/VALIDATION.md` §6

## 2. 返回排序候选、模型版本、分数类型、音频时长和处理耗时；候选数量可配置

- [x] 响应含 `candidates[rank, score, score_type, confirming_windows]`
- [x] `model.name/version/backend/details`（含模型与标签 SHA-256）
- [x] `audio.duration_seconds/window_count/original_sample_rate`
- [x] `timing.decode_ms/inference_ms/aggregate_ms/total_ms`
- [x] `top_k`（请求）+ `BIRD_AUDIO_CANDIDATE_COUNT` / `BIRD_AUDIO_MAX_CANDIDATE_COUNT`（配置）
- 依据：`docs/音频识别后端/API.md` §2.3、`mock/analysis-candidate.json`、`tests/test_audio_api.py`

## 3. 区分“推理成功但没有可靠候选”和“模型不可用/服务失败”

- [x] `200 + state=unknown`（含 `policy.reason` 与原始标签诊断）
- [x] 模型未加载 → `503 SERVICE_NOT_READY`
- [x] 推理异常 → `500 INFERENCE_FAILED`（`details.stage=inference`）
- [x] ffmpeg 缺失 → `503 AUDIO_RUNTIME_UNAVAILABLE`
- 依据：`tests/test_audio_service.py::test_service_not_ready_is_rejected`、
      `::test_engine_failure_is_reported_as_service_error`、`mock/analysis-unknown.json`

## 4. 空文件、损坏音频、不支持格式、超大文件、超长音频都有稳定错误码

| 场景 | 错误码 | HTTP | 证据 |
|---|---|---:|---|
| 空文件 | `EMPTY_AUDIO` | 422 | `integration-evidence.json` error_case `empty` |
| 损坏音频（可识别帧头 + 坏数据） | `AUDIO_DECODE_FAILED` | 422 | `corrupt` |
| 无法识别的字节流 | `UNSUPPORTED_AUDIO_FORMAT` | 415 | `unidentifiable` |
| 不支持容器（FLAC/OGG/AMR） | `UNSUPPORTED_AUDIO_FORMAT` | 415 | `unsupported` |
| 声明/内容跨族不符 | `AUDIO_FORMAT_MISMATCH` | 415 | `mismatch` |
| 超长（90 s） | `AUDIO_TOO_LONG` | 413 | `too_long` |
| 超大（11 MB） | `AUDIO_TOO_LARGE` | 413 | `oversized` |
| 过短（0.3 s） | `AUDIO_TOO_SHORT` | 422 | `too_short` |

- [x] 8/8 错误用例在真实 HTTP 下通过
- [x] AAC 各载体与 Content-Type 别名全部实测可上传（MP3/WAV/ADTS-AAC/M4A-MP4，26 个别名），
      含 CRC 保护的 ADTS 与 iOS 的 `audio/aac` + `.m4a`；修复记录见
      [VALIDATION.md](VALIDATION.md) §9
- 依据：`docs/音频识别后端/API.md` §2.4、`validation/integration-evidence.json`

## 5. 启动加载、并发/容量限制、临时文件清理

- [x] 启动时校验资产、加载 TFLite、核对输入输出形状、静音预热；失败即拒绝启动
- [x] 并发 = `MAX_CONCURRENT_ANALYSES`（1），排队 = `MAX_QUEUED_ANALYSES`（4），超出立即 429
- [x] 解码并发独立限流（`MAX_CONCURRENT_DECODES`），推理用单锁串行
- [x] 临时文件在成功、解码失败、超时、取消路径均删除（`finally` + 单测断言）
- 依据：`backend/src/bird_audio/app.py`、`service.py`、`audio.py`；
      `tests/test_audio_service.py::test_staged_file_is_removed_after_a_decode_failure`、
      `tests/test_audio_decoder.py::test_stager_rejects_oversized_upload_and_cleans_up`

## 6. 用鸟声、人声、车流、风噪样本做验证，报告误报/漏报/耗时

- [x] 32 个样本（5 种鸟 × 3 容器 + 5 短片段 + 3 类负样本 × 4 格式）
- [x] 鸟声 top-1 18/20（10 s 全对 15/15），负样本误报 **0/12**
- [x] 报告 p50/p95 端到端、解码、单窗推理耗时
- [x] 明确“不用于推导整体准确率”，并列出限制
- [ ] **待补**：真机手机实录（前端）
- 依据：`docs/音频识别后端/VALIDATION.md`

## 7. 可运行服务、配置示例、接口文档、测试结果、前后端联调证据

- [x] 可运行服务：`bird-audio`（8100）、`bird-business`（8200）、`bird-vision` 新增 `/api/v1/vision/analyses`
- [x] 配置示例：`backend/.env.example`（`BIRD_AUDIO_*`、`BIRD_BUSINESS_*`）
- [x] 接口文档：`docs/音频识别后端/API.md`、OpenAPI 快照 `openapi-audio.json`
- [x] 前端 mock 样例：`docs/音频识别后端/mock/*.json`、`docs/视觉识别后端/mock/photo-analysis-candidate.json`
- [x] 测试结果：`pytest` 全绿、覆盖率 ≥80%（见 `docs/音频识别后端/VALIDATION.md`）
- [x] 联调证据：`validation/integration-evidence.json`（真实 HTTP 请求/响应）

## 8. 两个外部依赖

- [x] 单张照片识别适配：`POST /api/v1/vision/analyses`（复用检测器/物种 Provider，一次性返回候选，
      与音频响应风格一致），文档见 `docs/视觉识别后端/API.md`
- [x] 观察记录持久化：`bird-business`（SQLite，幂等写入、按凭证隔离），文档见
      `docs/业务后端/README.md`

## 9. 本期边界（确认未越界）

- [x] 不做持续监听/流式识别
- [x] 不做端侧模型与自动 VAD
- [x] 不做视觉与声音分数融合
- [x] 音频服务不保存原始录音；观察记录由业务服务保存
