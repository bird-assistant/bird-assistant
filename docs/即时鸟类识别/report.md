# 阶段验收报告：视觉线 + 音频线

生成时间：2026-10-22 ｜ 环境：Windows 11 / Intel Core Ultra 9 275HX / CPU-only / Python 3.13.9

## 一、结论

| 问题 | 回答 |
|---|---|
| 能不能从视频/摄像头画面里发现鸟？ | **能**。yolo11n@640 + ByteTrack，端到端 p50 **24.2 ms**、p95 27.0 ms（720p 29.97fps 源，实时比 1.07）。 |
| 小目标行不行？ | **不行**。鸟短边 ≥64px 召回 0.88–0.94；32–64px 掉到 **0.06–0.11**。 |
| 能不能跟踪同一只鸟？ | **能**。停留的鸟连续 93 帧保持同一 ID；飞出/被完全遮挡后换号。 |
| 能不能给候选物种（图像）？ | **当前不能**。ImageNet-59 词表不含蓝山雀等目标物种，top-1 逐帧抖动（每 track 3.1 个标签）。同科近缘能排第一，说明换词表即可，不是换架构。 |
| 能不能从录音里返回候选鸟种？ | **能**。BirdNET v2.4 单窗 17–18 ms，干净音频 5/5 top-1 正确（0.90–1.00）；1 s 音频即可，0.5 s 不可靠；车流噪声会导致 0.47 误报，**阈值要 ≥0.5 并做连续窗确认**。 |
| 下一步 | 图像：检测/跟踪 **直接用**，物种 **换词表**，小目标 **产品层引导变焦**；音频：**先走服务端** + VAD + 三窗确认。 |

## 二、视觉线验收对照

| # | 验收标准 | 是否满足 | 证据 |
|---|---|---|---|
| 1 | 可以对至少一个测试视频运行 | ✅ 2 段视频（V1 720p、V2 576p），各 300 帧 | `results/V1/*.mp4`、`results/V2/*.mp4` |
| 2 | 输出检测框或候选结果 | ✅ 带框+track id+top-1 物种的 mp4；逐帧逐框 CSV（含 top-5 与置信度） | `results/V1/yolo11n_640.mp4`、`results/V1/yolo11n_640_frames.csv` |
| 3 | 记录运行设备、模型、输入分辨率、帧率和延迟 | ✅ 每个 JSON 自带 `device_info` / `config` / `run` / `latency_ms`（p50/p95/p99 分项） | `results/V1/yolo11n_640.json`、[results/summary.md](../results/summary.md) |
| 4 | 提供成功与失败样例 | ✅ 成功 2 张、失败 2 张，失败标注了原因 | `results/frames/success_*.jpg`、`fail_*.jpg` |
| 5 | 明确下一步：直接用/微调/换方案 | ✅ 分环节给出 | [visual-findings.md](visual-findings.md) §8 |
| 6 | 提供一条可复现运行命令 | ✅ 见下（实测可跑） | 本文 §三 |

## 三、复现命令（实测）

```powershell
.\.venv\Scripts\python.exe experiments\run_visual_baseline.py `
  --source data\videos\V1_feeder_slovakia.webm `
  --model models\yolo11n.pt --imgsz 640 --conf 0.25 --tracker bytetrack `
  --cls-model resnet50 --max-frames 300 `
  --out results\V1\yolo11n_640.mp4 `
  --json results\V1\yolo11n_640.json `
  --csv results\V1\yolo11n_640_frames.csv
```

输出示例（本机实测）：

```json
{
  "frames_processed": 300,
  "fps_processed": 22.86,
  "realtime_factor": 0.763,
  "e2e_p50_ms": 51.14,
  "e2e_p95_ms": 56.94,
  "infer_p50_ms": 17.97,
  "frames_with_bird": "199/300",
  "unique_track_ids": 10,
  "box_side_bins": {"<32": 0, "32-64": 0, "64-128": 40, ">=128": 159}
}
```

（去掉 `--cls-model resnet50` 即为纯检测档：p50 24.2 ms、32 FPS。）

音频复现命令：

```powershell
.\.venv\Scripts\python.exe experiments\run_audio_baseline.py --all --window 3.0 --hop 1.5 --topk 5 --json results\audio\all_3s.json
```

输出示例（本机实测，节选）：

```
top-1 5/5  top-3 5/5
A1_blackbird.wav   exp=Turdus merula        rank=1 top1=Turdus merula_Eurasian Blackbird   p=0.977 lat_p50=17.74ms
A4_cuckoo.wav      exp=Cuculus canorus       rank=1 top1=Cuculus canorus_Common Cuckoo      p=0.925 lat_p50=17.21ms
N2_traffic.wav     exp=(city traffic)        rank=None top1=Puffinus puffinus_Manx Shearwater p=0.471
```

## 四、音频线验收对照

| # | 验收标准 | 是否满足 | 证据 |
|---|---|---|---|
| 1 | 至少测试 5 段音频 | ✅ 5 段鸟鸣（5 个物种）+ 3 段负样本（人声/车流/风噪） | [audio-findings.md](audio-findings.md) §3 |
| 2 | 记录预测结果、延迟和运行环境 | ✅ 每段 top-5 + 逐窗延迟 + `device_info` | `results/audio/all_3s.json`、`results/audio/sweeps.json` |
| 3 | 提供复现步骤 | ✅ 见 §三 音频命令 | 本文 §三 |
| 4 | 说明"实时"具体能做到多快 | ✅ 3 s 窗 + 1.5 s 步进，每 1.5 s 出结果；单窗 17–18 ms；录音端到端 1–3 s | [audio-findings.md](audio-findings.md) §5 |
| 5 | 写出主要限制和下一步建议 | ✅ 5 条限制 + 5 条建议 | [audio-findings.md](audio-findings.md) §7–8 |

## 五、图形界面（测试台）

交付一个 Tkinter 测试台，覆盖「视频文件 / 屏幕区域 / 音频」三条链路，验收人不需要敲命令。

| 项 | 入口 |
|---|---|
| 启动 | `run_gui.bat`（或 `.\.venv\Scripts\python.exe app\gui.py`）；便携版 `dist\BirdLab\BirdLab.exe` |
| 视频 | 导入 mp4/avi/mov/mkv/webm/flv/m4v/ts/wmv → 实时框 + track ID + 候选 + 延迟统计 → 导出 JSON |
| 屏幕区域 | 全屏拖拽框选任意矩形，5/10/15/30 FPS 实时识别（`mss` 抓屏，已做 DPI 感知） |
| 音频 | 多选 wav/mp3/ogg/flac/m4a/aac/opus/wma/amr → top-5 + 逐窗 + 延迟 |
| 清单 | 13 条检查项勾选，一键导出 markdown |

自检结果（与 CLI 完全一致）：

```
vision: frames=31 ids=2 p50=47.0ms p95=55.6ms cls=resnet50      # CLI 同配置 46.6 ms
screen: 640x360 grabbed=8 p50=19.5ms                            # 屏幕采集链路
audio:  A1 0.977 / A4 0.925 / N2 0.471（假阳性）                # 与 CLI 数值一致
exe   : frames=20 p50=47.3ms；audio 0.977/0.925/0.471            # 打包版与源码一致
```

验收步骤：[acceptance-checklist.md](acceptance-checklist.md)。

## 六、已知不满足/未覆盖的部分

1. **真机未验证**：所有数字来自 PC。`onCameraFrame` 帧率、`wx.createInferenceSession` 可用性仍是阻碍项，见 [platform-constraints.md](platform-constraints.md)。2. **样本量小**：2 段素材、各 10 s、2–3 个鸟种，不能外推为"任意场景可用"。
3. **召回是相对参照**：没有人工标注；参照模型自身有漏检，绝对值仅供横向比较。
4. **物种只测了 ImageNet 词表**：真正的鸟类专用分类器（iNat/BioCLIP）**还没测**，所以"物种不可用"只针对当前选型。
5. **音频样本偏"录音室"**：5 段鸟鸣取自 xeno-canto 类素材（近距、单物种、干净），风噪是合成的；没有手机实录、雨声、多鸟混鸣。
6. **端侧音频未测**：BirdNET 只有 FP32 TFLite，没验证小程序端能否加载 49 MB 模型与拿到 48 kHz PCM。

## 七、下一步

| 优先级 | 事项 | 产出 |
|---|---|---|
| P0 | 真机 spike：`onCameraFrame` / `createInferenceSession` / ort-wasm | 回填 platform-constraints.md 的 A/B 表，决定端侧 or 服务端 |
| P0 | 分类换词表：iNat2021 backbone，重跑同一评测 | top-5 命中率 vs 现在的 0 |
| P0 | 音频接 geo filter + VAD + 三窗确认，阈值 0.5 | 车流误报从 0.47 压下去的效果 |
| P1 | 小目标方案：imgsz 960 + 用户点选区域二次推理 | 32–64px 箱召回提升幅度 |
| P1 | 音频补真实场景录音（手机在校园录 10 段） | 替换合成噪声后的置信度曲线 |
| P2 | 产品约束落地：bbox 短边 ≥64px 才给物种；音频 ≥1 s 才给候选 | UX 规则说明 |
