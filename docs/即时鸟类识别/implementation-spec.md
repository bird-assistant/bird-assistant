# 观鸟助手 · 技术预研实现文档（第 1 周）

> **这份文档的用途**：让验收人不需要读代码，就能知道「用了什么模型、怎么测的、结果怎么判定、自己怎么复现」。
> 结论的解读见 [visual-findings.md](visual-findings.md) / [audio-findings.md](audio-findings.md)，逐条验收见 [report.md](report.md)。
> 全部数字来自本机单一环境（见 §6），CPU-only，无 GPU 参与。

---

## 目录

1. [范围与目标](#1-范围与目标)
2. [系统方案](#2-系统方案)
3. [模型清单](#3-模型清单)
4. [数据与真值](#4-数据与真值)
5. [测试方法](#5-测试方法)
6. [运行环境与复现](#6-运行环境与复现)
7. [结果汇总](#7-结果汇总)
8. [验收清单（逐条可执行）](#8-验收清单逐条可执行)
9. [已知限制与风险](#9-已知限制与风险)
10. [下一阶段计划](#10-下一阶段计划)
11. [附录](#11-附录)

---

## 1. 范围与目标

### 1.1 本周要回答的两个问题

| # | 阶段目标 | 本周只做到 |
|---|---|---|
| 视觉 | 摄像头中快速发现鸟并给出候选物种 | 用现成模型跑通「检测 → 跟踪 → 物种候选」，量化速度与失败边界 |
| 音频 | 从麦克风/录音快速返回可能鸟种 | 用现成 BirdNET 跑通「录音 → top-k 候选」，量化窗长、噪声、延迟 |

### 1.2 明确不做

- 不训练/微调任何模型（本轮只做推理评测；「要不要微调」由数据判定）
- 不做小程序端，不做 UI
- 不做多鸟混鸣、夜间/红外的专门建模
- 音频只用公开录音，不采野外实录

### 1.3 结论速览（详见第 7 节）

| 环节 | 结论 |
|---|---|
| 视觉检测 | 可直接用（yolo11n@640，24 ms p50，≥64px 召回 0.88） |
| 视觉跟踪 | 可直接用（ByteTrack，停留个体连续 93 帧同 ID） |
| 视觉物种 | 不可用，需换词表（ImageNet-59 无目标物种） |
| 音频识别 | 可用，先服务端（5/5 top-1，17 ms/窗，但车流噪声有 0.47 误报） |

---

## 2. 系统方案

### 2.1 视觉流水线（为什么是两段式）

```
视频帧 / 摄像头帧
   │
   ├─(1) 检测：只判 "bird"（COCO class 14）           yolo11n, imgsz=640, conf=0.25
   │        └─ 输出 boxes + conf
   │
   ├─(2) 跟踪：跨帧关联，得到 track_id                 ByteTrack（track_buffer=30 帧）
   │        └─ 输出 (track_id, box, conf) 序列
   │
   ├─(3) 裁剪：bbox 外扩 15%，短边 <32px 直接跳过
   │
   ├─(4) 物种：ImageNet backbone 限制到 59 个鸟类类    ResNet50 / EfficientNet-B0（本轮临时方案）
   │        └─ 输出每帧 top-5
   │
   └─(5) 聚合：同一 track 内对每类概率求和后归一，得到该个体的候选列表
```

**为什么两段式**：检测只要回答「是不是鸟」，用 COCO 的 bird 类就够；物种必须看**裁剪后的细节**。
端到端物种检测既没有现成权重，也无法在小目标上保证精度，第一周不碰。

**为什么物种是临时方案**：ImageNet 只有 59 个鸟类类别，不覆盖蓝山雀等目标物种。
这一段的目的是验证「裁剪 → 分类 → 时序聚合」这条**链路和成本**，不是验证识别率。

### 2.2 音频流水线

```
录音（端侧只做 VAD 触发）
   │  48 kHz / 单声道 / 1–3 s
   ├─(1) 补零/截断到 144000 样本（模型硬约束）
   ├─(2) BirdNET v2.4 → 6522 维 logits → flat sigmoid
   ├─(3) top-k 候选 + 置信度
   └─(4) 多窗聚合：窗长 3 s、步进 1.5 s，取每类跨窗最大值
```

**为什么不做流式逐帧**：模型输入被固定为 3 s（实测不支持动态 reshape，见 §9-R3），
所以最小延迟单位是「3 s 音频 + 18 ms 推理」，产品上应表述为「录完即出」而不是「实时逐帧」。

### 2.3 代码模块职责

| 文件 | 职责 | 关键函数 |
|---|---|---|
| `experiments/common.py` | 非 ASCII 路径转 ASCII 副本、设备信息、分位数统计、视频读写 | `to_ascii_input` / `device_info` / `summarize` |
| `experiments/run_visual_baseline.py` | 视觉主流程（检测+跟踪+物种+写视频/CSV/JSON） | `main` |
| `experiments/species_classifier.py` | ImageNet-59 鸟类分类头 | `ImageNetBirdClassifier.predict` |
| `experiments/make_variants.py` | 生成距离/低光/模糊/遮挡四种退化视频 | `apply_tiny/dark/occlude` |
| `experiments/eval_detection.py` | 相对参照的分尺寸箱召回 | `main` |
| `experiments/inspect_frame.py` | 单帧叠加参照框与候选框，出报告图 | `main` |
| `experiments/summarize.py` | 汇总所有 JSON → 一张 markdown 表 | `main` |
| `experiments/birdnet_runtime.py` | BirdNET 的 LiteRT 运行时（不依赖 birdnetlib/ffmpeg） | `BirdNet.predict` |
| `experiments/audio_lib.py` | 分窗、SNR 混音、命中判定 | `analyze` / `mix_at_snr` / `hit_rank` |
| `experiments/prepare_audio.py` | 解码/重采样/截取 → 48 kHz wav + `labels.csv` | `decode_48k_mono` |
| `experiments/run_audio_baseline.py` | 单段/全量音频推理，输出 top-k + 延迟 | `run_one` |
| `experiments/audio_sweep.py` | 窗长 / 噪声 / 负样本 三组实验 | `main` |
| `app/engines.py` | GUI 后端：单帧视觉推理、视频/屏幕源、音频解码与分析 | `VisualEngine.infer` / `ScreenSource.read` / `AudioEngine.analyze` |
| `app/gui.py` | Tkinter 测试台（视频文件 / 屏幕区域 / 音频 / 验收清单） | `BirdLabApp` |

---

## 3. 模型清单

### 3.1 视觉检测：YOLO11n

| 项 | 值 |
|---|---|
| 参数量 / 体积 | 2.6 M / **5.4 MB** |
| 来源 | Ultralytics 官方发布（`github.com/ultralytics/assets` release v8.4.0） |
| 训练数据 | COCO（80 类），只用其中的 `bird`（class id **14**） |
| 输入 | `imgsz=640`（letterbox，保持长宽比），BGR→RGB，归一化到 0-1 |
| 输出 | 每帧 N×(x1,y1,x2,y2,conf,cls)，NMS IoU=0.5 |
| 关键参数 | `conf=0.25`、`iou=0.5`、`classes=[14]`、`max_det=300`（默认） |
| 许可 | **AGPL-3.0** ⚠️ 商用需换许可或购买（见 §9-R1） |
| 为什么选它 | 唯一能在**普通 CPU**上跑进 20 ms 级的成熟检测器；n 版是精度/速度折中点 |
| 参照模型 | yolo11x（109.3 MB，`imgsz=1280`，832 ms/帧）——只做离线伪真值，不进产品 |

### 3.2 跟踪：ByteTrack

| 项 | 值 |
|---|---|
| 实现 | Ultralytics 内置 `bytetrack.yaml`（配置随包发布） |
| 关键参数 | `track_high_thresh=0.25`、`track_low_thresh=0.1`、`new_track_thresh=0.25`、**`track_buffer=30` 帧**、`match_thresh=0.8`、`fuse_score=True` |
| 需要的附加依赖 | `lap`（线性分配，0.5.13） |
| 为什么选它 | 无需额外权重、纯运动+IoU 关联、对静止/慢速目标稳定；BoT-SORT 需要 ReID 权重，本轮不需要 |

### 3.3 视觉物种（临时方案）：ImageNet backbone

| 项 | 值 |
|---|---|
| 主选 | torchvision `resnet50`（IMAGENET1K_V2，**97.8 MB**） |
| 备选 | torchvision `efficientnet_b0`（IMAGENET1K_V1，**20.5 MB**） |
| 预处理 | 短边 resize 256 → center crop 224 → ImageNet 均值方差归一化 |
| 词表 | 1000 类中筛出 **59 个鸟类类别**（`IMAGENET_BIRD_NAMES`，启动时校验，缺一即报错） |
| 输出 | 59 类 softmax 的 top-5 |
| ⚠️ 口径问题 | 在 59 类上**重新归一化**，概率偏高（绝对置信度不可用于阈值，只能横向比较） |
| 为什么选它 | 无需下载额外权重（torch 官方源可直连）、CPU 上 26 ms、能验证「裁剪→分类→时序聚合」链路 |
| 已知缺陷 | 词表不含蓝山雀/苍头燕雀等目标物种，top-1 会给出同科近缘（goldfinch / brambling） |

### 3.4 音频：BirdNET v2.4

| 项 | 值 |
|---|---|
| 文件 | `BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite`，**49.3 MB** |
| 类别 | **6522** 个标签，格式 `Scientific name_Common name`（含 `Human vocal` 等非鸟标签） |
| 输入 | **固定 `[1, 144000]` float32**（48 kHz × 3 s），单声道裸波形，无梅尔前置 |
| 输出 | `[1, 6522]` logits → `flat_sigmoid(sensitivity=1.0)` → 每类 0–1 |
| 运行时 | `ai-edge-litert` 2.3.0 + XNNPACK，`num_threads=4`，CPU |
| 许可 | **CC BY-NC-SA 4.0** ⚠️ 禁止商用（见 §9-R2） |
| 为什么选它 | 生态最成熟、体积可控、给的是完整类别分布（可直接做多候选） |
| 为什么不用 `birdnetlib` | 在 Windows + Python 3.13 上 import 即失败（`pydub`→`audioop` 已移除；需外部 ffmpeg；TFLite 加载器还被中文路径卡住）。改为直接读模型字节加载 |

---

## 4. 数据与真值

### 4.1 视觉数据

| 编号 | 来源 | 规格 | 用途 |
|---|---|---|---|
| V1 | Wikimedia Commons《Bird feeder in the mountains of Slovakia》 | 1280×720 / 29.97 fps / 103 s / 3093 帧 | 主测试集（蓝山雀、苍头燕雀，近距+中距） |
| V2 | Commons《Koolmees op vogelfeeders》 | 720×576 / 25 fps / 160 s | 交叉验证（不同场景/不同设备） |
| V1-* | `make_variants.py` 生成 | 同源前 300 帧 | 受控退化（距离/低光/模糊/遮挡） |

> **被弃用的素材**：Ultralytics 官方 `birds-track-compressed.mp4` 画面里已烧进检测框，
> 会让后处理「看起来能用」，指标虚高 —— 已删除，仅记录为教训。

### 4.2 音频数据

| 编号 | 内容 | 真值 | 来源 | 许可 |
|---|---|---|---|---|
| A1 | 乌鸫鸣唱 | *Turdus merula* | Commons / xeno-canto XC125792 | CC（随 xeno-canto 记录） |
| A2 | 大山雀 | *Parus major* | XC129643 | 同上 |
| A3 | 蓝山雀 | *Cyanistes caeruleus* | XC131316 | 同上 |
| A4 | 大杜鹃 | *Cuculus canorus* | XC457076 | 同上 |
| A5 | 苍头燕雀 | *Fringilla coelebs* | XC489277 | 同上 |
| N1 | 英语朗读 | 无鸟 | Commons《Watt》朗读 | CC BY-SA |
| N2 | 城市街道噪声 | 无鸟 | Commons `Sunday in the city street noise1` | CC |
| N3 | 风噪（**合成** 1/f 粉红噪声） | 无鸟 | 本项目生成 | — |

预处理（`prepare_audio.py`）：ffmpeg 解码 → 48 kHz 单声道 → 取 10 s **能量最高**窗口（避免开场静音）→ 峰值归一到 0.7 → PCM16 wav。

### 4.3 真值（GT）策略 —— 必须知道的三个口径

1. **视觉没有人工标注**。所有召回都是「相对 yolo11x@1280 的参照召回」（pseudo-GT）。
   人工只抽检了 3 帧（见 `results/frames/`）确认参照框质量。
   → 用于**横向比较**（640 vs 1280、干净 vs 退化）可靠；作为**绝对精度**不可靠。
2. **物种没有逐帧标注**。评价方式是「聚合 top-k 里有没有真实物种」，真实物种由录音/视频本身确定。
3. **音频真值来自录音元数据**（xeno-canto 记录），不是听辨标注；可能包含次要物种的串音。

### 4.4 退化变体怎么造的（可复现）

| 变体 | 变换 | 参数 | 模拟的现实 |
|---|---|---|---|
| `tiny` | 画面缩到 0.5 后居中贴到同尺寸黑画布 | `scale=0.5`，偏移 `(320,180)` | 鸟距离翻倍（鸟的像素尺寸减半，不引入重采样模糊） |
| `dark` | 亮度 ×0.35 + 高斯噪声 | `gain=0.35, sigma=8` | 傍晚/阴影 |
| `blur` | 线性运动模糊 | 21 px 核，旋转 25° | 鸟或镜头移动 |
| `occlude` | 在参照框区域画半透明枝条 | 覆盖框面积 60%，3 条线 | 枝叶遮挡 |

`tiny` 变体的坐标发生了仿射变换，**评测时用 `--ref-transform "0.5,0.5,320,180"` 同步变换参照框**，否则会得到 0 召回的假结论（本轮踩过）。

---

## 5. 测试方法

### 5.1 指标定义

| 指标 | 公式/口径 | 说明 |
|---|---|---|
| IoU | `area(∩)/area(∪)` | 匹配阈值默认 0.5，另跑 0.3 / 0.1 做敏感性 |
| Recall@IoUτ（总） | `匹配上的参照框数 / 参照框总数` | 逐帧贪心匹配：按候选框 conf 降序，每个参照框取最大 IoU 的未用候选 |
| Recall@IoUτ（分箱） | 同上，限定在该尺寸箱 | 尺寸取**参照框**长边，箱：`<32 / 32–64 / 64–128 / ≥128 px` |
| 误检率（相对参照） | `(候选框数 − 匹配数) / 候选框数` | 参照漏检会把它算高，故只能横向看 |
| 帧命中率 | `有≥1 个框的帧数 / 处理帧数` | 反映「有没有鸟」的可用性 |
| ID 分配率 | `带 track_id 的框 / 全部框` | 恒为 1.0（ByteTrack 必给 ID），主要用于排除实现错误 |
| track 长度 | 同一 ID 出现的帧数、`span = last−first+1` | 长 track 稳定 = 跟踪可用 |
| top-k 命中 | 期望物种在聚合 top-k 中的**排名**（1 起）；不在 top-k 内记 `None` | **排名只在 k 内可判定**，不是全局排名 |
| 单窗延迟 | `perf_counter` 包住一次 `invoke` | 不含解码；解码单独记 `load_ms` |
| 端到端延迟 | 读帧 → 推理 → 后处理 → 画框 → 写视频 | 视觉线用；**含画框写盘，偏保守** |
| 实时比 | `处理帧率 / 源帧率` | 1.0 = 刚好实时 |
| 分位数 | `numpy.percentile(values, q)`，线性插值 | 一律同时报 p50 与 **p95** |
| SNR 混音 | 噪声按 `sqrt(P_sig / (P_noise·10^(SNR/10)))` 缩放后相加，峰值 >0.99 时整体归一并记录 | `SNR = 10·log10(P_sig/P_noise)` |

### 5.2 实验矩阵

**视觉（V1 前 300 帧 = 10 s，V2 前 300 帧）**

| 变量 | 取值 | 目的 |
|---|---|---|
| 输入分辨率 | 640 / 1280 | 速度-精度权衡 |
| 模型规模 | n（产品候选）/ x（参照） | 质量上界与速度地板 |
| 分类头 | 无 / EfficientNet-B0 / ResNet50 | 第二段成本 |
| 退化条件 | clean / tiny / dark / blur / occlude | 失败边界 |
| 匹配阈值 | IoU 0.5 / 0.3 / 0.1 | 区分「没检到」与「框不准」 |

**音频（5 段鸟鸣 × 3 类噪声）**

| 变量 | 取值 | 目的 |
|---|---|---|
| 窗长 | 0.5 / 1 / 2 / 3 s（不足补零） | 最短可用音频 |
| 噪声类型 | 人声 / 车流 / 风噪 | 环境鲁棒性 |
| SNR | 20 / 10 / 5 / 0 dB | 退化曲线 |
| 负样本 | 人声 / 车流 / 风噪（无鸟） | 误报率 |

### 5.3 测量口径（容易踩坑的三条）

1. **warmup**：视觉默认丢弃前 5 帧（模型首次分配/编译），音频的首次 `invoke` 也会偏高。
2. **p95 必报**：p50 好看不代表能用。加 ResNet50 后 p50 51 ms、p95 57 ms；变体运行偶发 25 ms 的音频窗同理。
3. **线程数固定**：视觉 `torch` 默认 8 线程；音频 `num_threads=4`。换线程数会改变结论，必须写进记录。

### 5.4 判定阈值（决策门）

| 环节 | 通过线 | 实测 | 结论 |
|---|---|---|---|
| 视觉检测 | ≥64px 召回 ≥0.85 且 p95 ≤50 ms | 0.88 / 27 ms | ✅ 直接用 |
| 视觉跟踪 | ID 分配率 ≥0.95 且存在 ≥30 帧长 track | 1.00 / 93 帧 | ✅ 直接用 |
| 视觉物种 | top-3 命中 ≥0.7（需专用词表） | 词表不覆盖，无法达标 | ❌ 换词表 |
| 音频识别 | top-1 ≥0.8（≥1 s 干净音频） | 5/5，≥1 s 全对 | ✅ 可用 |
| 音频延迟 | 单窗 p95 ≤100 ms | 25 ms | ✅ 可用 |
| 音频误报 | 负样本 @阈值 ≤5% | 0.25 阈值 2/3 误报；0.5 阈值 0/3 | ⚠️ 阈值取 0.5 + 多窗确认 |

---

## 6. 运行环境与复现

### 6.1 环境（验收时请记录你自己的环境）

| 项 | 值 |
|---|---|
| 机器 | Intel Core Ultra 9 275HX（24 线程）/ 63.4 GB / Windows 11 |
| GPU | 未使用（`torch.cuda.is_available()=False`，装的是 CPU 版 torch） |
| Python | 3.13.9（项目内 `.venv`） |
| 关键版本 | torch 2.14.1+cpu / torchvision 0.29.1+cpu / ultralytics 8.4.183 / opencv 5.0.0 / numpy 2.5.2 / lap 0.5.13 / ai-edge-litert 2.3.0 / soundfile 0.14.0 / scipy 1.18.1 |

> 系统自带的 Python 3.14 没有对应 torch 轮子，**必须用 3.11–3.13**。

### 6.2 从零复现（4 步）

```powershell
# 1) 环境
C:\Users\Lenovo\anaconda3\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1+cpu torchvision==0.29.1+cpu
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2) 视觉：一条命令（约 15 s）
.\.venv\Scripts\python.exe experiments\run_visual_baseline.py `
  --source data\videos\V1_feeder_slovakia.webm `
  --model models\yolo11n.pt --imgsz 640 --conf 0.25 --tracker bytetrack `
  --cls-model resnet50 --max-frames 300 `
  --out results\V1\yolo11n_640.mp4 --json results\V1\yolo11n_640.json `
  --csv results\V1\yolo11n_640_frames.csv

# 3) 音频：一条命令（约 5 s）
.\.venv\Scripts\python.exe experiments\run_audio_baseline.py --all `
  --window 3.0 --hop 1.5 --topk 5 --json results\audio\all_3s.json

# 4) 其余实验（可选，约 3 min）
.\.venv\Scripts\python.exe experiments\run_visual_baseline.py --source data\videos\V1_feeder_slovakia.webm --model models\yolo11x.pt --imgsz 1280 --max-frames 300 --cls-model none --json results\V1\ref_yolo11x_1280.json --csv results\V1\ref_yolo11x_1280_frames.csv --out results\V1\ref_yolo11x_1280.mp4
.\.venv\Scripts\python.exe experiments\make_variants.py --source data\videos\V1_feeder_slovakia.webm --out-dir data\videos\variants --frames 300 --variants tiny,dark,blur,occlude --ref-csv results\V1\ref_yolo11x_1280_frames.csv
.\.venv\Scripts\python.exe experiments\audio_sweep.py --out results\audio
.\.venv\Scripts\python.exe experiments\summarize.py --root results --out results\summary.md --species-csv results\V1\yolo11n_640_frames.csv
```

### 6.3 复现时允许的波动

| 指标 | 预期 | 允许偏差 |
|---|---|---|
| 视觉 p50（n@640+ResNet50） | 51.1 ms | ±10%（进程调度/CPU 频率） |
| 视觉召回（n@640 clean @IoU0.5） | 0.646 | ±0.01（确定性，除非改参数） |
| 音频单窗 p50 | 17–18 ms | ±15% |
| 音频 top-1 | 5/5 | 必须一致（确定性） |

### 6.4 图形界面（测试台）

```powershell
run_gui.bat                       # 双击等价物
.\.venv\Scripts\python.exe app\gui.py
```

无人值守自检（回归用，无需点击）：

```powershell
# 视觉：40 帧，期望 p50 45–55 ms（resnet50）
.\.venv\Scripts\python.exe app\gui.py --selftest-video data\videos\V1_feeder_slovakia.webm --frames 40 --cls resnet50

# 音频：期望 0.977 / 0.925 / 0.471（与 CLI 完全一致）
.\.venv\Scripts\python.exe app\gui.py --selftest-audio data\audio\wav\A1_blackbird.wav,data\audio\wav\A4_cuckoo.wav,data\audio\wav\N2_traffic.wav

# 屏幕采集：抓 8 帧并推理
.\.venv\Scripts\python.exe app\engines.py --screen 200,200,640,360 --cls none
```

界面验收步骤见 [acceptance-checklist.md](acceptance-checklist.md)。

### 6.5 便携版（免安装 Python）

```powershell
powershell -ExecutionPolicy Bypass -File build_exe.ps1    # 约 3-5 分钟
dist\BirdLab\BirdLab.exe
```

| 项 | 值 |
|---|---|
| 产物 | `dist\BirdLab\`（约 1.0 GB，onedir） |
| 依赖 | 无（torch / torchvision / cv2 / litert / ffmpeg 全部内置） |
| 模型位置 | `models\`（与 exe 同级，可替换） |
| 结果位置 | `results\gui\`（与 exe 同级） |
| 自检 | `BirdLab.exe --selftest-video data\videos\V1_feeder_slovakia.webm --frames 20 --cls resnet50`，结果写入 `results\gui\selftest.log` |

打包要点（踩过的坑）：

1. 必须 `--collect-all torchvision`，否则运行时 `operator torchvision::nms does not exist`（torchvision 的 `_C` 扩展没进去）。
2. `--windowed` 下没有 stdout，自检结果必须落盘（`log_line`）。
3. 排除 `librosa / numba / llvmlite / polars / matplotlib / pandas` 可省约 300 MB；本项目运行时不依赖它们。
4. 数据文件被打进 `_internal\`，而模型放在 exe 同级——`paths.py` 用 `resource_dir()` 与 `app_dir()` 区分两者。

---

## 7. 结果汇总

### 7.1 视觉速度（300 帧，CPU）

| 配置 | 检测 p50 | 分类 p50 | e2e p50 | p95 | 处理帧率 | 实时比 |
|---|---|---|---|---|---|---|
| n@640 检测+跟踪 | 17.6 | — | **24.2** | 27.0 | 32.2 | 1.07 |
| n@640 + EfficientNet-B0 | 17.5 | 11.6 | 35.6 | 39.8 | 30.3 | 1.01 |
| n@640 + ResNet50 | 18.0 | 26.8 | 51.1 | 56.9 | 22.9 | 0.76 |
| n@1280 | 44.2 | — | 52.9 | 57.8 | 16.6 | 0.55 |
| x@1280（参照） | 832 | — | 841 | 906 | 1.2 | 0.04 |

### 7.2 视觉召回（相对 yolo11x@1280）

| 条件 | IoU0.5 | IoU0.3 | ≥128px | 64–128px | 32–64px | 误检率 |
|---|---|---|---|---|---|---|
| 干净 640 | 0.646 | 0.673 | 0.880 | 0.132 | — | 4.1% |
| 干净 1280 | 0.701 | 0.727 | 0.912 | 0.178 | — | 5.0% |
| tiny（距离×2） | 0.587 | 0.633 | — | **0.901** | **0.055** | 7.3% |
| dark | 0.609 | 0.647 | 0.861 | 0.081 | — | 5.8% |
| blur | 0.523 | 0.568 | 0.876 | 0.058 | — | 9.6% |
| occlude | 0.515 | 0.561 | 0.892 | 0.018 | — | 8.2% |

> 读法：干净场景 64–128px 箱的 0.13 主要来自**背景次级鸟**（虚焦/被枝条挡住），不是尺寸效应；
> 受控实验 `tiny` 说明**尺寸效应本身的分界线在 ~64px**（64–128px 召回 0.90，32–64px 崩到 0.06）。

### 7.3 音频

| 窗长 | 0.5 s | 1 s | 2 s | 3 s |
|---|---|---|---|---|
| top-1 | 3/5 | **5/5** | 5/5 | 5/5 |

| 噪声（3 s 窗） | 20 dB | 10 dB | 5 dB | 0 dB | 平均置信度 |
|---|---|---|---|---|---|
| 人声 | 5/5 | 5/5 | 5/5 | 5/5 | 0.954 → 0.695 |
| 车流 | 5/5 | 5/5 | 5/5 | 5/5 | 0.954 → 0.911 |
| 风噪 | 5/5 | 5/5 | 5/5 | 5/5 | 0.954 → 0.582 |

| 负样本 | 最高分 | ≥0.25 误报 | ≥0.5 误报 |
|---|---|---|---|
| 人声 | 0.044（`Human vocal`） | 否 | 否 |
| 车流 | **0.471**（Manx Shearwater） | **是** | 否 |
| 风噪 | **0.253**（Flammulated Owl） | **是** | 否 |

---

## 8. 验收清单（逐条可执行）

### 8.1 视觉（对应阶段目标一的 6 条标准）

| # | 标准 | 怎么验 | 看什么 | 通过标准 |
|---|---|---|---|---|
| V1 | 至少一个测试视频能跑 | 跑 §6.2 第 2 步 | 命令 exit=0，`results/V1/yolo11n_640.mp4` 时长 10 s | 生成 mp4 且 `frames_processed=300` |
| V2 | 输出检测框/候选结果 | 打开 mp4；或看 CSV | 框 + `#trackid` + `goldfinch 0.45` 标签；CSV 有 `species_topk` 列 | 每行含 track_id / 框坐标 / top-5 |
| V3 | 记录设备/模型/分辨率/帧率/延迟 | 打开 JSON | `device_info.cpu`、`config.*`、`run.fps_processed`、`latency_ms.e2e_ms.p50/p95` | 字段齐全且与 §7.1 同量级（±10%） |
| V4 | 成功与失败样例 | 打开 4 张 jpg | `success_bluetit_f030.jpg`、`success_chaffinch_f250.jpg`、`fail_tiny_f150.jpg`、`fail_occluded_f227.jpg` | 失败图能看出「为什么失败」（候选框缺失/偏移） |
| V5 | 明确直接用/微调/换方案 | 读 [visual-findings.md](visual-findings.md) §8 | 分环节结论表 | 检测/跟踪=直接用，物种=换词表，小目标=方案层 |
| V6 | 一条可复现命令 | 见 §6.2 第 2 步 | — | 换机器照抄能跑出同量级数字 |

### 8.2 音频（对应阶段目标二的 5 条标准）

| # | 标准 | 怎么验 | 看什么 | 通过标准 |
|---|---|---|---|---|
| A1 | 至少 5 段音频 | 跑 §6.2 第 3 步 | `data/audio/wav/` 下 5 个 `A*.wav` + 3 个 `N*.wav` | 8 个文件，时长 10 s |
| A2 | 记录预测/延迟/环境 | 打开 `results/audio/all_3s.json` | `runs[].aggregate_topk`、`runs[].latency_ms`、`device_info` | 每段有 top-5 + p50/p95 + 设备信息 |
| A3 | 复现步骤 | 见 §6.2 第 3 步 | — | 一条命令出 `top-1 5/5` |
| A4 | “实时”能多快 | 读 [audio-findings.md](audio-findings.md) §5 | 3 s 窗 + 1.5 s 步进；单窗 17–18 ms | 口径写清楚（每 1.5 s 出结果 / 录音端到端 1–3 s） |
| A5 | 限制与建议 | 读 [audio-findings.md](audio-findings.md) §7–8 | 5 条限制 + 5 条建议 | 至少覆盖样本偏差、噪声、端侧未测 |

### 8.3 文档自检

- [x] 模型版本、体积、输入输出、关键参数齐全（§3）
- [x] 数据来源、许可、预处理可复现（§4）
- [x] 指标有公式与统计口径（§5.1、§5.3）
- [x] 实验矩阵说明「为什么这么测」（§5.2）
- [x] 判定阈值先定后测（§5.4）
- [x] 一条命令能跑（§6.2，已实测）
- [x] 失败样例有证据图（§8.1 V4）

---

## 9. 已知限制与风险

| # | 风险 | 影响 | 现状/对策 |
|---|---|---|---|
| R1 | **YOLO11 是 AGPL-3.0** | 小程序闭源分发可能触发开源义务 | 立项前必须定：购买 Ultralytics 商业许可 / 换 Apache 系检测器（如 RTMDet、YOLOX）/ 服务端调用 |
| R2 | **BirdNET 是 CC BY-NC-SA 4.0** | **禁止商用** | 商用需替换为自训练模型，或只做非商业版本；本轮仅用于可行性验证 |
| R3 | BirdNET 输入固定 3 s | 无法做 <1 s 的交互；0.5 s 精度崩 | 产品口径改为「录音 1–3 s 后出结果」；探索 FP16/量化版本 |
| R4 | 视觉真值是伪 GT | 绝对值不可引用 | 只做横向比较；正式评测前需人工标注 100–200 帧 |
| R5 | 样本量小（2 段视频 × 10 s、5 段音频） | 不能外推 | 下一阶段补真实场景采集 |
| R6 | 物种分类在 59 类上重归一化 | 置信度偏高 | 仅用于链路验证；换词表时改为全类 softmax + 阈值校准 |
| R7 | 退化变体是合成的 | 与真实远距/夜间有差距 | 结论只写「趋势」，不写绝对精度 |
| R8 | 端侧完全未验证 | 「能否上小程序」仍不确定 | 见 [platform-constraints.md](platform-constraints.md) 的 A/B/C 表，需真机 |
| R9 | 中文路径导致 cv2 静默失败 | 换机器可能「跑不出结果」 | 已在 `common.py` 统一转 ASCII 临时副本；验收时若路径含中文仍应生效 |

---

## 10. 下一阶段计划

| 优先级 | 事项 | 完成标志 |
|---|---|---|
| P0 | 许可决策（AGPL / NC） | 选定商业许可或替代模型，写入立项文档 |
| P0 | 真机 spike（相机帧率、推理引擎、录音 PCM） | [platform-constraints.md](platform-constraints.md) A/B/C 表全部填完 |
| P0 | 视觉物种换词表（iNat2021 / BioCLIP） | top-3 命中 ≥0.7（用同一套 300 帧评测） |
| P1 | 音频 geo filter + VAD + 三窗确认 | 车流负样本误报从 0.471 降到 <0.1 |
| P1 | 人工标注 200 帧，替换伪 GT | 召回从「相对」变「绝对」 |
| P2 | 小目标方案（imgsz 960 + 点选区域二次推理） | 32–64px 箱召回提升可量化 |

---

## 11. 附录

### A. 参数速查

| 场景 | 参数 |
|---|---|
| 视觉默认 | `imgsz=640 conf=0.25 iou=0.5 classes=14 tracker=bytetrack device=cpu warmup=5` |
| 视觉高精度 | `imgsz=1280`（CPU 上 0.55× 实时，仅离线用） |
| 物种裁剪 | bbox 外扩 15%，短边 <32 px 跳过（记录在 `species.skipped_small_crops`） |
| 音频默认 | `window=3.0s hop=1.5s topk=5 sample_rate=48k threads=4 sensitivity=1.0` |

### B. 输出字段说明

**视觉 JSON**（`results/V1/yolo11n_640.json`）

| 字段 | 含义 |
|---|---|
| `meta` | 源视频宽高/fps/帧数/时长 |
| `device_info` | CPU 型号、核心数、内存、python/torch/cv2/ultralytics 版本、线程数、是否有 CUDA |
| `config` | 本次运行的全部参数（可比对） |
| `run.frames_processed / wall_s / fps_processed / realtime_factor` | 吞吐与实时比 |
| `detections.frame_hit_rate / box_side_bins` | 有鸟帧比例、框尺寸分布 |
| `tracking.unique_ids / tracks_ge_30_frames / id_assignment_rate / per_track[]` | 跟踪质量；`per_track[].species_candidates` 是该个体的聚合候选 |
| `species.skipped_small_crops` | 因太小被跳过的裁剪数（衡量小目标损失） |
| `latency_ms.{e2e_ms, proc_ms, model_inference_ms, model_preprocess_ms, model_postprocess_ms, species_ms}` | 各阶段 p50/p95/p99 |

**视觉 CSV**（逐框一行）：`frame, track_id, conf, x1, y1, x2, y2, side_px, species_top1, species_prob, species_topk(JSON)`

**评测 JSON**（`results/eval/*.json`）：`label, iou_threshold, frames_compared, ref_boxes, matched, recall_overall, per_bin{}, pred_boxes, pred_unmatched, false_positive_rate_vs_ref, missed_examples[]`

**音频 JSON**（`results/audio/all_3s.json`）：`runs[].{clip, expected, kind, audio_s, window_s, hop_s, windows, aggregate_topk, hit_rank, hit_top1, hit_top3, latency_ms, per_window[]}`

### C. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `cv2.VideoCapture.isOpened()==False`（无报错） | 路径含中文 | 已在 `common.py` 处理；自写脚本需同样处理 |
| `pickle`/`lap` 缺失 | ByteTrack 需要 `lap` | `pip install lap` |
| `ModuleNotFoundError: audioop` | Python 3.13 移除该模块 | `pip install audioop-lts`（本项目运行时已不依赖 pydub） |
| `XNNPack delegate failed to reshape` | 给 BirdNET feed 了非 3 s 输入 | 补零/截断到 144000 样本 |
| 中文路径下 TFLite 报 `model allocation is null` | LiteRT 用窄字符 fopen | 用 `model_content=` 传字节（本项目做法） |
| `tiny` 变体召回为 0 | 参照框没做坐标变换 | 评测加 `--ref-transform "0.5,0.5,320,180"` |
