# 音频服务样本验证报告

> 验证对象：`bird_audio` 服务（上传 → 解码 → 48 kHz 单声道 → 3 s 分窗 → BirdNET v2.4 → 聚合/拒识 → 目录映射）。
> 结论用于确认流程、错误码与阈值方向，**不用于推导整体准确率**。

## 1. 环境

| 项 | 值 |
|---|---|
| 机器 | Intel Core Ultra 9 275HX / Windows 11 / CPython 3.13 |
| 运行时 | `ai-edge-litert 2.3.0`（XNNPACK，4 线程）、ffmpeg 7.1（imageio-ffmpeg 自带） |
| 模型 | BirdNET 6K v2.4 FP32，`sha256 55f3e405…4c` |
| 标签 | 6522 条，`sha256 b50b77b7…16`；鸟种 6514、非鸟类 8 |
| 目录 | AviList v2026 全球 11,172 种；学名匹配 6,121、英文名匹配 205、未映射 188 |
| 策略 | `min_score=0.5`、跨窗确认 2、窗 3.0 s / 步进 1.5 s、最短 1.0 s |

## 2. 样本集

原始素材是 issue #6 的验证集（5 段鸟鸣 + 人声/车流/风噪），本报告用
`scripts/prepare_audio_samples.py` 把它们转成**小程序录音会产生的容器与采样率**：
每段 10 s，各生成 MP3 44.1 kHz 单声道 96 kbps、AAC 16 kHz 单声道（ADTS）、WAV 48 kHz 单声道，
另外每段生成一个 2 s 的 MP3 短片段（验证补零与降级确认规则）。

| 组 | 数量 | 说明 |
|---|---:|---|
| 鸟鸣 10 s | 15 | 5 种 × 3 种容器 |
| 鸟鸣 2 s | 5 | 验证短录音规则 |
| 负样本 | 12 | 人声、车流、合成风噪 × 4 种格式 |
| 合计 | 32 | 全部经 HTTP multipart 上传 |

期望物种：乌鸫 *Turdus merula*、大山雀 *Parus major*、蓝山雀 *Cyanistes caeruleus*、
大杜鹃 *Cuculus canorus*、苍头燕雀 *Fringilla coelebs*。

> 说明：这些是同一素材的转码，**不是真机录制的音频**。容器/采样率/声道与真机一致，
> 但麦克风频响、风噪、远距离衰减仍需前端补测（见 §7）。

## 3. 结果（默认策略）

逐样本明细：[`validation/audio-eval.md`](validation/audio-eval.md)（机器可读：
[`audio-eval.json`](validation/audio-eval.json)）。

| 组 | 结果 |
|---|---|
| 鸟鸣 10 s（15 个） | **top-1 全部正确**，15/15；分数 0.892–0.999 |
| 鸟鸣 2 s（5 个） | 3/5 top-1；A1、A2 的 2 s 片段落在引子安静段，最高分 <0.5 → `unknown` |
| 负样本（12 个） | **误报 0/12**，全部 `unknown` |
| 总体 | `unknown` 14/32（12 个负样本 + 2 个短片段） |

负样本细节（说明拒识不是“随便就关掉”）：

| 样本 | 最高标签 | 最高分 | 结果 |
|---|---|---:|---|
| N1 人声 | `Human vocal` | 0.176 | `unknown`（人声被正确识别为非鸟类并排除） |
| N2 车流 | `Porzana porzana` | 0.421 | `unknown` |
| N3 风噪 | `Psiloscops flammeolus` | **0.642**（仅 1/6 窗） | `unknown`（`insufficient_window_confirmation`） |

风噪这一条正是**跨窗确认的价值**：单窗 0.64 已过 0.5 阈值，如果只要求 1 个窗口就会误报成
“Flammulated Owl”。关掉跨窗确认后的扫描同样复现了这一点（下表 0.25/1 与 0.5/1 行）。

## 4. 阈值/跨窗策略扫描

同一批窗口分数离线重算（`scripts/evaluate_audio.py` 的 `sweep`）：

| min_score | 最少确认窗 | 鸟声 top-1 | 负样本误报 | `unknown` |
|---:|---:|---:|---:|---:|
| 0.25 | 1 | 18/20 | 2/12 | 12 |
| 0.25 | 2 | 18/20 | 0/12 | 14 |
| 0.25 | 3 | 15/20 | 0/12 | 17 |
| 0.50 | 1 | 18/20 | 1/12 | 13 |
| **0.50** | **2** | **18/20** | **0/12** | 14 |
| 0.50 | 3 | 15/20 | 0/12 | 17 |
| 0.70 | 1 | 18/20 | 0/12 | 14 |
| 0.70 | 2 | 18/20 | 0/12 | 14 |
| 0.70 | 3 | 14/20 | 0/12 | 18 |

结论：默认的 `0.5 + 2 窗`在本批样本上与更严格策略同样零误报，却保留了短录音的可用性；
把确认窗提到 3 会明显增加漏报（短片段只有 1–2 个窗口）。**维持 0.5 + 2 窗**。

## 5. 延迟

| 指标 | p50 | p95 |
|---|---:|---:|
| 端到端（含上传后处理） | 177.6 ms | 192.7 ms |
| 解码 + 转 48 kHz | 44.7 ms | 50.7 ms |
| 单窗推理 | 20.4 ms | 23.4 ms |

10 s 音频 = 6 窗，平均总耗时 151 ms（短片段 55–95 ms）。同一台机器上预研报告的 3 s 单窗
17.2–17.9 ms 与本实现 20.4 ms 属于同一量级，差异来自 stderr 解析与 float 列表拷贝。

## 6. HTTP 端到端证据

`scripts/smoke_audio_service.py --base-url http://127.0.0.1:8100` 对**运行中的服务**发起真实
multipart 请求，证据：[`validation/integration-evidence.json`](validation/integration-evidence.json)。

| 项 | 结果 |
|---|---|
| 就绪探针 | `200 ready`（真实模型 + ffmpeg） |
| 样本上传 | 32/32 返回 200 |
| `candidate` | 18 |
| `unknown` | 14 |
| 平均总耗时 | 161 ms |
| 错误用例 | **7/7 通过** |

错误用例与返回码：

| 用例 | 期望 | 实际 |
|---|---|---|
| 0 字节 MP3 | `EMPTY_AUDIO` 422 | ✅ |
| 伪造 ID3 + 随机字节（损坏） | `AUDIO_DECODE_FAILED` 422 | ✅ |
| 纯文本文件（`octet-stream`） | `UNSUPPORTED_AUDIO_FORMAT` 415 | ✅ |
| MP3 内容声明为 `audio/wav` | `AUDIO_FORMAT_MISMATCH` 415 | ✅ |
| 0.3 s 音频 | `AUDIO_TOO_SHORT` 422 | ✅ |
| 90 s 音频 | `AUDIO_TOO_LONG` 413 | ✅ |
| 11 MB 文件 | `AUDIO_TOO_LARGE` 413 | ✅ |

此外自动化测试覆盖：未知 Content-Type、Content-Length 超限、multipart 缺字段、容量 429、
处理超时 504、推理异常 500、模型未就绪 503、客户端断开 499、鉴权 401，以及临时文件在成功/失败
路径都被删除（`backend/tests/test_audio_*.py`，共 123 个用例）。

## 7. 复现

```bash
cd backend
python -m pip install -e '.[test,audio]'
export BIRD_AUDIO_ENGINE_BACKEND=birdnet
python scripts/prepare_audio_samples.py           # 需要 鸟类识别预研/data/audio 下的原始素材
python scripts/evaluate_audio.py                  # -> results/audio-eval/audio-eval.{json,md}
bird-audio --port 8100 &
python scripts/smoke_audio_service.py --base-url http://127.0.0.1:8100
```

原始素材由 `鸟类识别预研/scripts/fetch_assets.py` 恢复（CC BY / CC BY-NC-SA，见
`鸟类识别预研/NOTICE.md`）。

## 8. 限制与遗留

1. **没有真机录音**：本报告的“手机格式”是转码，不是手机麦克风实录。前端需要在真机录 10 段
   （含风、车、人声、远距离）后重跑 `smoke_audio_service.py`，再把新证据补到本文件。
2. 样本量小（32 个），不能据此给出准确率；`unknown` 比例高主要来自负样本设计。
3. 2 s 片段从**文件开头**截取，A1/A2 恰好落在安静引子，因此 `unknown` 属于正常拒识，不是缺陷。
4. 未测多鸟混鸣、雨声、昆虫声；这些噪声不在 BirdNET 的 8 个非鸟类类别里，仍可能产生候选。
5. 端到端延迟是单机单请求测量，未做并发压测（并发上限由准入控制保证）。

## 9. 复测记录：AAC 音频被判为不支持（2026-10-29）

**现象**：联调时上传 AAC 录音返回 415。

**复现矩阵**（修复前的真实返回）：

| 文件 | 声明 Content-Type | 修复前 | 原因 |
|---|---|---|---|
| ADTS AAC（`0xFFF1`） | `audio/aac` | 200 ✅ | — |
| ADTS AAC | `audio/aacp` | **415 UNSUPPORTED_AUDIO_TYPE** | 白名单过窄 |
| ADTS AAC | `audio/x-hx-aac-adts` | **415 UNSUPPORTED_AUDIO_TYPE** | 白名单过窄 |
| ADTS AAC（CRC 保护，`0xFFF0`） | `audio/aac` | **415 AUDIO_FORMAT_MISMATCH** | 嗅探只认 `0xF1/0xF9`，把 `0xF0/0xF8` 当成 MP3 |
| MP4/M4A（iOS 录音） | `audio/aac` | **415 AUDIO_FORMAT_MISMATCH** | 把 ADTS 与 M4A 当成两种不同格式 |
| MP4 | `video/mp4` | **415 UNSUPPORTED_AUDIO_TYPE** | 白名单过窄 |

**根因**（三个叠加）：

1. 魔数嗅探用“两个字节白名单”判断 ADTS，忽略了 `0xF0/0xF8`（带 CRC）与层级位语义，
   而 MP3 与 ADTS 共享 `0xFFF` 同步字，必须按 **layer 位**区分；
2. Content-Type 白名单只列了 10 个常见值，缺 `audio/aacp`、`audio/x-hx-aac-adts`、
   `audio/vnd.dlna.adts`、`audio/mp4a-latm`、`video/mp4`、`audio/3gpp` 等真实客户端取值；
3. 一致性校验把 ADTS 与 M4A 视为不同格式，而它们只是 AAC 的两种载体（iOS 录音就是
   MP4 容器 + `audio/aac` 声明）。

**修复**：

- 按帧头 layer 位判定：`00` → ADTS AAC（含 MPEG-2/4、含/不含 CRC），`01` → MPEG Layer III；
  Layer I/II 不再误判；
- 嗅探前跳过 ID3v2 标签（最多读 8 KB），带标签的 AAC 也能识别；
- Content-Type 改为“别名 → 容器族”映射（26 个别名），AAC 族内 ADTS 与 M4A/MP4 互相兼容，
  `AUDIO_FORMAT_MISMATCH` 只在**跨族**（如声明 wav 实际 mp3）时出现；
- 魔数无法判定时不再直接 415，而是交给 ffmpeg：能识别音频就按实际容器接受，确实无法识别
  任何音频流才报 `UNSUPPORTED_AUDIO_FORMAT`；能识别但解码失败报 `AUDIO_DECODE_FAILED`；
- `/api/v1/models` 新增 `formats`（可接受容器、26 个 Content-Type、体积与时长上限），
  415 响应详情补充 `accepted_*` 与 `head_hex`，便于前端自查。

**修复后复测**（同一台机器、同一模型）：

| 用例 | 结果 |
|---|---|
| ADTS × {audio/aac, audio/aacp, audio/x-hx-aac-adts, octet-stream} | 4/4 `200 candidate`，`format=aac` |
| M4A/MP4 × {audio/aac, audio/mp4, audio/x-m4a, video/mp4, audio/3gpp} | 5/5 `200 candidate`，`format=m4a` |
| CRC ADTS（`0xFFF0`） | `200 candidate` |
| 8 kHz 低采样率 ADTS | `200 unknown`（格式正常识别，频带被截断导致无可靠候选，符合预期） |
| 带 ID3v2 标签的 AAC | `200 candidate` |
| 跨族不匹配（MP3 声明为 wav） | `415 AUDIO_FORMAT_MISMATCH` |
| FLAC / AMR / 纯文本 | `415 UNSUPPORTED_AUDIO_FORMAT` |
| 可识别但损坏（合法帧头 + 垃圾） | `422 AUDIO_DECODE_FAILED` |
| 全量 smoke（32 样本 + 8 错误用例） | `32/32`、`8/8` 通过 |

单元/接口测试相应扩充：ADTS/MP3 各 6 种帧头、ID3 跳过、AAC 别名 5 种、MP4 别名 5 种、
未知容器回退、跨族不匹配旁证，共新增 20 个用例（音频相关合计 169 个）。

> 结论：AAC 不是“模型不支持”，而是**上传校验过窄**，已在服务层修复；模型侧无需改动。
