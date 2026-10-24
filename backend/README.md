# 观鸟助手视觉识别后端

这是从第 1 周技术预研演进出的可部署服务。它负责实时鸟体检测、会话级跟踪、最佳裁剪选择和可选的 BioCLIP 2 鸟种候选，不包含音频识别与业务数据库。

## 已实现

- FastAPI + OpenAPI；
- `mock` / CPU / CUDA 运行模式；
- YOLO 鸟体检测，模型启动时只加载一次；
- 每个实时会话独立的 ByteTrack 状态，Mock 开发模式使用轻量运动跟踪器；
- 每个会话只保留最新待处理帧，主动丢弃积压旧帧；
- 稳定轨迹、最小目标尺寸与图像质量门控；
- BioCLIP 2 + AviList v2026 全球 11,172 种完整目录的零样本候选；
- 基于任意经纬度和拍摄月份的 GBIF 时空候选集，优先使用离线索引，索引不可用、未覆盖或匹配不足时后台查询并缓存实时 GBIF，准备期间显式回退国家/全球目录；
- 地区和观测次数只选择候选空间，不修改模型相似度，不再使用 `CN` 加分；
- 基于原始余弦相似度和 Top-1/Top-2 间隔的 `unknown` 拒识；
- CUDA 混合精度与按实际权重指纹、revision、特征维度和目录哈希自动失效的文本特征缓存；
- 名录版本、校验和、分页检索 API 与可重复构建脚本；
- HTTP `202` 接收帧，WebSocket 异步推送结果；
- API Key 鉴权、会话所有权隔离、上传前准入、内存预算和帧率限制；
- 健康检查、就绪检查、Prometheus 指标、JSON 日志；
- 优雅关停与自动化接口、会话、跟踪、图片安全和推理管线测试。

物种结果始终称为“候选”。`relative_similarity` 是模型在本次实际候选集合中的相对排序分数，不是识别正确概率，也不会自动成为用户观测记录。低相似度或候选间隔不足时返回 `unknown`，不会强猜物种。

启用实时 GBIF 时，会话创建不预取数据；首次达到分类条件且坐标/月度缓存未命中时，服务排队执行去重的后台查询，并立即用国家或全球候选完成本次分类。后续分类会读取完成的缓存，匹配足够目录物种时才使用当地候选，因此同一会话的早期结果可能是国家/全球范围，之后变为当地范围。后台网络不占用 GPU 推理槽，也不计入 `BIRD_VISION_INFERENCE_TIMEOUT_SECONDS`；GBIF 请求超时仍按每次 HTTP 尝试计算。可关闭实时查询以停止外部坐标传输。

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

脚本会自动缩放图片、通过 `bird-gpu` SSH 别名启动或复用云端服务、建立临时隧道并生成 HTML、CSV 和 JSON 报告。脚本在会话和每个帧请求中都显式传入合肥市中心坐标 `31.8206, 117.2272`，并校验后端回显；这只是测试参数，不是服务运行时的地域默认。实时 GBIF 缓存未就绪时，脚本会按分类刷新周期继续测试，默认最多等待 90 秒，不会把 `live_occurrence_lookup_pending` 的国家/全球回退结果直接当作最终结果。拍摄时间优先读取 EXIF 和文件名，只有文件修改时间时会标为 `unknown` 并禁用月份过滤。整批图片拍摄时间不详时，使用 `./test-cloud-vision.sh --capture-time-precision unknown` 强制使用当地全年候选。其他 SSH 别名、坐标、等待时间或路径可通过 `./test-cloud-vision.sh --help` 查看和覆盖。

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

- [架构与边界](../docs/视觉识别后端/README.md)
- [API 详细协议](../docs/视觉识别后端/API.md)
- [云容器部署与运维](../docs/视觉识别后端/DEPLOYMENT.md)
- [模型、词表与评测规则](../docs/视觉识别后端/MODELS.md)

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
│   ├── evaluate_species.py       已裁剪图片准确率与拒识评测
│   └── evaluate_pipeline.py      检测、跟踪、裁剪、分类全链路评测
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
└── tests/
```
