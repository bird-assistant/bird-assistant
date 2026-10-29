# 观鸟助手识别后端

这是从第 1 周技术预研演进出的可部署服务群，同一个发行包里包含两个独立进程：

| 服务 | 包 | 职责 | 默认端口 | 额外安装 |
|---|---|---|---:|---|
| `bird-vision` | `bird_vision` | 实时鸟体检测、会话级跟踪、BioCLIP 候选 | 8000 | `.[gpu]` |
| `bird-audio` | `bird_audio` | 录音一次性识别：上传校验、解码、48 kHz 单声道、3 s 分窗、BirdNET v2.4、候选聚合与拒识 | 8100 | `.[audio]` |

共享代码在 `bird_common`（应用外壳、鉴权、错误信封、日志、物种目录加载），音频服务与视觉服务
遵循同一套健康检查、请求 ID、错误格式与鉴权规则。

## 视觉服务已实现

- FastAPI + OpenAPI；
- `mock` / CPU / CUDA 运行模式；
- YOLO 鸟体检测，模型启动时只加载一次；可选 1280 高分辨率整图模式用于提升大场景图中的小鸟召回率；
- 每个实时会话独立的 ByteTrack 状态，Mock 开发模式使用轻量运动跟踪器；
- 每个会话只保留最新待处理帧，主动丢弃积压旧帧；
- 稳定轨迹、最小目标尺寸与图像质量门控；
- BioCLIP 2 + AviList v2026 全球 11,172 种完整目录的零样本候选；
- 基于任意经纬度和拍摄月份的 GBIF 时空候选集，优先使用离线索引，索引不可用、未覆盖或匹配不足时后台查询并缓存实时 GBIF；有坐标时准备期间直接使用全球模型；
- GBIF 当地列表拥有严格优先级：当地 Top-1 达到最低相似度即保留当地排名；只有当地 Top-1 低于最低相似度时才使用全球模型；
- 基于原始余弦相似度和 Top-1/Top-2 间隔的 `unknown` 拒识；
- CUDA 混合精度与按实际权重指纹、revision、特征维度和目录哈希自动失效的文本特征缓存；
- 名录版本、校验和、分页检索 API 与可重复构建脚本；
- HTTP `202` 接收帧，WebSocket 异步推送结果；
- API Key 鉴权、会话所有权隔离、上传前准入、内存预算和帧率限制；
- 健康检查、就绪检查、Prometheus 指标、JSON 日志；
- 优雅关停与自动化接口、会话、跟踪、图片安全和推理管线测试。

物种结果始终称为“候选”。`relative_similarity` 是模型在最终采用的当地或全球候选集合中的相对排序分数，不是识别正确概率，也不会自动成为用户观测记录。低相似度或候选间隔不足时返回 `unknown`，不会强猜物种。

启用实时 GBIF 时，实时会话创建后立即预取当前月份窗口；批量历史图片可先调用 `/api/v1/species/occurrence/cache/prepare` 准备实际涉及的月份，再上传图片。查询直接分页读取 GBIF `scientificName` 分面，不再逐个请求物种详情；完成和明确空结果写入 `runtime/gbif-occurrence-cache.sqlite3`，默认保留 30 天、最多 2,048 项，同一区域后续会话和服务重启直接复用。后台网络不占用 GPU 推理槽，也不计入 `BIRD_VISION_INFERENCE_TIMEOUT_SECONDS`。

## 本地开发

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[test]'
cp .env.example .env
pytest
ruff check src tests
bird-vision --host 127.0.0.1 --port 8000
```

默认使用 Mock 检测器和匿名开发模式。打开：

- Swagger UI：`http://127.0.0.1:8000/docs`
- OpenAPI：`http://127.0.0.1:8000/openapi.json`
- 健康检查：`http://127.0.0.1:8000/healthz`
- 全量名录信息：`http://127.0.0.1:8000/api/v1/species/catalog/info`

普通本地开发环境故意不安装体积较大的模型库。如需在无 GPU 电脑上验证真实 OpenCLIP/Ultralytics/ByteTrack 依赖和 CPU 接口兼容性，使用锁定的 CPU 测试环境：

```bash
python -m pip install --only-binary=:all: --require-hashes \
  -r requirements-cpu-test-lock.txt
python -m pip install --no-deps --no-build-isolation -e '.[test,gpu]'
python -m pip check
pytest
```

这可以验证库、跟踪器和接口，但不能代替云端 CUDA 性能、显存和真实权重验收。

## 云 GPU 快速启动

已经完成云端模型和 `.env` 配置后，可以从项目根目录一键使用本地 `image/` 中的图片测试完整 HTTP/WebSocket 链路：

```bash
./test-cloud-vision.sh
```

脚本会先通过 `rsync` 自动同步后端代码，同时保留云端 `.env`、虚拟环境、运行目录、GBIF SQLite 缓存和测试结果；然后通过 `bird-gpu` SSH 别名启动云端服务、建立临时隧道并生成 HTML、CSV 和 JSON 报告。脚本在会话和每个帧请求中显式传入合肥市中心坐标 `31.8206, 117.2272`，并校验后端回显；这只是当前测试图片的默认位置，不是后端地域默认。任意区域首次查询完成后都会写入云端 `runtime/gbif-occurrence-cache.sqlite3`，后续会话及服务重启直接复用。拍摄时间优先读取 EXIF 和文件名，只有文件修改时间时会标为 `unknown` 并禁用月份过滤。整批图片拍摄时间不详时，使用 `./test-cloud-vision.sh --capture-time-precision unknown` 强制使用当地全年候选。其他 SSH 别名、坐标、等待时间或路径可通过 `./test-cloud-vision.sh --help` 查看和覆盖。

不要安装原预研目录里固定为 `+cpu` 的 PyTorch。应保留云镜像已经提供的 CUDA PyTorch：

```bash
cd /root/shared-nvme/bird-assistant/backend
python -m venv /root/venvs/bird-vision --system-site-packages
source /root/venvs/bird-vision/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[gpu]'
python -m pip check
cp .env.example .env
```

`.[gpu]` 会安装 Ultralytics（含 ByteTrack）、OpenCLIP、Hugging Face Hub 等 Python 依赖；模型权重不会打进 pip 包。`--system-site-packages` 用来复用云镜像已提供的 CUDA PyTorch。首次安装后必须验证 `torch.cuda.is_available()` 和 `torchvision.ops.nms`，不能只看 pip 命令成功。

先把审核后的 YOLO 权重放入 `/root/shared-nvme/models/yolo/yolo11n.pt`。再下载 BioCLIP 的不可变快照并生成生产配置所需的 revision/哈希：

```bash
export HF_HOME=/root/shared-nvme/models/huggingface
python scripts/prepare_model_artifacts.py \
  --yolo /root/shared-nvme/models/yolo/yolo11n.pt \
  --output /root/shared-nvme/results/model-artifacts.json
```

配置 `.env` 后先运行：

```bash
python scripts/check_runtime.py --require-gpu \
  --batch-sizes 1 4 8 --iterations 20 --output results/runtime.json
```

再启动单进程服务：

```bash
bird-vision --host 0.0.0.0 --port 8000 --workers 1
```

第一次 GPU 验收后，再用 `scripts/lock_dependencies.py --profile gpu --wheelhouse ...` 生成该 Python/CUDA 平台专用的带哈希锁文件并归档 wheelhouse；无显卡本机不会伪造 GPU 锁。一个 GPU 只能运行一个本服务进程。多进程会重复加载模型、重复占用显存，并破坏会话跟踪的一致性。多 GPU 扩容应采用“一张 GPU 一个进程 + 网关按 session 粘性路由”。

## 文档

- [视觉架构与边界](../docs/视觉识别后端/README.md)
- [视觉 API 详细协议](../docs/视觉识别后端/API.md)
- [云容器部署与运维](../docs/视觉识别后端/DEPLOYMENT.md)
- [模型、词表与评测规则](../docs/视觉识别后端/MODELS.md)
- [音频服务说明](../docs/音频识别后端/README.md)
- [音频 API 与前端联调](../docs/音频识别后端/API.md)
- [音频部署与运维](../docs/音频识别后端/DEPLOYMENT.md)
- [音频模型、标签与分数语义](../docs/音频识别后端/MODELS.md)
- [音频样本验证报告](../docs/音频识别后端/VALIDATION.md) · [验收检查表](../docs/音频识别后端/CHECKLIST.md)
- [本 PR 说明](../docs/PR/音频识别后端.md)

## 音频服务

```bash
python -m pip install -e '.[test]'
python -m pip install -e '.[audio]'        # 真实 BirdNET 引擎需要（mock 不需要）
cp .env.example .env
bird-audio --host 127.0.0.1 --port 8100
```

音频服务默认 `BIRD_AUDIO_ENGINE_BACKEND=mock`，前端可在没有模型的情况下联调接口；真实推理需
把 BirdNET 权重放到 `鸟类识别预研/models/birdnet/` 并设置 `BIRD_AUDIO_ENGINE_BACKEND=birdnet`。
ffmpeg 依次取 `BIRD_AUDIO_FFMPEG_PATH`、系统 PATH、`imageio-ffmpeg` 自带二进制。

真实模型 smoke 与样本验证：

```bash
export BIRD_AUDIO_ENGINE_BACKEND=birdnet
python scripts/prepare_audio_samples.py
python scripts/evaluate_audio.py
bird-audio --port 8100 &
python scripts/smoke_audio_service.py --base-url http://127.0.0.1:8100
```

## 目录

```text
backend/
├── config/catalog/             全量全球目录、中国子集、来源与哈希
├── config/occurrence/          可审计的离线地点/月度出现记录索引（实时 GBIF 作为任意坐标兜底）
├── scripts/
│   ├── build_species_catalog.py  可重复构建名录
│   ├── build_occurrence_profile.py 从 GBIF 构建地点时空索引
│   ├── check_runtime.py          云端模型加载与推理自检
│   ├── prepare_model_artifacts.py 固定模型 revision 与工件哈希
│   ├── prepare_audio_samples.py  生成小程序录音格式样本与 manifest
│   ├── evaluate_audio.py         真实模型的样本验证与阈值扫描
│   ├── smoke_audio_service.py    真实 HTTP 端到端 smoke 与联调证据
│   ├── evaluate_species.py       已裁剪图片准确率与拒识评测
│   └── evaluate_pipeline.py      检测、跟踪、裁剪、分类全链路评测
├── src/bird_common/            共享应用外壳、鉴权、错误、日志、物种目录加载
├── src/bird_vision/
│   ├── api.py                  HTTP / WebSocket 接口
│   ├── app.py                  生命周期、中间件、错误处理
│   ├── auth.py                 API Key 与会话所有权
│   ├── images.py               图片类型、尺寸与解码保护
│   ├── occurrence.py           任意坐标 GBIF 查询、缓存、地点覆盖与索引校验
│   ├── sessions.py             最新帧队列、会话、背压与清理
│   ├── tracking.py             会话隔离的跟踪实现
│   └── inference/
│       ├── detectors.py        Mock / YOLO 检测器
│       ├── species.py          Disabled / Mock / BioCLIP 2
│       └── pipeline.py         检测、跟踪、裁剪、分类与输出
├── src/bird_audio/
│   ├── audio.py                上传暂存、容器嗅探、ffmpeg 解码、临时文件清理
│   ├── windows.py              3 s 分窗、补零、确认窗数
│   ├── labels.py               标签解析、非鸟类过滤、物种目录对齐
│   ├── analyzer.py             聚合、排序、拒识（纯函数）
│   ├── engine.py               BirdNET LiteRT 引擎 / mock 引擎 / 资产校验
│   ├── service.py              准入、并发、超时、取消与报告
│   └── app.py                  API、生命周期与就绪检查
└── tests/
```
