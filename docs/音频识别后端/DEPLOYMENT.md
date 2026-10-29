# 音频识别服务部署与运维

## 1. 运行环境

| 项 | 要求 |
|---|---|
| Python | 3.11–3.14（与视觉后端一致，CI 用 3.14） |
| CPU | 任意 x86_64；实测 4 线程 p50 ≈ 20 ms/窗 |
| 内存 | 模型常驻约 150–250 MB（含 LiteRT 运行时与标签） |
| 磁盘 | 模型 49 MB + 标签 254 KB；临时目录峰值 ≈ 单请求音频大小 |
| 外部程序 | ffmpeg（系统包或 `imageio-ffmpeg`） |
| 网络 | 出站无要求（模型离线加载，不做云端调用） |

```bash
cd backend
python -m pip install -e '.[audio]'      # LiteRT + numpy + imageio-ffmpeg
python -m pip check
```

安装后自检：

```bash
python -c "from bird_audio.audio import resolve_ffmpeg; from bird_audio.config import AudioSettings; print(resolve_ffmpeg(AudioSettings()))"
```

## 2. 模型与标签

权重不入库。放到 `鸟类识别预研/models/birdnet/`（或任何本地目录，用环境变量指向）：

```bash
mkdir -p 鸟类识别预研/models/birdnet
curl -L -o 鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite \
  https://raw.githubusercontent.com/joeweiss/birdnetlib/main/src/birdnetlib/models/analyzer/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite
curl -L -o 鸟类识别预研/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt \
  https://raw.githubusercontent.com/joeweiss/birdnetlib/main/src/birdnetlib/models/analyzer/BirdNET_GLOBAL_6K_V2.4_Labels.txt
sha256sum 鸟类识别预研/models/birdnet/*
```

本仓库验证过的摘要：

```text
model  55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c
labels b50b77b7c3dfe40cd637e8cccdca0173a0a4ddee8867b830ff3c1a566f477f16
```

生产必须把这两个值写进 `BIRD_AUDIO_MODEL_SHA256` / `BIRD_AUDIO_LABELS_SHA256`；启动时会重算并
在不等时拒绝启动。开发环境可以留空，`/api/v1/models` 会回报实际计算值。

许可证见 [MODELS.md](MODELS.md)：BirdNET 权重为 **CC BY-NC-SA 4.0（非商业）**，课程/研究用途可用，
商业化前必须替换或取得授权。

## 3. 配置

完整示例见 `backend/.env.example`。生产最小配置：

```dotenv
BIRD_AUDIO_ENVIRONMENT=production
BIRD_AUDIO_ENGINE_BACKEND=birdnet
BIRD_AUDIO_MODEL_PATH=/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite
BIRD_AUDIO_LABELS_PATH=/models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt
BIRD_AUDIO_MODEL_SHA256=55f3e405...
BIRD_AUDIO_LABELS_SHA256=b50b77b7...
BIRD_AUDIO_CATALOG_PATH=config/catalog/avilist_v2026_global.csv
BIRD_AUDIO_TEMP_DIR=/var/tmp/bird-audio
BIRD_AUDIO_ALLOW_ANONYMOUS=false
BIRD_AUDIO_API_KEYS=<32 字节以上随机串>
BIRD_AUDIO_CORS_ORIGINS=
```

生产环境的配置校验（`AudioSettings`）会拒绝：匿名访问、无 API Key、mock 引擎、模型/标签/目录文件
不存在、缺少 SHA-256、未设置临时目录。

主要的容量/策略开关：

| 变量 | 默认 | 作用 |
|---|---:|---|
| `BIRD_AUDIO_MAX_AUDIO_BYTES` | 10485760 | 单文件上限 |
| `BIRD_AUDIO_MAX_DURATION_SECONDS` | 60 | 时长上限（解码后判断） |
| `BIRD_AUDIO_MIN_DURATION_SECONDS` | 1.0 | 时长下限 |
| `BIRD_AUDIO_UPLOAD_TIMEOUT_SECONDS` | 20 | 上传超时 |
| `BIRD_AUDIO_PROCESSING_TIMEOUT_SECONDS` | 30 | 处理超时 |
| `BIRD_AUDIO_MAX_CONCURRENT_ANALYSES` | 1 | 同时推理数（CPU 上建议 1） |
| `BIRD_AUDIO_MAX_QUEUED_ANALYSES` | 4 | 排队上限 |
| `BIRD_AUDIO_MIN_SCORE` | 0.5 | 候选阈值 |
| `BIRD_AUDIO_MIN_CONFIRMING_WINDOWS` | 2 | 跨窗确认 |
| `BIRD_AUDIO_CANDIDATE_COUNT` | 5 | 默认候选数 |

## 4. 启动

```bash
bird-audio --host 0.0.0.0 --port 8100
```

`--workers` 只能是 1：模型、临时目录与准入计数都在进程内，多 worker 会重复加载模型并破坏
容量上限。横向扩容用**多副本 + 网关轮询**，不是多 worker。

## 5. 容器化示例

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend /app/backend
RUN pip install --no-cache-dir -e /app/backend/.[audio]
ENV BIRD_AUDIO_ENVIRONMENT=production \
    BIRD_AUDIO_TEMP_DIR=/var/tmp/bird-audio
VOLUME ["/models"]
EXPOSE 8100
CMD ["bird-audio", "--host", "0.0.0.0", "--port", "8100"]
```

`docker-compose.yml`（联调用，三个服务）：

```yaml
services:
  audio:
    build: .
    ports: ["8100:8100"]
    volumes: ["./鸟类识别预研/models:/models:ro", "./backend/config:/app/backend/config:ro"]
    environment:
      BIRD_AUDIO_MODEL_PATH: /models/birdnet/BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite
      BIRD_AUDIO_LABELS_PATH: /models/birdnet/BirdNET_GLOBAL_6K_V2.4_Labels.txt
      BIRD_AUDIO_CATALOG_PATH: /app/backend/config/catalog/avilist_v2026_global.csv
      BIRD_AUDIO_ALLOW_ANONYMOUS: "true"      # 仅联调
    tmpfs: ["/var/tmp/bird-audio"]
  business:
    build: .
    command: ["bird-business", "--host", "0.0.0.0", "--port", "8200"]
    ports: ["8200:8200"]
    environment:
      BIRD_BUSINESS_DATABASE_PATH: /data/observations.sqlite3
    volumes: ["business-data:/data"]
volumes:
  business-data:
```

`tmpfs` 让临时文件只落在内存且随容器销毁；若要排查，可挂载普通卷但需保留清理策略。

## 6. 网关 / 反向代理

Nginx 片段：

```nginx
location /api/v1/audio/ {
    client_max_body_size 11m;              # 与服务端上限对齐
    proxy_request_buffering off;
    proxy_read_timeout 90s;                # 大于 上传超时 + 处理超时
    proxy_pass http://bird-audio:8100;
}
```

- `/readyz` 用于就绪探针（模型未加载时返回 503），`/healthz` 只用于存活探针。
- 网关负责注入 `Authorization`，并**不要**把密钥透传给小程序。
- 网关应把 `X-Request-ID` 透传，便于和前端日志对齐。

## 7. 容量与性能

本机实测（Intel Core Ultra 9 275HX，4 线程，10 s 音频 = 6 窗）：总耗时 p50 178 ms、p95 193 ms；
其中解码 p50 45 ms、单窗推理 p50 20 ms。3 s 音频约 60–70 ms。

按单副本 1 并发估算：

| 并发模型 | 容量 |
|---|---|
| 1 并发 + 4 排队 | 约 5–6 次请求/秒上限以内的突发可以吸收，排队超过 4 直接 429 |
| 短视频/拍照联调 | 完全够用 |
| 校园活动高峰 | 增加副本（2–4 个）+ 网关轮询；模型只读加载，副本之间无状态 |

排查慢请求先看 `timing.decode_ms` 与 `timing.inference_ms`：解码异常高通常是网络盘/大文件，
推理异常高通常是 CPU 争用或线程数过大。

## 8. 指标与日志

Prometheus（`GET /metrics`，需鉴权）：

| 指标 | 用途 |
|---|---|
| `bird_audio_analyses_total{state,reason}` | 候选/无候选分布与拒识原因 |
| `bird_audio_rejections_total{code}` | 上传/解码/超时/容量错误分布 |
| `bird_audio_analysis_duration_seconds` | 端到端耗时 |
| `bird_audio_decode_duration_seconds` | 解码耗时 |
| `bird_audio_window_inference_duration_seconds` | 单窗推理耗时 |
| `bird_audio_windows_total` | 送模型窗口数 |
| `bird_audio_analyses_in_flight` | 当前占用 |
| `bird_audio_engine_ready` | 模型就绪 |

日志为单行 JSON，含 `request_id`、`analysis_id`、`state`、`window_count`，不含音频内容。

## 9. 临时文件与数据

- 每次上传写一个 `bird-audio-*` 临时文件（`BIRD_AUDIO_TEMP_DIR`，默认系统临时目录）。
- `finally` 中删除；解码失败、超时、取消、客户端断开等路径都会执行。
- 服务不保存音频、不写数据库；观察记录由 `bird-business` 保存。

## 10. 超时与取消语义（部署视角）

| 阶段 | 超时 | 取消行为 |
|---|---|---|
| 上传 | `UPLOAD_TIMEOUT_SECONDS` | 立即 408，临时文件删除 |
| 解码 | `FFMPEG_TIMEOUT_SECONDS`（默认 20 s） | 408 `AUDIO_DECODE_TIMEOUT` |
| 解码+推理整体 | `PROCESSING_TIMEOUT_SECONDS`（默认 30 s） | 504；后台线程跑完后丢弃结果 |
| 客户端断开 | — | 推理前断开 → 499；推理中断开 → 结果丢弃 |

## 11. 上线检查

- [ ] `BIRD_AUDIO_ENVIRONMENT=production` 能启动（配置校验通过）
- [ ] `/readyz` 返回 200 且 `models[*].ready=true`
- [ ] `/api/v1/models` 的 `model_sha256` / `labels_sha256` 与预期一致
- [ ] `curl` 上传一段 MP3 得到 `state=candidate` 与中文名候选
- [ ] 上传空文件/损坏文件/FLAC/超长文件分别得到 422/422/415/413
- [ ] 并发压测超过 `并发+排队` 时返回 429 与 `Retry-After`
- [ ] 临时目录在压测后为空
- [ ] 网关 `client_max_body_size`、`proxy_read_timeout` 已对齐
- [ ] 监控看板接入上述指标
