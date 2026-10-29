# 音频识别后端（录完上传的一次性识别）

本目录对应 issue #13「后端声音识别功能」。音频服务把 issue #6 的 BirdNET 预研代码整理成可部署模块：
上传一段录音 → 校验/解码 → 48 kHz 单声道 → 3 s 分窗 → BirdNET v2.4 推理 → 过滤非鸟类标签 →
跨窗聚合与拒识 → 对齐 AviList 物种目录 → 返回排序候选。

## 1. 本期范围

| 做 | 不做 |
|---|---|
| 一次性上传（同步 multipart）识别 | 持续监听、流式识别 |
| 服务端模型推理（CPU） | 端侧模型、自动 VAD |
| 候选排序 + `unknown` 拒识 | 视觉/声音分数融合 |
| 物种目录对齐（学名/中英文名/物种 ID） | 原始录音长期存储、观察记录入库（见业务服务） |

原始录音只在请求期间存在，落盘的只有临时文件，成功与失败路径都会删除。

## 2. 交付组成

| 包 | 服务 | 入口 | 默认端口 | 额外依赖 |
|---|---|---|---:|---|
| `bird_common` | 共享的应用外壳、鉴权、错误、目录加载 | — | — | 无 |
| `bird_audio` | 音频识别服务 | `bird-audio` | 8100 | `.[audio]`（LiteRT + numpy + ffmpeg） |
| `bird_business` | 观察记录持久化服务 | `bird-business` | 8200 | 无（SQLite 为标准库） |
| `bird_vision` | 视觉服务，本期新增单张照片一次性识别适配 | `bird-vision` | 8000 | `.[gpu]` |

三个服务共用同一套运行约定（JSON 日志、`X-Request-ID`、统一错误信封、API Key 鉴权），
这样网关和前端只需要一套错误处理。

## 3. 处理流水线

```text
POST /api/v1/audio/analyses (multipart)
 1. 准入：Content-Length / 实际字节数 ≤ 10 MB，上传超时 20 s，容量计数
 2. 落盘：写入私有临时文件（流式分块，边写边计数）
 3. 校验：声明类型白名单（含 AAC/MP4 系列别名）+ 魔数嗅探（ID3 跳过、MP3/ADTS 按 layer 位区分）
    + 类型/内容一致性（AAC 的 ADTS 与 M4A 视为同族）+ 是否可解码；魔数不明时交给 ffmpeg 判定
 4. 解码：ffmpeg -> 48 kHz / 单声道 / float32，最多多解 1 s 以判断是否超长
 5. 时长：>60 s -> AUDIO_TOO_LONG；<1 s -> AUDIO_TOO_SHORT
 6. 分窗：3.0 s 窗、1.5 s 步进，末尾窗补零
 7. 推理：单进程串行调用 LiteRT，逐窗 sigmoid 分数
 8. 聚合：按标签取跨窗最大值；过滤 8 个非鸟类类别；要求跨窗确认
 9. 映射：学名精确匹配 -> 唯一英文名匹配 -> 保留原始标签并标记 unmapped
10. 清理：finally 删除临时文件（成功、解码失败、超时、客户端取消都一样）
```

## 4. 阈值与短录音规则（预研策略 → 样本检查后确定）

默认策略：

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `BIRD_AUDIO_MIN_SCORE` | 0.50 | 候选必须达到的模型分数（预研：0.5 以下车流会误报） |
| `BIRD_AUDIO_MIN_CONFIRMING_WINDOWS` | 2 | 同一标签需要有 2 个窗口达到阈值（跨窗确认） |
| 实际要求窗数 | `min(2, 窗口数)` | 短录音只有 1 个窗口时降为 1，响应以 `notes` 说明 |
| `BIRD_AUDIO_MIN_MARGIN` | 0.0 | 默认关闭；开启后 Top-1/Top-2 差值不足则返回 `unknown` |
| `BIRD_AUDIO_CANDIDATE_COUNT` | 5 | 返回候选数量，可用请求字段 `top_k` 覆盖（上限 20） |

用 32 个样本（5 段鸟鸣 × {MP3 44.1k, AAC 16k, WAV 48k} + 5 个 2 s 短片段 + 3 类负样本 × 4 种格式）
扫描的结果（详见 [VALIDATION.md](VALIDATION.md)）：

| min_score | 最少确认窗 | 鸟声 top-1 | 负样本误报 | `unknown` 数 |
|---:|---:|---:|---:|---:|
| 0.25 | 1 | 18/20 | **2/12** | 12 |
| 0.50 | 1 | 18/20 | 1/12 | 13 |
| **0.50** | **2** | **18/20** | **0/12** | 14 |
| 0.70 | 2 | 18/20 | 0/12 | 14 |

结论：**保留 0.5 + 跨窗 2 窗**。关掉跨窗确认（=1）在 0.25 时立刻出现车流/风噪误报，
与预研结论一致；0.7 在这批样本上没有额外收益，但会把边界样本推成 `unknown`，暂不提高。

短录音：<3 s 的录音会补零到 3 s，只有 1 个窗口，因此跨窗确认降为 1，并在响应里给
`notes=["short_clip_zero_padded","reduced_window_confirmation"]`。实测 2 s 片段 3/5 命中，
2 段落在安静开头而返回 `unknown`；**短录音不做“更自信”的推断**，宁可不给候选。
最低可识别时长设为 1.0 s（0.5 s 预研就掉到 3/5 且错得很自信）。

## 5. 结果状态

| `state` | 含义 | 前端行为 |
|---|---|---|
| `candidate` | 有达到阈值且通过跨窗确认的候选，已排序 | 展示候选列表，用户选择后写入观察记录 |
| `unknown` | 推理**成功完成**，但没有可靠候选 | 提示“没有可靠候选”，可重录；不是错误 |
| HTTP 错误 | 模型不可用、服务执行失败、上传/解码/时长/容量问题 | 按错误码提示，可重试的按 `Retry-After` 退避 |

`unknown` 仍会在 `diagnostics` 中给出模型最高分的原始标签，便于排查，但**不作为候选返回**。

## 6. 物种目录对齐

BirdNET v2.4 使用 eBird/Clements 命名（6522 个标签，其中 6514 个鸟种、8 个非鸟类类别），
项目目录是 AviList v2026（11,172 种）。启动时逐标签对齐：

| 结果 | 数量 | 说明 |
|---|---:|---|
| 学名精确匹配 | 6,121 | 直接返回目录 `species_id`、中英文名 |
| 唯一英文名匹配 | 205 | 学名不同但英文名在目录中唯一 |
| 未映射 | 188 | 保留 BirdNET 原始学名/英文名，`mapped=false` |
| 非鸟类 | 8 | 不进入候选（`Human vocal`、`Dog`、`Engine` 等） |

未映射的候选不会被丢弃，也不会被猜成别的物种；`species_id` 为 `null`，前端可用
`scientific_name` 展示并提示“未收录”。

## 7. 目录结构

```text
backend/src/
├── bird_common/          应用外壳（app_factory）、鉴权、错误、目录加载、日志
├── bird_audio/
│   ├── audio.py          上传暂存、魔数嗅探、ffmpeg 解码、临时文件清理
│   ├── windows.py        3 s 分窗、补零、确认窗数
│   ├── labels.py         标签解析、非鸟类过滤、目录对齐
│   ├── analyzer.py       聚合、排序、拒识（纯函数）
│   ├── engine.py         BirdNET LiteRT 引擎 + mock 引擎 + 资产校验
│   ├── service.py        准入/并发/超时/取消、编排与报告
│   ├── api.py            /api/v1/audio/analyses、/models、/readyz
│   ├── schemas.py        响应模型（OpenAPI 由此生成）
│   └── app.py            启动加载模型、就绪检查
└── bird_business/        观察记录持久化（SQLite）
```

## 8. 本地运行

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
python -m pip install -e '.[test]'
python -m pip install -e '.[audio]'          # 真实模型需要
cp .env.example .env
bird-audio --host 127.0.0.1 --port 8100      # 开发可用 BIRD_AUDIO_ENGINE_BACKEND=mock
```

模型权重不在仓库内（49 MB，CC BY-NC-SA 4.0），按 [MODELS.md](MODELS.md) 下载到
`鸟类识别预研/models/birdnet/`。ffmpeg 优先取系统 PATH，其次 `BIRD_AUDIO_FFMPEG_PATH`，
最后回退 `imageio-ffmpeg` 自带的二进制。

## 9. 测试

```bash
cd backend
pytest                              # 全部服务；音频测试不依赖真实模型与 ffmpeg
ruff check src tests scripts
```

真实模型与真实解码的验证：

```bash
export BIRD_AUDIO_ENGINE_BACKEND=birdnet
python scripts/prepare_audio_samples.py     # 生成 recorder 格式样本 + manifest
python scripts/evaluate_audio.py            # 直接调用服务类，产出 results/audio-eval
bird-audio --port 8100 &
python scripts/smoke_audio_service.py --base-url http://127.0.0.1:8100
```

## 10. 文档

- [API 协议与前端联调](API.md)
- [部署与运维](DEPLOYMENT.md)
- [模型、标签与分数语义](MODELS.md)
- [样本验证报告](VALIDATION.md)
- [验收检查表](CHECKLIST.md)
- 响应样例（前端 mock）：[`mock/`](mock)、OpenAPI 快照：[`openapi-audio.json`](openapi-audio.json)
- 视觉单张照片适配：[视觉识别 API](../视觉识别后端/API.md)
- 观察记录服务：`docs/业务后端/README.md`（随「照片与观察记录」PR 一起提交）
- 单张照片识别适配：`POST /api/v1/vision/analyses`（同上）
