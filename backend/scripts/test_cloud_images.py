#!/usr/bin/env python3
"""Run local images through the cloud Bird Vision HTTP/WebSocket API.

This command prepares phone-sized frames locally, starts or reuses the remote
service through SSH, creates a temporary localhost tunnel, sends each still
image as a short frame sequence, and writes HTML/CSV/JSON reports. The API key
is read remotely and is never persisted in a report.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import csv
import hashlib
import html
import json
import math
import os
import re
import selectors
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import websockets
from PIL import Image, ImageOps, UnidentifiedImageError

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGE_DIR = PROJECT_ROOT / "image"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "backend" / "results" / "cloud-image-test"
SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
HEFEI_LATITUDE = 31.8206
HEFEI_LONGITUDE = 117.2272
HEFEI_TIMEZONE = ZoneInfo("Asia/Shanghai")


class TestFailure(RuntimeError):
    """An actionable end-to-end test failure."""


def log(message: str) -> None:
    print(message, flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="一键测试本地 image/ 中的图片是否能被云端鸟类识别后端处理",
    )
    parser.add_argument("--ssh-host", default="bird-gpu", help="SSH 主机或 ~/.ssh/config 别名")
    parser.add_argument(
        "--remote-backend",
        default="/root/shared-nvme/bird-assistant/backend",
        help="云端 backend 目录",
    )
    parser.add_argument(
        "--remote-venv",
        default="/root/venvs/bird-vision",
        help="云端 Python 虚拟环境",
    )
    parser.add_argument("--remote-port", type=int, default=8000, help="云端服务端口")
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR, help="本地测试图片目录")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help="本地报告根目录",
    )
    parser.add_argument("--region-code", default="CN", help="识别使用的两位地区代码")
    parser.add_argument("--latitude", type=float, default=HEFEI_LATITUDE, help="拍摄地纬度，默认合肥市中心")
    parser.add_argument("--longitude", type=float, default=HEFEI_LONGITUDE, help="拍摄地经度，默认合肥市中心")
    parser.add_argument("--location-name", default="合肥", help="报告中显示的拍摄地名称")
    parser.add_argument(
        "--capture-time-precision",
        choices=("auto", "unknown"),
        default="auto",
        help="auto 按 EXIF/文件名判断；unknown 表示所有图片拍摄时间不详，不按月份过滤",
    )
    parser.add_argument(
        "--max-side",
        type=int,
        default=1920,
        help="上传前把图片最长边缩放到该像素值",
    )
    parser.add_argument(
        "--frames",
        type=int,
        default=0,
        help="每张图模拟的连续帧数；0 表示自动使用云端轨迹确认帧数",
    )
    parser.add_argument(
        "--startup-timeout",
        type=int,
        default=300,
        help="等待云端模型加载完成的秒数",
    )
    parser.add_argument(
        "--local-candidate-timeout",
        type=int,
        default=90,
        help="等待合肥 GBIF 当地候选后台查询完成的秒数",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="只生成符合接口限制的测试图片，不连接云端",
    )
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    args.image_dir = args.image_dir.expanduser().resolve()
    args.output_root = args.output_root.expanduser().resolve()
    args.region_code = args.region_code.upper()
    if not args.image_dir.is_dir():
        raise TestFailure(f"测试图片目录不存在：{args.image_dir}")
    if len(args.region_code) != 2 or not args.region_code.isascii() or not args.region_code.isalpha():
        raise TestFailure("--region-code 必须是两位 ASCII 字母，例如 CN")
    if args.max_side < 320 or args.max_side > 3840:
        raise TestFailure("--max-side 必须在 320 到 3840 之间")
    if args.frames < 0:
        raise TestFailure("--frames 不能为负数")
    if not 1 <= args.remote_port <= 65535:
        raise TestFailure("--remote-port 必须是有效端口")
    if not 0 <= args.local_candidate_timeout <= 600:
        raise TestFailure("--local-candidate-timeout 必须在 0 到 600 秒之间")
    if not -90.0 <= args.latitude <= 90.0 or not -180.0 <= args.longitude <= 180.0:
        raise TestFailure("经纬度超出有效范围")


def image_capture_time(source: Path, opened: Image.Image) -> tuple[datetime, str]:
    raw_exif = opened.getexif().get(36867) or opened.getexif().get(306)
    if isinstance(raw_exif, str):
        try:
            return datetime.strptime(raw_exif, "%Y:%m:%d %H:%M:%S").replace(tzinfo=HEFEI_TIMEZONE), "exif"
        except ValueError:
            pass
    patterns = (
        (r"(?<!\d)(20\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})[_-](\d{2})(?!\d)", 6),
        (r"(?<!\d)(20\d{12})(?!\d)", 1),
    )
    for pattern, groups in patterns:
        match = re.search(pattern, source.name)
        if not match:
            continue
        try:
            if groups == 6:
                values = [int(value) for value in match.groups()]
                return datetime(*values, tzinfo=HEFEI_TIMEZONE), "filename"
            return datetime.strptime(match.group(1), "%Y%m%d%H%M%S").replace(
                tzinfo=HEFEI_TIMEZONE
            ), "filename"
        except ValueError:
            continue
    # Some messaging apps strip EXIF. The filesystem time is an explicit,
    # auditable approximation and is recorded as such in the report.
    return datetime.fromtimestamp(source.stat().st_mtime, tz=HEFEI_TIMEZONE), "file_mtime"


def unique_output_path(output_dir: Path, relative: Path) -> Path:
    candidate = output_dir / relative.with_suffix(".jpg")
    if not candidate.exists():
        return candidate
    digest = hashlib.sha256(relative.as_posix().encode("utf-8")).hexdigest()[:8]
    return candidate.with_name(f"{candidate.stem}-{digest}.jpg")


def save_bounded_jpeg(image: Image.Image, output: Path, maximum_bytes: int) -> int:
    quality = 88
    for _ in range(6):
        image.save(output, "JPEG", quality=quality, optimize=True)
        size = output.stat().st_size
        if size <= maximum_bytes:
            return size
        quality -= 8
    raise TestFailure(f"压缩后仍超过 {maximum_bytes} 字节：{output.name}")


def prepare_images(
    image_dir: Path,
    output_dir: Path,
    max_side: int,
    maximum_bytes: int = 6 * 1024 * 1024,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    candidates = sorted(
        path for path in image_dir.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )
    if not candidates:
        raise TestFailure(f"{image_dir} 中没有 JPEG、PNG 或 WebP 图片")

    output_dir.mkdir(parents=True, exist_ok=False)
    prepared: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for source in candidates:
        relative = source.relative_to(image_dir)
        output = unique_output_path(output_dir, relative)
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(source) as opened:
                captured_at, capture_time_source = image_capture_time(source, opened)
                image = ImageOps.exif_transpose(opened).convert("RGB")
                original_width, original_height = image.size
                image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
                width, height = image.size
                byte_count = save_bounded_jpeg(image, output, maximum_bytes)
                image.close()
            prepared.append(
                {
                    "source": str(source),
                    "source_relative": relative.as_posix(),
                    "prepared": str(output),
                    "original_width": original_width,
                    "original_height": original_height,
                    "width": width,
                    "height": height,
                    "bytes": byte_count,
                    "captured_at": captured_at.isoformat(),
                    "capture_time_source": capture_time_source,
                }
            )
        except (UnidentifiedImageError, OSError, ValueError, TestFailure) as exc:
            output.unlink(missing_ok=True)
            errors.append({"source": str(source), "error": str(exc)})

    if not prepared:
        raise TestFailure("没有一张图片能够成功解码和预处理")
    return prepared, errors


class SSHSession:
    def __init__(self, host: str) -> None:
        self.host = host
        self.process: subprocess.Popen[str] | None = None

    def open(
        self,
        script: str,
        arguments: list[str],
        local_port: int,
        remote_port: int,
        startup_timeout: int,
    ) -> dict[str, Any]:
        if shutil.which("ssh") is None:
            raise TestFailure("本地没有找到 ssh 命令")

        marker = "BIRD_TEST_CONFIG="
        progress_marker = "BIRD_TEST_PROGRESS="
        argument_text = " ".join(shlex.quote(item) for item in arguments)
        delimiter = "__BIRD_VISION_BOOTSTRAP_8F1E6C__"
        bootstrap_input = (
            f"stty -echo\nbash -s -- {argument_text} <<'{delimiter}'\n{script.rstrip()}\n{delimiter}\n"
        )
        forward_spec = f"127.0.0.1:{local_port}:127.0.0.1:{remote_port}"
        command = [
            "ssh",
            # The Paratera container gateway closes -N/no-PTY sessions even
            # though an interactive login succeeds. Keep one dedicated TTY
            # session alive and use that same connection for the tunnel.
            "-tt",
            "-o",
            "ControlMaster=no",
            "-o",
            "ControlPath=none",
            "-o",
            "ConnectTimeout=20",
            "-o",
            "ServerAliveInterval=30",
            "-o",
            "ServerAliveCountMax=3",
            "-o",
            "ExitOnForwardFailure=yes",
            "-L",
            forward_spec,
            self.host,
        ]
        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None:
            self.close()
            raise TestFailure("无法创建 SSH 输入输出通道")

        # Do not use `ssh host command`: this provider's gateway accepts an
        # interactive shell more reliably. Queue a heredoc after login so the
        # transport matches a successful manual `ssh bird-gpu` login.
        self.process.stdin.write(bootstrap_input)
        self.process.stdin.close()

        output_lines: list[str] = []
        deadline = time.monotonic() + startup_timeout + 30
        selector = selectors.DefaultSelector()
        selector.register(self.process.stdout, selectors.EVENT_READ)
        try:
            while time.monotonic() < deadline:
                events = selector.select(timeout=1.0)
                if events:
                    line = self.process.stdout.readline()
                    if line:
                        cleaned = line.strip()
                        if cleaned.startswith(progress_marker):
                            log(f"      {cleaned[len(progress_marker) :]}")
                            continue
                        if cleaned.startswith(marker):
                            encoded = cleaned[len(marker) :]
                            try:
                                return json.loads(base64.b64decode(encoded).decode("utf-8"))
                            except (ValueError, json.JSONDecodeError) as exc:
                                raise TestFailure("无法解析云端测试配置") from exc
                        if cleaned:
                            output_lines.append(cleaned)
                            del output_lines[:-80]
                if self.process.poll() is not None:
                    break
        finally:
            selector.close()

        exit_code = self.process.poll()
        detail = "\n".join(output_lines[-40:])
        self.close()
        if exit_code is None:
            raise TestFailure(f"等待云端服务启动超时。{detail}")
        if exit_code < 0:
            signal_number = -exit_code
            try:
                signal_name = signal.Signals(signal_number).name
            except ValueError:
                signal_name = f"signal {signal_number}"
            message = f"本地 SSH 进程被 {signal_name} 中断（returncode {exit_code}）"
            if signal_number == signal.SIGINT:
                message += "；这通常表示终端收到 Ctrl+C 或运行工具主动取消了任务，不是云端服务退出码"
            raise TestFailure(message + (f"。\n{detail}" if detail else "。"))
        raise TestFailure(
            f"SSH 会话在云端初始化完成前关闭（退出码 {exit_code}）。" + (f"\n{detail}" if detail else "")
        )

    def close(self) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None


REMOTE_BOOTSTRAP = r"""
set -Eeuo pipefail

backend=$1
venv=$2
port=$3
startup_timeout=$4

if [[ ! -d "$backend" ]]; then
  echo "云端后端目录不存在：$backend" >&2
  exit 10
fi
if [[ ! -x "$venv/bin/python" ]]; then
  echo "云端虚拟环境不存在：$venv" >&2
  exit 11
fi
if [[ ! -f "$backend/.env" ]]; then
  echo "云端缺少 $backend/.env" >&2
  exit 12
fi

cd "$backend"
mkdir -p runtime results
log_file="$backend/results/cloud-image-test-service.log"
pid_file="$backend/runtime/cloud-image-test-service.pid"
service_status="existing"

health_code=$(
  curl -sS --max-time 3 -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$port/healthz" || true
)
if [[ "$health_code" == "200" ]]; then
  ready_code=$(
    curl -sS --max-time 10 -o /tmp/bird-ready.json -w '%{http_code}' \
      "http://127.0.0.1:$port/readyz" || true
  )
  if [[ "$ready_code" != "200" ]]; then
    echo "端口 $port 已有 Bird Vision 服务，但它未就绪：" >&2
    cat /tmp/bird-ready.json >&2 || true
    exit 13
  fi
else
  service_status="started"
  echo "BIRD_TEST_PROGRESS=正在启动云端模型服务，首次加载可能需要数分钟"
  nohup env \
    PYTHONPATH="$backend/src" \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    "$venv/bin/python" -m bird_vision.cli \
      --host 127.0.0.1 --port "$port" --workers 1 \
      >"$log_file" 2>&1 </dev/null &
  service_pid=$!
  printf '%s\n' "$service_pid" >"$pid_file"

  deadline=$((SECONDS + startup_timeout))
  started_at=$SECONDS
  next_progress=$((SECONDS + 15))
  ready_code=""
  while (( SECONDS < deadline )); do
    ready_code=$(
      curl -sS --max-time 5 -o /tmp/bird-ready.json -w '%{http_code}' \
        "http://127.0.0.1:$port/readyz" || true
    )
    if [[ "$ready_code" == "200" ]]; then
      break
    fi
    if ! kill -0 "$service_pid" 2>/dev/null; then
      echo "云端服务启动后退出，日志末尾：" >&2
      tail -n 80 "$log_file" >&2 || true
      exit 14
    fi
    if (( SECONDS >= next_progress )); then
      elapsed=$((SECONDS - started_at))
      echo "BIRD_TEST_PROGRESS=云端模型仍在加载（${elapsed}s/${startup_timeout}s），请勿关闭终端或按 Ctrl+C"
      next_progress=$((SECONDS + 15))
    fi
    sleep 2
  done

  if [[ "$ready_code" != "200" ]]; then
    echo "等待云端服务就绪超时，日志末尾：" >&2
    tail -n 80 "$log_file" >&2 || true
    exit 15
  fi
fi

export BIRD_TEST_SERVICE_STATUS="$service_status"
export BIRD_TEST_LOG_FILE="$log_file"
PYTHONPATH="$backend/src" "$venv/bin/python" - "$port" <<'PY'
import base64
import json
import os
import sys
import urllib.request

from bird_vision.config import Settings

port = int(sys.argv[1])
settings = Settings()
keys = sorted(settings.api_key_set)
if not settings.allow_anonymous and not keys:
    raise SystemExit("服务禁止匿名访问，但没有可用 API Key")

with urllib.request.urlopen(f"http://127.0.0.1:{port}/readyz", timeout=10) as response:
    readiness = json.load(response)

payload = {
    "api_key": keys[0] if keys else None,
    "allow_anonymous": settings.allow_anonymous,
    "track_confirm_hits": settings.track_confirm_hits,
    "classification_refresh_seconds": settings.classification_refresh_seconds,
    "max_frame_rate": settings.max_frame_rate,
    "max_image_bytes": settings.max_image_bytes,
    "max_image_pixels": settings.max_image_pixels,
    "service_status": os.environ["BIRD_TEST_SERVICE_STATUS"],
    "service_log": os.environ["BIRD_TEST_LOG_FILE"],
    "readiness": readiness,
}
encoded = base64.b64encode(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
print("BIRD_TEST_CONFIG=" + encoded)
PY

# Keep the allocated TTY and its local port forwarding alive until the local
# test process closes SSH. The inference service itself was started with nohup.
while :; do
  sleep 3600
done
"""


def bootstrap_remote(
    ssh: SSHSession,
    backend: str,
    venv: str,
    port: int,
    startup_timeout: int,
    local_port: int,
) -> dict[str, Any]:
    return ssh.open(
        REMOTE_BOOTSTRAP,
        [backend, venv, str(port), str(startup_timeout)],
        local_port,
        port,
        startup_timeout,
    )


def find_free_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


async def wait_for_local_service(base_url: str, timeout: float = 15.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
        while time.monotonic() < deadline:
            try:
                response = await client.get(f"{base_url}/readyz")
                if response.status_code == 200:
                    return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
            await asyncio.sleep(0.25)
    raise TestFailure(f"SSH 隧道已建立，但本地无法访问云端服务：{last_error or 'readyz 未就绪'}")


async def receive_frame_event(websocket: Any, frame_id: str, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TestFailure(f"等待帧 {frame_id} 的推理结果超时")
        raw = await asyncio.wait_for(websocket.recv(), timeout=remaining)
        event = json.loads(raw)
        if event.get("frame_id") != frame_id:
            continue
        if event.get("type") == "vision.frame.error":
            raise TestFailure(f"帧推理失败：{json.dumps(event, ensure_ascii=False)}")
        if event.get("type") == "vision.frame.result":
            return event


async def submit_frame(
    client: httpx.AsyncClient,
    session_id: str,
    frame_id: str,
    filename: str,
    image_bytes: bytes,
    captured_at: str,
    capture_time_precision: str,
    latitude: float,
    longitude: float,
    retry_delay: float,
) -> None:
    for attempt in range(4):
        response = await client.post(
            f"/api/v1/vision/sessions/{session_id}/frames",
            data={
                "frame_id": frame_id,
                "captured_at": captured_at,
                "capture_time_precision": capture_time_precision,
                "latitude": str(latitude),
                "longitude": str(longitude),
            },
            files={"frame": (filename, image_bytes, "image/jpeg")},
        )
        if response.status_code == 202:
            return
        if response.status_code == 429 and attempt < 3:
            try:
                delay = float(response.headers.get("retry-after", retry_delay))
            except ValueError:
                delay = retry_delay
            await asyncio.sleep(max(delay, retry_delay))
            continue
        raise TestFailure(f"上传帧失败：HTTP {response.status_code} {response.text[:1000]}")
    raise TestFailure(f"上传帧 {frame_id} 多次受到限流")


def summarize_result(result: dict[str, Any]) -> dict[str, Any]:
    tracks = result.get("tracks", [])
    candidates: list[dict[str, Any]] = []
    for track in tracks:
        species = track.get("species") or {}
        ranked = species.get("candidates") or []
        candidates.append(
            {
                "track_id": track.get("track_id"),
                "track_state": track.get("state"),
                "hits": track.get("hits"),
                "detection_score": track.get("detection_score"),
                "recognizable": track.get("recognizable"),
                "species_state": species.get("state"),
                "decision": species.get("decision"),
                "top_candidates": ranked,
            }
        )
    return {
        "track_count": len(tracks),
        "confirmed_tracks": sum(track.get("state") == "confirmed" for track in tracks),
        "recognizable_tracks": sum(bool(track.get("recognizable")) for track in tracks),
        "candidate_tracks": sum((track.get("species") or {}).get("state") == "candidate" for track in tracks),
        "unknown_tracks": sum((track.get("species") or {}).get("state") == "unknown" for track in tracks),
        "tracks": candidates,
        "timing": result.get("timing") or {},
    }


def has_pending_local_candidates(result: dict[str, Any]) -> bool:
    return any(
        ((track.get("species") or {}).get("decision") or {}).get("fallback_reason")
        == "live_occurrence_lookup_pending"
        for track in result.get("tracks", [])
    )


def validate_session_location(
    session: dict[str, Any], *, latitude: float, longitude: float, region_code: str
) -> None:
    received_latitude = session.get("latitude")
    received_longitude = session.get("longitude")
    valid_coordinates = (
        isinstance(received_latitude, int | float)
        and not isinstance(received_latitude, bool)
        and math.isfinite(received_latitude)
        and math.isclose(received_latitude, latitude, abs_tol=1e-6)
        and isinstance(received_longitude, int | float)
        and not isinstance(received_longitude, bool)
        and math.isfinite(received_longitude)
        and math.isclose(received_longitude, longitude, abs_tol=1e-6)
    )
    if not valid_coordinates or session.get("region_code") != region_code:
        raise TestFailure(f"后端会话未采用测试位置：{json.dumps(session, ensure_ascii=False)}")
    if not session.get("coordinates_used_for_inference"):
        raise TestFailure("后端没有启用坐标候选解析，请部署包含实时 GBIF 支持的最新服务")


async def test_one_image(
    client: httpx.AsyncClient,
    ws_base: str,
    auth_headers: dict[str, str],
    item: dict[str, Any],
    index: int,
    region_code: str,
    latitude: float,
    longitude: float,
    capture_time_precision: str,
    frame_count: int,
    frame_delay: float,
    local_candidate_timeout: int,
    classification_refresh_seconds: float,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/vision/sessions",
        json={
            "client_session_id": f"manual-image-test-{index}",
            "observation_mode": "historical",
            "latitude": latitude,
            "longitude": longitude,
            "region_code": region_code,
        },
    )
    if response.status_code != 201:
        raise TestFailure(f"创建会话失败：HTTP {response.status_code} {response.text[:1000]}")
    session = response.json()
    validate_session_location(
        session,
        latitude=latitude,
        longitude=longitude,
        region_code=region_code,
    )
    session_id = session["session_id"]
    image_path = Path(item["prepared"])
    image_bytes = image_path.read_bytes()
    frame_results: list[dict[str, Any]] = []

    try:
        websocket_url = f"{ws_base}/api/v1/vision/sessions/{session_id}/events"
        async with websockets.connect(
            websocket_url,
            additional_headers=auth_headers or None,
            proxy=None,
            open_timeout=30,
            close_timeout=5,
            max_size=4 * 1024 * 1024,
        ) as websocket:
            started = json.loads(await asyncio.wait_for(websocket.recv(), timeout=30))
            if started.get("type") != "vision.session.started":
                raise TestFailure(f"WebSocket 没有返回 session.started：{started}")

            for number in range(1, frame_count + 1):
                if number > 1:
                    await asyncio.sleep(frame_delay)
                frame_id = f"img-{index:04d}-frame-{number:03d}"
                await submit_frame(
                    client,
                    session_id,
                    frame_id,
                    image_path.name,
                    image_bytes,
                    item["captured_at"],
                    (
                        "unknown"
                        if capture_time_precision == "unknown"
                        or item["capture_time_source"] == "file_mtime"
                        else "exact"
                    ),
                    latitude,
                    longitude,
                    frame_delay,
                )
                frame_results.append(await receive_frame_event(websocket, frame_id, timeout=120))

            lookup_deadline = time.monotonic() + local_candidate_timeout
            while has_pending_local_candidates(frame_results[-1]) and time.monotonic() < lookup_deadline:
                remaining = lookup_deadline - time.monotonic()
                await asyncio.sleep(min(classification_refresh_seconds + 0.25, remaining))
                number += 1
                frame_id = f"img-{index:04d}-local-recheck-{number:03d}"
                await submit_frame(
                    client,
                    session_id,
                    frame_id,
                    image_path.name,
                    image_bytes,
                    item["captured_at"],
                    (
                        "unknown"
                        if capture_time_precision == "unknown"
                        or item["capture_time_source"] == "file_mtime"
                        else "exact"
                    ),
                    latitude,
                    longitude,
                    frame_delay,
                )
                frame_results.append(await receive_frame_event(websocket, frame_id, timeout=120))
            if has_pending_local_candidates(frame_results[-1]):
                raise TestFailure(
                    f"等待合肥当地候选超过 {local_candidate_timeout} 秒；"
                    "可检查云端到 api.gbif.org 的网络"
                )
    finally:
        with contextlib.suppress(httpx.HTTPError):
            await client.delete(f"/api/v1/vision/sessions/{session_id}")

    final = frame_results[-1]
    return {
        **item,
        "status": "ok",
        "frame_count": len(frame_results),
        "local_candidate_rechecks": max(0, len(frame_results) - frame_count),
        "summary": summarize_result(final),
        "frames": frame_results,
    }


async def run_api_tests(
    prepared: list[dict[str, Any]],
    local_port: int,
    remote: dict[str, Any],
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    http_base = f"http://127.0.0.1:{local_port}"
    ws_base = f"ws://127.0.0.1:{local_port}"
    api_key = remote.get("api_key")
    auth_headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    frame_count = args.frames or max(1, int(remote["track_confirm_hits"]))
    frame_delay = max(0.25, 1.0 / float(remote["max_frame_rate"]) + 0.05)
    results: list[dict[str, Any]] = []

    await wait_for_local_service(http_base)
    async with httpx.AsyncClient(
        base_url=http_base,
        headers=auth_headers,
        timeout=120,
        trust_env=False,
    ) as client:
        total = len(prepared)
        for index, item in enumerate(prepared, 1):
            name = item["source_relative"]
            try:
                result = await test_one_image(
                    client,
                    ws_base,
                    auth_headers,
                    item,
                    index,
                    args.region_code,
                    args.latitude,
                    args.longitude,
                    args.capture_time_precision,
                    frame_count,
                    frame_delay,
                    args.local_candidate_timeout,
                    float(remote["classification_refresh_seconds"]),
                )
                results.append(result)
                summary = result["summary"]
                top_names = []
                for track in summary["tracks"]:
                    ranked = track["top_candidates"]
                    if ranked and track["species_state"] == "candidate":
                        top = ranked[0]
                        top_names.append(
                            top.get("common_name_zh")
                            or top.get("common_name_en")
                            or top.get("scientific_name")
                            or top.get("species_id")
                        )
                if top_names:
                    description = "通过门控=" + "、".join(top_names)
                elif summary["unknown_tracks"]:
                    description = "候选未通过门控（unknown）"
                else:
                    description = "无物种候选"
                decisions = [track["decision"] for track in summary["tracks"] if track["decision"]]
                scopes = sorted({str(decision.get("candidate_scope")) for decision in decisions})
                log(
                    f"[{index:02d}/{total:02d}] {name}："
                    f"鸟体={summary['track_count']}，确认={summary['confirmed_tracks']}，{description}，"
                    f"候选范围={','.join(scopes) if scopes else '未分类'}"
                )
            except Exception as exc:  # keep the remaining real images testable
                results.append({**item, "status": "error", "error": str(exc)})
                log(f"[{index:02d}/{total:02d}] {name}：错误：{exc}")
    return results


def aggregate(results: list[dict[str, Any]], preprocessing_errors: list[dict[str, str]]) -> dict[str, Any]:
    successful = [item for item in results if item.get("status") == "ok"]
    failed = [item for item in results if item.get("status") != "ok"]
    detected = [item for item in successful if item["summary"]["track_count"] > 0]
    candidates = [item for item in successful if item["summary"]["candidate_tracks"] > 0]
    latencies = [
        frame.get("timing", {}).get("total_ms")
        for item in successful
        for frame in item.get("frames", [])
        if isinstance(frame.get("timing", {}).get("total_ms"), (int, float))
    ]
    return {
        "prepared_images": len(results),
        "preprocessing_errors": len(preprocessing_errors),
        "api_successes": len(successful),
        "api_errors": len(failed),
        "images_with_bird_detections": len(detected),
        "images_without_bird_detections": len(successful) - len(detected),
        "images_with_accepted_species_candidates": len(candidates),
        "average_frame_total_ms": round(sum(latencies) / len(latencies), 3) if latencies else None,
        "p95_frame_total_ms": (
            round(sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)], 3) if latencies else None
        ),
    }


def public_remote_config(remote: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in remote.items() if key != "api_key"}


def write_csv(path: Path, results: list[dict[str, Any]]) -> None:
    columns = [
        "image",
        "status",
        "track_count",
        "confirmed_tracks",
        "candidate_tracks",
        "top_candidate",
        "species_state",
        "detection_score",
        "similarity",
        "total_ms",
        "error",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for item in results:
            if item.get("status") != "ok":
                writer.writerow(
                    {"image": item["source_relative"], "status": "error", "error": item.get("error")}
                )
                continue
            summary = item["summary"]
            first_track = summary["tracks"][0] if summary["tracks"] else {}
            ranked = first_track.get("top_candidates") or []
            top = ranked[0] if ranked else {}
            writer.writerow(
                {
                    "image": item["source_relative"],
                    "status": "ok",
                    "track_count": summary["track_count"],
                    "confirmed_tracks": summary["confirmed_tracks"],
                    "candidate_tracks": summary["candidate_tracks"],
                    "top_candidate": top.get("common_name_zh")
                    or top.get("common_name_en")
                    or top.get("scientific_name"),
                    "species_state": first_track.get("species_state"),
                    "detection_score": first_track.get("detection_score"),
                    "similarity": top.get("similarity"),
                    "total_ms": summary["timing"].get("total_ms"),
                    "error": "",
                }
            )


def render_tracks(summary: dict[str, Any]) -> str:
    if not summary["tracks"]:
        return '<p class="muted">没有检测到鸟体。若这是非鸟照片，则结果正确。</p>'
    sections: list[str] = []
    for track in summary["tracks"]:
        ranked = track["top_candidates"]
        top = ranked[0] if ranked else None
        if top:
            name = top.get("common_name_zh") or top.get("common_name_en") or top.get("scientific_name")
            species_text = (
                f"{html.escape(str(name))} · 状态 {html.escape(str(track['species_state']))} · "
                f"相似度 {html.escape(str(top.get('similarity')))}"
            )
        else:
            species_text = f"无物种候选 · 状态 {html.escape(str(track['species_state']))}"
        sections.append(
            "<li>"
            f"轨迹 {track['track_id']} · {html.escape(str(track['track_state']))} · "
            f"检测分数 {track['detection_score']} · {species_text}"
            "</li>"
        )
    return "<ul>" + "".join(sections) + "</ul>"


def write_html(path: Path, report: dict[str, Any], results: list[dict[str, Any]]) -> None:
    summary = report["summary"]
    cards: list[str] = []
    for item in results:
        image_relative = os.path.relpath(item["prepared"], path.parent).replace(os.sep, "/")
        source_name = html.escape(item["source_relative"])
        if item.get("status") == "ok":
            details = item["summary"]
            badge = "检测到鸟体" if details["track_count"] else "未检测到鸟体"
            badge_class = "found" if details["track_count"] else "empty"
            timing = details["timing"].get("total_ms")
            body = render_tracks(details)
            footer = f"最终帧总耗时：{timing} ms"
        else:
            badge = "测试错误"
            badge_class = "error"
            body = f'<p class="error-text">{html.escape(str(item.get("error")))}</p>'
            footer = "该图片没有得到有效推理结果"
        cards.append(
            f"""
            <article class="card">
              <img src="{html.escape(image_relative)}" alt="{source_name}">
              <div class="content">
                <span class="badge {badge_class}">{badge}</span>
                <h2>{source_name}</h2>
                {body}
                <p class="muted">{html.escape(footer)}</p>
              </div>
            </article>
            """
        )

    document = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>观鸟助手云端识别测试</title>
  <style>
    body {{ margin: 0; background: #f4f3ee; color: #253027; font-family: system-ui, sans-serif; }}
    main {{ max-width: 1180px; margin: auto; padding: 32px 20px 60px; }}
    .notice, .metrics {{ background: white; border-radius: 14px; padding: 18px; margin: 18px 0; }}
    .metrics {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 12px; }}
    .metric strong {{ display: block; font-size: 1.65rem; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(300px,1fr)); gap: 18px; }}
    .card {{ overflow: hidden; background: white; border-radius: 14px; box-shadow: 0 3px 18px #1e351315; }}
    .card img {{ width: 100%; height: 260px; object-fit: contain; background: #171b17; }}
    .content {{ padding: 16px; }} h1, h2 {{ margin-top: 0; }}
    h2 {{ font-size: 1rem; margin-top: 12px; word-break: break-all; }}
    .badge {{ display: inline-block; border-radius: 99px; padding: 4px 10px; font-size: .82rem; }}
    .found {{ background:#d8f1dc; color:#175d2c; }} .empty {{ background:#e8ebe8; }}
    .error {{ background:#ffe0dc; color:#8b2117; }}
    .muted {{ color:#687269; font-size:.9rem; }} .error-text {{ color:#8b2117; }} li {{ margin:.4rem 0; }}
  </style>
</head>
<body><main>
  <h1>观鸟助手云端视觉识别测试</h1>
  <p>生成时间：{html.escape(report["generated_at"])}</p>
  <section class="notice">
    这是端到端接口测试：本地照片经过 SSH 隧道上传，由云端 YOLO、ByteTrack 和 BioCLIP 处理。
    “候选”及相似度不是正确率。当前照片没有机器可读的人工标签，因此本报告不能计算识别准确率。
  </section>
  <section class="metrics">
    <div class="metric"><strong>{summary["api_successes"]}</strong>成功图片</div>
    <div class="metric"><strong>{summary["api_errors"]}</strong>接口错误</div>
    <div class="metric"><strong>{summary["images_with_bird_detections"]}</strong>检测到鸟体</div>
    <div class="metric">
      <strong>{summary["images_with_accepted_species_candidates"]}</strong>产生有效候选
    </div>
    <div class="metric"><strong>{summary["average_frame_total_ms"]}</strong>平均帧耗时 ms</div>
    <div class="metric"><strong>{summary["p95_frame_total_ms"]}</strong>P95 帧耗时 ms</div>
  </section>
  <section class="grid">{"".join(cards)}</section>
</main></body></html>"""
    path.write_text(document, encoding="utf-8")


def write_reports(
    run_dir: Path,
    results: list[dict[str, Any]],
    preprocessing_errors: list[dict[str, str]],
    remote: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[dict[str, Any], Path, Path, Path]:
    summary = aggregate(results, preprocessing_errors)
    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source_image_directory": str(args.image_dir),
        "region_code": args.region_code,
        "location": {
            "name": args.location_name,
            "latitude": args.latitude,
            "longitude": args.longitude,
        },
        "capture_time_precision": args.capture_time_precision,
        "cloud": public_remote_config(remote),
        "summary": summary,
        "preprocessing_errors": preprocessing_errors,
        "results": results,
        "accuracy_evaluated": False,
        "accuracy_note": "人工真值标签缺失；候选分数不能当作准确率。",
    }
    json_path = run_dir / "report.json"
    csv_path = run_dir / "summary.csv"
    html_path = run_dir / "report.html"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(csv_path, results)
    write_html(html_path, report, results)
    return summary, html_path, csv_path, json_path


async def async_main(args: argparse.Namespace) -> int:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = args.output_root / timestamp
    prepared_dir = run_dir / "prepared"
    run_dir.mkdir(parents=True, exist_ok=False)

    log(f"[1/5] 预处理 {args.image_dir} 中的图片……")
    prepared, preprocessing_errors = prepare_images(args.image_dir, prepared_dir, args.max_side)
    log(f"      已准备 {len(prepared)} 张，解码失败 {len(preprocessing_errors)} 张。")

    if args.prepare_only:
        manifest = run_dir / "prepared-manifest.json"
        manifest.write_text(
            json.dumps({"prepared": prepared, "errors": preprocessing_errors}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        log(f"预处理完成：{manifest}")
        return 0

    ssh = SSHSession(args.ssh_host)
    try:
        log(f"[2/5] 连接云端 {args.ssh_host}（如未配置密钥，可能询问一次 SSH 密码）……")
        log("[3/5] 检查并启动云端识别服务；首次加载模型可能需要几分钟……")
        local_port = find_free_local_port()
        remote = bootstrap_remote(
            ssh,
            args.remote_backend,
            args.remote_venv,
            args.remote_port,
            args.startup_timeout,
            local_port,
        )
        model_descriptions = ", ".join(
            f"{model['backend']}@{model['device']}" for model in remote.get("readiness", {}).get("models", [])
        )
        log(f"      服务状态={remote['service_status']}；{model_descriptions}")

        log(
            f"[4/5] 逐张执行 HTTP + WebSocket 端到端测试（{args.location_name} "
            f"{args.latitude:.4f}, {args.longitude:.4f}；本地临时端口 {local_port}）……"
        )
        results = await run_api_tests(prepared, local_port, remote, args)

        log("[5/5] 生成测试报告……")
        summary, html_path, csv_path, json_path = write_reports(
            run_dir,
            results,
            preprocessing_errors,
            remote,
            args,
        )
        log("")
        log("测试完成")
        log(
            f"成功 {summary['api_successes']}/{summary['prepared_images']}；"
            f"检测到鸟体 {summary['images_with_bird_detections']} 张；"
            f"产生物种候选 {summary['images_with_accepted_species_candidates']} 张；"
            f"平均帧耗时 {summary['average_frame_total_ms']} ms。"
        )
        log(f"HTML 报告：{html_path}")
        log(f"CSV 摘要： {csv_path}")
        log(f"JSON 原始结果：{json_path}")
        log(f"云端日志：{remote['service_log']}")
        log("提示：测试结束后 SSH 隧道会自动关闭，但云容器仍需在平台控制台关机才会停止计费。")
        return 1 if summary["api_errors"] or preprocessing_errors else 0
    finally:
        ssh.close()


def main() -> int:
    args = parse_args()
    try:
        validate_args(args)
        return asyncio.run(async_main(args))
    except KeyboardInterrupt:
        print("\n测试已取消。", file=sys.stderr)
        return 130
    except TestFailure as exc:
        print(f"测试失败：{exc}", file=sys.stderr)
        return 1
    except (httpx.HTTPError, OSError, subprocess.SubprocessError, websockets.WebSocketException) as exc:
        print(f"测试失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
