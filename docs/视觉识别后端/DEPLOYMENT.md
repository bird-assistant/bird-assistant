# 云 GPU 部署与运维

## 1. 部署原则

- 本地完成代码和 Mock/CPU 测试；
- CUDA、真实权重、性能和显存只能在云 GPU 上验收；
- 云容器使用平台提供的 CUDA PyTorch，不安装预研目录的 `+cpu` PyTorch；
- 代码、模型、目录、结果放共享存储；
- 一个 GPU 运行一个服务进程；
- 正式流量先经过公网业务网关；
- GPU 关机时由业务网关降级到在线识别 API 或明确返回暂不可用。

## 2. 首次安全检查

如果登录密码曾出现在截图、聊天、Issue 或日志中，必须先在平台重置。优先在平台添加 SSH 公钥，长期密码和平台 API Key 不写入仓库。

SSH 用户名包含 `@` 时使用：

```bash
ssh -p <port> -l '<complete-username>' <host>
```

不要把平台控制面的开关机 Key 放进微信小程序或视觉服务容器。自动开关机由公网业务服务器负责。

## 3. 验证 GPU 镜像

```bash
nvidia-smi

python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)"
```

必须确认 `torch.cuda.is_available()` 为 `True`。如果为 `False`，先修复镜像/驱动，不要继续安装模型依赖。

## 4. 持久化目录

以平台实际显示的共享挂载点为准。本项目当前示例：

```text
/root/shared-nvme/
├── bird-assistant/        Git 工作区
├── models/
│   ├── yolo/
│   └── huggingface/
├── catalogs/
├── bird-assistant/backend/runtime/
│   └── gbif-occurrence-cache.sqlite3
└── results/
```

环境变量：

```bash
export HF_HOME=/root/shared-nvme/models/huggingface
export TORCH_HOME=/root/shared-nvme/models/torch
```

虚拟环境可以放系统盘并根据依赖重建；模型、鸟种目录、评测集、结果和 GBIF 区域缓存必须放共享存储并另做备份。代码同步应排除 `backend/runtime/`，以免覆盖云端已经积累的区域缓存。

## 5. 通过 SSH 同步代码

先在本机 `~/.ssh/config` 给云容器建立别名，可避免带 `@` 的平台用户名被 SSH 误解：

```sshconfig
Host bird-gpu
    HostName <SSH 主机>
    Port <SSH 端口>
    User <完整平台用户名>
    IdentityFile ~/.ssh/id_ed25519
```

确认 `ssh bird-gpu` 可登录后，推荐从代码托管平台在云端 `git clone/pull`。本地还没提交的联调代码可用：

```bash
rsync -rz --links \
  --exclude .venv --exclude .env \
  --exclude runtime --exclude results \
  backend/ bird-gpu:/root/shared-nvme/bird-assistant/backend/
```

这里不使用 `-a`：部分云平台共享盘不允许普通 SSH 用户执行 `chown` 或保留本地权限，归档模式会因此报 `Operation not permitted`。如果需要同步整个仓库，也应使用 `-rz --links` 并额外排除本地图片、虚拟环境、私有配置和运行结果。

不同步本地 `.venv` 或 `.env`：虚拟环境包含平台相关的 Torch/CUDA 二进制，私有配置应在云端单独生成。

## 6. 安装

第一次在新的 GPU 镜像上 bootstrap（尚未生成该平台锁文件时）：

```bash
cd /root/shared-nvme/bird-assistant/backend
python -m venv /root/venvs/bird-vision --system-site-packages
source /root/venvs/bird-vision/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[gpu]'
python -m pip check
python - <<'PY'
import torch, torchvision
assert torch.cuda.is_available() and torch.version.cuda
boxes = torch.tensor([[0., 0., 2., 2.]], device="cuda")
torchvision.ops.nms(boxes, torch.ones(1, device="cuda"), 0.5)
print(torch.__version__, torchvision.__version__, torch.version.cuda)
PY
```

`.[gpu]` 会安装 Ultralytics/ByteTrack、OpenCLIP 和 Hugging Face Hub；不会把 YOLO/BioCLIP 权重打进 Python 包。已有且版本兼容的 CUDA torch/torchvision 会由 `--system-site-packages` 复用。若安装器准备替换它们，先停止并解决版本组合，不能接受 CPU wheel。

YOLO 权重是发布工件，不依赖运行时隐式下载。可以从旧预研目录复制已验证权重，或在确认 Ultralytics 版本和许可后只下载一次：

```bash
mkdir -p /root/shared-nvme/models/yolo
cd /root/shared-nvme/models/yolo
python -c "from ultralytics import YOLO; print(YOLO('yolo11n.pt').ckpt_path)"
```

模型准备和生产哈希：

```bash
export HF_HOME=/root/shared-nvme/models/huggingface
python scripts/prepare_model_artifacts.py \
  --yolo /root/shared-nvme/models/yolo/yolo11n.pt \
  --output /root/shared-nvme/results/model-artifacts.json
```

把报告中的五个 `BIRD_VISION_*` 值写入私有 `.env`。脚本可以从 `main` 解析当前 revision，但输出并下载的是完整不可变 commit；生产服务只接受该 commit 和匹配的工件指纹。

验证完成后的正式/重复部署使用归档 wheelhouse 和 GPU 锁：

```bash
cd /root/shared-nvme/bird-assistant/backend
# 在目标 GPU 镜像生成并审核 requirements-gpu-lock.txt 后，发布时从归档 wheelhouse 恢复。
python -m pip install --no-index --find-links /root/shared-nvme/wheelhouse \
  --require-hashes -r requirements-gpu-lock.txt
python -m pip install --no-deps --no-build-isolation -e '.[gpu]'
```

不要执行：

```bash
pip install -r ../鸟类识别预研/requirements.txt
```

该文件服务于原 CPU 预研，会安装 CPU 版 PyTorch。

## 7. 生产配置

从 `.env.example` 复制私有 `.env`，至少修改：

```dotenv
BIRD_VISION_ENVIRONMENT=production
BIRD_VISION_DETECTOR_BACKEND=yolo
BIRD_VISION_DEVICE=cuda
BIRD_VISION_MODEL_PATH=/root/shared-nvme/models/yolo/yolo11n.pt
BIRD_VISION_MODEL_SHA256=<64位SHA-256>
BIRD_VISION_TRACKER_BACKEND=bytetrack

BIRD_VISION_SPECIES_BACKEND=bioclip
BIRD_VISION_SPECIES_CATALOG_PATH=/root/shared-nvme/bird-assistant/backend/config/catalog/avilist_v2026_global.csv
BIRD_VISION_BIOCLIP_MODEL=hf-hub:imageomics/bioclip-2
BIRD_VISION_BIOCLIP_MODEL_REVISION=<完整40位Hugging Face commit SHA>
BIRD_VISION_BIOCLIP_EXPECTED_FINGERPRINT=<审核后的64位artifact fingerprint>
BIRD_VISION_SPECIES_PRECISION=auto
BIRD_VISION_DETECTION_HIGH_RESOLUTION_ENABLED=false
BIRD_VISION_DETECTION_HIGH_RESOLUTION_IMAGE_SIZE=1280
BIRD_VISION_DETECTION_HIGH_RESOLUTION_MIN_IMAGE_RATIO=1.50
BIRD_VISION_SPECIES_TEXT_CACHE_DIR=/root/shared-nvme/models/bioclip-text-cache
# Optional country scope only for requests without coordinates. Coordinate-based
# GBIF misses/insufficient matches fall directly back to the global model.
BIRD_VISION_SPECIES_DEFAULT_REGION_CODE=
# Optional reviewed local occurrence profile. The bundled Hefei profile is an
# example only and must not be enabled unless this deployment explicitly
# serves that covered area.
BIRD_VISION_SPECIES_OCCURRENCE_PATH=
# Missing live cache entries queue background GBIF lookup and fall back meanwhile.
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_ENABLED=true
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_RADIUS_KM=100
# GBIF scientific-name facet page size; all pages are processed.
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_FACET_LIMIT=300
# Persistent regional cache; keep this path on the shared disk.
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_CACHE_PATH=/root/shared-nvme/bird-assistant/backend/runtime/gbif-occurrence-cache.sqlite3
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_CACHE_MAX_ENTRIES=2048
# Valid/empty results persist for 30 days; lookup failures retry after 30 seconds.
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_CACHE_TTL_SECONDS=2592000
# Timeout for each background GBIF HTTP attempt, not the complete lookup.
BIRD_VISION_SPECIES_LIVE_OCCURRENCE_TIMEOUT_SECONDS=8
BIRD_VISION_SPECIES_TEMPORAL_WINDOW_MONTHS=1
# Minimum catalog-matched species required to use an offline or live local set.
BIRD_VISION_SPECIES_MIN_LOCAL_CANDIDATES=2
BIRD_VISION_SPECIES_MIN_SIMILARITY=0.20
BIRD_VISION_SPECIES_MIN_MARGIN=0.01

BIRD_VISION_ALLOW_ANONYMOUS=false
BIRD_VISION_API_KEYS=<使用密码管理器生成的长随机值>
BIRD_VISION_MAX_CONCURRENT_INFERENCE=1
# Covers the model pipeline; background GBIF lookups do not occupy this deadline.
BIRD_VISION_INFERENCE_TIMEOUT_SECONDS=30
BIRD_VISION_MAX_CONCURRENT_DECODES=4
BIRD_VISION_MAX_SESSIONS_PER_PRINCIPAL=8
BIRD_VISION_MAX_SUBSCRIBERS_PER_SESSION=2
BIRD_VISION_MAX_BUFFERED_IMAGE_BYTES=536870912
BIRD_VISION_MAX_SAVED_CROP_BYTES=134217728
```

仓库已包含 AviList v2026 全球目录和一个合肥可选离线索引示例，但后端不绑定合肥。实时会话创建后立即预取当前月份窗口；批量历史任务应调用 `POST /api/v1/species/occurrence/cache/prepare` 并等待 `ready` 后再上传图片。发布前通过鉴权的 `GET /api/v1/models` 核对 `live_occurrence.coordinate_cache.persistent=true`、路径、条目数和命中计数。

实时 GBIF 使用独立的有界工作池，最多并发 2 个坐标查询，进行中和排队合计最多 8 个；它不占用 GPU 推理槽。查询直接分页读取 `scientificName` 分面，不再逐个请求物种详情。成功和明确空结果写入 SQLite，默认保留 30 天并跨会话、代码同步和服务重启复用；网络失败不写磁盘，只在内存冷却 30 秒。100 km 查询将附近坐标归并到约 `0.1°` 区域网格。

首次填充时，查询圆和月份会发送到 `api.gbif.org`。SQLite 只保存不可逆哈希区域键和聚合物种计数，不保存原始经纬度；哈希仍属于位置派生数据，应按 TTL、访问控制和备份策略管理。有外传约束的部署应关闭实时查询并提供充分覆盖的离线索引。

云端网络不稳定时，可在网络较好的本机预热一个或多个地区，再上传并合并；合并保留云端其他地区以及同键较新的条目：

```bash
cd backend
python scripts/warm_occurrence_cache.py \
  --cache runtime/local-gbif-seed.sqlite3 \
  --latitude 31.8206 --longitude 117.2272 --month 5 --window-months 1
# For images whose capture month is unknown, also warm the all-year key.
python scripts/warm_occurrence_cache.py \
  --cache runtime/local-gbif-seed.sqlite3 \
  --latitude 31.8206 --longitude 117.2272 --all-year
cd ..
./test-cloud-vision.sh \
  --occurrence-cache-seed backend/runtime/local-gbif-seed.sqlite3
```

也可以先上传文件，再在云端服务停止期间执行 `python scripts/warm_occurrence_cache.py --cache runtime/gbif-occurrence-cache.sqlite3 --merge /path/to/seed.sqlite3`。不得在服务运行时直接覆盖 SQLite 主文件或复制 `-wal` 文件。

中国全境离线索引不是仓库内置数据。生产环境可以先依靠任意坐标的实时 GBIF 查询，但高流量和低延迟部署仍应使用经审核的 GBIF SQL TSV/ZIP 运行 `MODELS.md` 中的网格构建命令，并将生成文件作为版本化部署资产；仅配置 `CN` 不会提供地点分布数据。索引的 GBIF 下载 DOI、查询文本、生成时间、文件 SHA-256、名称匹配报告和许可证引用应与发布版本一起归档。

CUDA 下 `SPECIES_PRECISION=auto` 会使用 FP16 autocast。首次启动需要为 10,970 个启用物种生成 BioCLIP 文本特征；缓存键包含实际权重指纹、解析后的 revision、特征维度、目录哈希、提示模板版本和精度，之后启动直接读取。缓存目录必须放共享存储，目录或模型升级后会自动生成新缓存，不能手工把旧缓存改名复用。

生产配置在启动时拒绝 Mock、Disabled、CPU、缺失/错误 YOLO SHA-256、移动的 Hugging Face revision 和错误 BioCLIP 指纹。`/readyz` 还会检查真实 backend、CUDA 设备和运行时健康状态。

## 8. 模型自检

确认私有 `.env` 位于 `backend/` 目录后运行（程序会直接读取它，不需要 `source`）：

```bash
python scripts/check_runtime.py --require-gpu \
  --batch-sizes 1 4 8 --iterations 20 \
  --max-vram-mib <发布预算> --max-p95-ms <延迟预算> \
  --output /root/shared-nvme/results/runtime.json
```

自检完成：

- CUDA 模型能够加载；
- 检测器完成一次合成图片推理；
- BioCLIP 目录能够加载，并完成文本特征和合成图片特征推理；
- 输出模型、设备、CUDA 和耗时信息。

合成图片没有鸟，零检测是正常结果。还必须用有授权的真实鸟图完成 `/frames` 端到端测试。

固定实拍裁剪集的物种识别和拒识验收：

```bash
python scripts/evaluate_species.py /root/shared-nvme/eval/manifest.csv \
  --output /root/shared-nvme/results/species-eval.json
```

只有根据该报告确定阈值后，才能调整 `SPECIES_MIN_SIMILARITY` 和 `SPECIES_MIN_MARGIN`。不得拿默认阈值或单张图片结果宣称准确率。

检测、跟踪、裁剪和分类完整链路验收：

```bash
python scripts/evaluate_pipeline.py /root/shared-nvme/eval/frames.json \
  --require-gpu --realtime --batch-size 8 \
  --min-top1 0.70 --min-top3 0.85 \
  --max-unknown-false-accept-rate 0.05 \
  --output /root/shared-nvme/results/pipeline.json
```

只有 `--require-gpu` 成功、真实权重和实拍标注集报告达到发布门槛，才算完成 GPU 验收。CI 的 CPU OpenCLIP/ByteTrack 测试只验证依赖和接口兼容性。

## 9. 启动和探针

```bash
bird-vision --host 0.0.0.0 --port 8000 --workers 1
```

探针：

```bash
curl --fail http://127.0.0.1:8000/healthz
curl --fail http://127.0.0.1:8000/readyz
```

只有 `/readyz` 返回 `200` 才能接流量。

如通过平台开放 HTTPS 端口，只用于联调；正式环境让公网业务服务器通过受控网络访问，并在入口处限制来源 IP、TLS 和请求大小。

## 10. 开机自启

平台支持 s6 时，为服务注册启动脚本。脚本应完成：

```bash
#!/bin/bash
set -euo pipefail
cd /root/shared-nvme/bird-assistant/backend
source /root/venvs/bird-vision/bin/activate
exec bird-vision --host 0.0.0.0 --port 8000 --workers 1
```

保存系统镜像之前，确认 `.env` 不会被分享给其他账号；更安全的方式是由平台 Secret 或启动时注入环境变量。

## 11. 按量开关机

开发期间手动控制：

1. 开始联调前在云平台启动实例；
2. 等 `/readyz` 成功；
3. 开放业务网关到 GPU Worker 的路由；
4. 联调结束后先停止新会话；
5. 等活动会话归零；
6. 通过云平台控制面关机，并确认状态为“已关机”。

只退出 SSH、停止 Python 或在容器里执行普通关机命令，不应作为停止计费的判断依据。

自动化时由公网服务器持有平台开关机 API Key：

```text
OFF → 调平台开机 API → STARTING → /readyz 成功 → READY
READY → 连续 20～30 分钟无会话 → DRAINING → 调平台关机 API → OFF
```

关机后 GPU 库存通常不预留，所以首个用户请求不能无条件依赖即时开机。课程答辩应提前启动；线上产品需要降级服务。

## 12. 监控与告警

采集：

- `/metrics` 的活动会话、处理/丢弃/失败帧、HTTP 与推理延迟；
- `nvidia-smi` 或平台 GPU 利用率、显存、温度；
- `/readyz`；
- 云实例运行状态与账户额度。

建议告警：

- `/readyz` 连续 3 次失败；
- `failed / accepted > 1%` 持续 5 分钟；
- `stale + replaced` 持续升高，说明帧率或并发超过容量；
- GPU 显存超过 90%；
- P95 总延迟超过产品预算；
- Worker 心跳中断 15 秒。

## 13. 发布和回滚

每次发布记录：

- Git commit；
- Python、PyTorch、CUDA、驱动版本；
- YOLO 权重哈希；
- BioCLIP 模型 revision；
- BioCLIP artifact fingerprint；
- 精确依赖锁、GPU 镜像 digest 和归档 wheelhouse；
- 鸟种目录版本与哈希；
- 本地鸟类评测结果；
- API 兼容性结论。

新版本先在独立端口启动，通过 `/readyz` 和真实图片 smoke test 后再切换网关。保留上一版本环境和模型目录，出现异常时只切回网关路由，不现场覆盖权重。
