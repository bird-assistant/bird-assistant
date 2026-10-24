# 观鸟助手 — 技术预研（第 1 周：视觉 + 音频可行性）

用**现成模型**回答两个问题：摄像头画面里能不能快速发现鸟并给出候选物种？能不能从录音里快速返回可能鸟种？
不训练模型，只做最小实验并记录可复现的数字。

> 结论：检测/跟踪可直接用（CPU 24 ms/帧）；图像物种需换词表；音频可用但须服务端 + 阈值 0.5。
> 详见 [report.md](report.md) 与 [visual-findings.md](visual-findings.md) / [audio-findings.md](audio-findings.md)。

第 2 周已经在预研之外新增独立的[视觉识别后端](../视觉识别后端/README.md)，生产服务不再使用本目录的 ImageNet-59 临时分类器。

## 文档导航

| 文档 | 内容 | 适合谁看 |
|---|---|---|
| [implementation-spec.md](implementation-spec.md) | **实现文档**：模型清单、数据与真值、指标公式、实验矩阵、复现步骤、验收清单 | 验收人 / 接手开发 |
| [report.md](report.md) | 阶段验收报告：11 条验收标准逐条对照 | 验收人 |
| [visual-findings.md](visual-findings.md) | 视觉线结论：失败模式分类与「直接用/微调/换方案」判定 | 技术决策 |
| [audio-findings.md](audio-findings.md) | 音频线结论：窗长/噪声/误报、实时性口径、端云判断 | 技术决策 |
| [platform-constraints.md](platform-constraints.md) | 微信小程序平台约束核查表（含未验证项） | 立项评估 |
| [acceptance-checklist.md](acceptance-checklist.md) | **GUI 验收清单**（一页纸，逐条打勾，含格式矩阵与记录表） | 验收人 |
| [NOTICE.md](../NOTICE.md) | 第三方模型/素材的许可与出处（**上线前必读**） | 立项 / 法务 |

## 快速开始（克隆后 5 分钟）

> 以下命令均在**仓库根目录**执行；本文件位于 `docs/`。

仓库**只含代码、文档与小体积结果**；模型权重和测试素材因体积/许可原因不入库，用脚本一键恢复。

```powershell
git clone <repo-url> birdlab
cd birdlab

# 1) 环境（Python 3.11–3.13，3.14 暂无 torch 轮子）
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1+cpu torchvision==0.29.1+cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2) 恢复模型与素材（约 200 MB，可重复执行、已存在则跳过）
.\.venv\Scripts\python.exe scripts\fetch_assets.py

# 3) 启动测试台
run_gui.bat
```

只想跑某一类实验时可以分开取：

```powershell
.\.venv\Scripts\python.exe scripts\fetch_assets.py --only models
.\.venv\Scripts\python.exe scripts\fetch_assets.py --only videos
.\.venv\Scripts\python.exe scripts\fetch_assets.py --only audio
```

## 图形界面（测试台）

不想敲命令时用 GUI：

```powershell
run_gui.bat
# 等价于
.\.venv\Scripts\python.exe app\gui.py
```

| 标签页 | 能力 |
|---|---|
| 视频文件 | 导入 mp4/avi/mov/mkv/webm/flv/m4v/ts/wmv，实时出框 + track ID + 候选物种 + 延迟/唯一 ID 统计，可导出 JSON |
| 屏幕区域 | 全屏拖拽框选任意区域，按 5/10/15/30 FPS 实时识别（`mss` 抓屏，已做 DPI 感知） |
| 音频 | 多选 wav/mp3/ogg/flac/m4a/aac/opus/wma/amr，输出 top-5、逐窗结果、延迟 |
| 验收清单 | 13 条检查项勾选，一键导出 markdown 记录 |

无人值守自检（CI/回归用）：

```powershell
.\.venv\Scripts\python.exe app\gui.py --selftest-video data\videos\V1_feeder_slovakia.webm --frames 40 --cls resnet50
.\.venv\Scripts\python.exe app\engines.py --screen 200,200,640,360 --cls none
```

GUI 与 CLI 用同一套模型与预处理，所以两边的延迟数字可以直接对比。

## 打包成便携版 exe（免装 Python）

```powershell
powershell -ExecutionPolicy Bypass -File build_exe.ps1
```

输出 `dist\BirdLab\`（约 **1.0 GB**），双击 `BirdLab.exe` 即可运行，目标机器**不需要 Python**。

```
dist\BirdLab\
├─ BirdLab.exe              启动器（windowed，无控制台）
├─ _internal\               运行时依赖（torch / torchvision / cv2 / litert / ffmpeg…）
│  └─ data\videos\          内置示例视频
├─ models\yolo11n.pt        检测权重（5.4 MB）
├─ models\birdnet\          BirdNET v2.4（49 MB）
├─ models\torch_hub\        ResNet50 / EfficientNet-B0 权重（离线可用）
├─ results\gui\             导出的 JSON、验收记录、selftest.log
└─ 使用说明.txt
```

体积构成（`_internal` 内）：`torch_cpu.dll` 292 MB、`ffmpeg.exe` 84 MB、`cv2.pyd` 82 MB、模型 173 MB，其余为 DLL/PYD。

打包后的自检（结果同时写入 `results\gui\selftest.log`，因为 windowed 版没有控制台）：

```powershell
cd dist\BirdLab
.\BirdLab.exe --selftest-video data\videos\V1_feeder_slovakia.webm --frames 20 --cls resnet50
.\BirdLab.exe --selftest-audio data\audio\wav\A1_blackbird.wav,data\audio\wav\N2_traffic.wav
```

实测：`frames=20 p50=47.3ms`（源码模式 47.0 ms）、`A1 0.977 / A4 0.925 / N2 0.471` —— 与源码模式一致。

> 打包注意：脚本用 `--collect-all torchvision`（否则运行时 `operator torchvision::nms does not exist`），并排除了 `librosa / numba / llvmlite / polars / matplotlib / pandas`（省约 300 MB）。

## 环境

| 项 | 值 |
|---|---|
| 系统 | Windows 11 |
| CPU | Intel Core Ultra 9 275HX (24 线程) |
| 内存 | 63.4 GB |
| GPU | 未使用（本实验全部 CPU 推理，对齐"普通电脑"口径） |
| Python | 3.13.9 |
| torch | 2.14.1+cpu |
| ultralytics | 8.4.183 |

> 系统自带的 Python 3.14 太新，torch 轮子尚未覆盖，必须用 3.11–3.13。本仓库使用项目内 `.venv`。

## 安装

```powershell
C:\Users\Lenovo\anaconda3\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1+cpu torchvision==0.29.1+cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 数据

> 下表文件**不在仓库中**（约 110 MB），执行 `python scripts/fetch_assets.py` 后恢复；
> 变体视频与 wav 由脚本二次生成。

| 文件 | 来源 | 规格 | 说明 |
|---|---|---|---|
| `data/videos/V1_feeder_slovakia.webm` | Wikimedia Commons, [Bird feeder in the mountains of Slovakia](https://commons.wikimedia.org/wiki/File:Bird_feeder_in_the_mountains_of_Slovakia.webm) | 1280×720 / 29.97fps / 103s | 主测试集，喂食器近景，含蓝山雀、苍头燕雀 |
| `data/videos/V2_koolmees_feeders.webm` | Wikimedia Commons, [Koolmees op vogelfeeders](https://commons.wikimedia.org/wiki/File:Koolmees_op_vogelfeeders-4961804.webm) | 720×576 / 25fps / 160s | 第二个场景，用于交叉验证结论 |
| `data/videos/variants/*.mp4` | 由 `make_variants.py` 生成 | 同源 300 帧 | 距离/低光/模糊/遮挡 4 种受控退化 |
| `data/audio/[A-N]*` | Wikimedia Commons（xeno-canto 授权录音 / 街道噪声 / 朗读） | 下载原文件 | 5 段鸟鸣 + 2 段真实噪声 |
| `data/audio/wav/*.wav` | 由 `prepare_audio.py` 生成 | 48 kHz 单声道 10 s | 能量最高段、峰值归一 0.7；另含合成风噪 N3 |

模型权重：`models/yolo11n.pt`（Ultralytics 官方）。做参照用的 `models/yolo11x.pt`（110 MB）由脚本下载（可选）。
音频模型：`models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite`（49 MB，CC BY-NC-SA 4.0）+ 6522 类标签文件。

许可提示：YOLO11 为 **AGPL-3.0**、BirdNET 为 **CC BY-NC-SA 4.0**（禁止商用），详见 [NOTICE.md](../NOTICE.md)。

## 一条命令复现（验收项）

```powershell
.\.venv\Scripts\python.exe experiments\run_visual_baseline.py `
  --source data\videos\V1_feeder_slovakia.webm `
  --model models\yolo11n.pt --imgsz 640 --conf 0.25 --tracker bytetrack `
  --cls-model resnet50 --max-frames 300 `
  --out results\V1\yolo11n_640.mp4 `
  --json results\V1\yolo11n_640.json `
  --csv results\V1\yolo11n_640_frames.csv
```

输出：带框/带候选物种的 mp4、逐帧逐框 CSV、含设备与延迟分位数的 JSON。
JSON 里自带 `device_info`（CPU 型号、内存、torch/ultralytics/cv2 版本、线程数），换机器跑也能对得上。

音频（验收项：一条命令跑完 5 段 + 3 段负样本）：

```powershell
.\.venv\Scripts\python.exe experiments\run_audio_baseline.py --all `
  --window 3.0 --hop 1.5 --topk 5 --json results\audio\all_3s.json
```

输出：每段的 top-5 候选与置信度、逐窗延迟、命中排名（top-1/top-3）。

## 其它脚本

| 脚本 | 用途 |
|---|---|
| `experiments/make_variants.py` | 由同一段视频生成 tiny/dark/blur/occlude 受控退化版本 |
| `experiments/eval_detection.py` | 以更强模型为参照算分尺寸箱召回（`--ref-transform` 支持缩放平移后的变体） |
| `experiments/inspect_frame.py` | 把参照框与候选框画在同一帧上，出报告用对比图 |
| `experiments/summarize.py` | 扫描 `results/**/*.json` 生成 `results/summary.md` |
| `experiments/prepare_audio.py` | 音频解码/重采样/截取 → 48 kHz wav + `labels.csv` |
| `experiments/birdnet_runtime.py` | BirdNET v2.4 的 LiteRT 运行时（不依赖 birdnetlib/ffmpeg 链路） |
| `experiments/run_audio_baseline.py` | 单段或全部音频跑 BirdNET，输出 top-k + 延迟 |
| `experiments/audio_sweep.py` | 窗长扫描 / 噪声注入 / 负样本误报 三组实验 |

```powershell
# 参照（pseudo-GT）
.\.venv\Scripts\python.exe experiments\run_visual_baseline.py --source data\videos\V1_feeder_slovakia.webm --model models\yolo11x.pt --imgsz 1280 --max-frames 300 --cls-model none --json results\V1\ref_yolo11x_1280.json --csv results\V1\ref_yolo11x_1280_frames.csv --out results\V1\ref_yolo11x_1280.mp4

# 退化变体
.\.venv\Scripts\python.exe experiments\make_variants.py --source data\videos\V1_feeder_slovakia.webm --out-dir data\videos\variants --frames 300 --variants tiny,dark,blur,occlude --ref-csv results\V1\ref_yolo11x_1280_frames.csv

# 召回评测
.\.venv\Scripts\python.exe experiments\eval_detection.py --ref results\V1\ref_yolo11x_1280_frames.csv --pred results\V1\yolo11n_640_frames.csv --label "n@640 clean"

# 汇总
.\.venv\Scripts\python.exe experiments\summarize.py --root results --out results\summary.md --species-csv results\V1\yolo11n_640_frames.csv

# 音频：转换 → 全量推理 → 三组实验
.\.venv\Scripts\python.exe experiments\prepare_audio.py
.\.venv\Scripts\python.exe experiments\run_audio_baseline.py --all --json results\audio\all_3s.json
.\.venv\Scripts\python.exe experiments\audio_sweep.py --out results\audio
```

## 仓库结构

```
.
├─ README.md                   团队说明（本文件为 docs\识别技术预研-README.md）
├─ NOTICE.md                   第三方模型/素材许可（必读）
├─ requirements.txt
├─ run_gui.bat                 启动测试台（源码模式）
├─ build_exe.ps1               打包便携版 exe
├─ app/
│  ├─ gui.py                   Tkinter 测试台（视频 / 屏幕区域 / 音频 / 验收清单）
│  ├─ engines.py               视觉与音频推理引擎
│  └─ paths.py                 源码模式与 PyInstaller 模式的路径/缓存解析
├─ experiments/
│  ├─ run_visual_baseline.py   检测 + 跟踪 + 物种候选（一条命令）
│  ├─ make_variants.py         生成 tiny/dark/blur/occlude 退化视频
│  ├─ eval_detection.py        以强模型为参照的分尺寸箱召回
│  ├─ inspect_frame.py         单帧叠加参照框/候选框，出报告图
│  ├─ summarize.py             汇总所有 JSON → summary.md
│  ├─ run_audio_baseline.py    BirdNET 推理（单段/全量）
│  ├─ audio_sweep.py           窗长 / 噪声 / 负样本三组实验
│  ├─ prepare_audio.py         解码重采样 → 48 kHz wav
│  ├─ birdnet_runtime.py       BirdNET 的 LiteRT 运行时
│  ├─ audio_lib.py             分窗、SNR 混音、命中判定
│  ├─ common.py                ASCII 路径、设备信息、分位数统计
│  └─ species_classifier.py    ImageNet-59 鸟类分类头（临时方案）
├─ scripts/
│  └─ fetch_assets.py          下载模型与素材（git 中不含大文件）
├─ docs/                       实现文档 / 验收报告 / 结论 / 清单
├─ results/                    小体积结果（JSON/CSV/JPG/MD）；mp4 与 gui 输出不入库
├─ data/                       目录占位；原始素材由 fetch_assets.py 恢复
└─ models/                     目录占位；权重由 fetch_assets.py 恢复
```

**未纳入版本控制的文件**（见 `.gitignore`）：`.venv/`、`dist/`、`build/`、
`models/*.pt`、`models/birdnet/*.tflite`、`models/torch_hub/`、
`data/videos/*.webm`、`data/audio/*.ogg|mp3`、`data/audio/wav/`、
`results/**/*.mp4`、`results/gui/`。

## 已知限制与许可

- 所有数字来自**单机 CPU**环境，换机器请按 [implementation-spec.md](implementation-spec.md) §6.3 的允许波动核对。
- 视觉召回是**相对参照（pseudo-GT）**，不是绝对精度；物种候选来自 ImageNet-59 词表，不是真实物种。
- **YOLO11 为 AGPL-3.0，BirdNET 为 CC BY-NC-SA 4.0（禁止商用）**，本项目代码许可证尚未确定；详见 [NOTICE.md](../NOTICE.md)。

## 已踩到的坑

1. **中文路径**：`cv2.VideoCapture`/`VideoWriter` 在 `d:\作业\软工\...` 下会静默失败（`isOpened()==False`，无报错）。`common.py` 统一把含非 ASCII 的路径映射到 `%TEMP%\birdlab\` 下的 ASCII 副本，写完再搬回。
2. **不要用带标注框的示例视频**：Ultralytics 的 `birds-track-compressed.mp4` 画面里已经烧进了检测框，会让后处理"看起来能用"。素材必须是干净画面。
3. **torch 线程数**：默认 8，实测 24 线程不比 8 快，反而 p95 抖动更大。
4. **窗口化延迟**：`p50` 很漂亮不代表能用，本实验一律同时记录 `p95`；物种分类会让 p95 从 27ms 涨到 57ms。
5. **BirdNET 与 birdnetlib**：官方 `birdnetlib` 在 Windows + Python 3.13 上装好也 import 不了（`pydub` 依赖已移除的 `audioop`、还要外部 ffmpeg），且其 TFLite 加载器同样被中文路径卡住。改为直接用 LiteRT 读模型字节（`model_content=`），并用 `imageio-ffmpeg` 解 opus/ogg。
6. **BirdNET 输入长度是硬约束**：`144000` 样本（3 s），**不支持动态 reshape**（0.5 s 输入会在图内 `CONCATENATION` 维度不匹配）。短音频只能补零；这是"0.5 s 不可靠"的根因之一。
