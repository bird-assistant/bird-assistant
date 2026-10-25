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
import queue
import re
import secrets
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
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
        help="每张图模拟的连续帧数；实际值不会低于云端轨迹确认帧数",
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
        help="等待当地 GBIF 候选后台查询完成的秒数",
    )
    parser.add_argument(
        "--occurrence-cache-seed",
        type=Path,
        help="本地预热的 SQLite 区域缓存；上传后与云端缓存合并",
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
    if args.occurrence_cache_seed is not None:
        args.occurrence_cache_seed = args.occurrence_cache_seed.expanduser().resolve()
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
    if args.occurrence_cache_seed is not None and not args.occurrence_cache_seed.is_file():
        raise TestFailure("--occurrence-cache-seed 必须是现有 SQLite 文件")


def sync_backend(args: argparse.Namespace, ssh: SSHSession) -> None:
    source = PROJECT_ROOT / "backend"
    command = [
        "rsync",
        "-rz",
        "--links",
        "-e",
        ssh.rsync_remote_shell,
        "--exclude",
        ".venv",
        "--exclude",
        ".env",
        "--exclude",
        "runtime",
        "--exclude",
        "results",
        f"{source}/",
        f"{args.ssh_host}:{args.remote_backend.rstrip('/')}/",
    ]
    try:
        result = subprocess.run(command, text=True, timeout=120, check=False)
    except FileNotFoundError as exc:
        raise TestFailure("本机未安装 rsync，无法同步后端代码") from exc
    except subprocess.TimeoutExpired as exc:
        raise TestFailure("同步后端代码超时") from exc
    if result.returncode != 0:
        raise TestFailure(f"同步后端代码失败，rsync 退出码 {result.returncode}")
    if args.occurrence_cache_seed is None:
        return
    with tempfile.TemporaryDirectory(prefix="bird-gbif-seed-") as temporary_directory:
        snapshot_path = Path(temporary_directory) / "seed.sqlite3"
        source = sqlite3.connect(
            f"file:{args.occurrence_cache_seed}?mode=ro", uri=True, timeout=2.0
        )
        snapshot = sqlite3.connect(snapshot_path)
        try:
            source.backup(snapshot)
            snapshot.commit()
        except sqlite3.Error as exc:
            raise TestFailure(f"创建 GBIF 区域缓存快照失败：{exc}") from exc
        finally:
            snapshot.close()
            source.close()
        seed_command = [
            "rsync",
            "-z",
            "-e",
            ssh.rsync_remote_shell,
            str(snapshot_path),
            f"{args.ssh_host}:{args.remote_backend.rstrip('/')}/.gbif-occurrence-seed.sqlite3",
        ]
        result = subprocess.run(seed_command, text=True, timeout=120, check=False)
    if result.returncode != 0:
        raise TestFailure(f"上传 GBIF 区域缓存失败，rsync 退出码 {result.returncode}")


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
        self._control_directory: tempfile.TemporaryDirectory[str] | None = None
        self._output: queue.Queue[str | None] = queue.Queue()
        self._reader: threading.Thread | None = None

    @property
    def control_path(self) -> str:
        if self._control_directory is None:
            raise TestFailure("SSH 控制连接尚未建立")
        return str(Path(self._control_directory.name) / "control")

    @property
    def rsync_remote_shell(self) -> str:
        return shlex.join(
            ["ssh", "-S", self.control_path, "-o", "ControlMaster=no", "-o", "ConnectTimeout=20"]
        )

    def connect(self, local_port: int, remote_port: int) -> None:
        if shutil.which("ssh") is None:
            raise TestFailure("本地没有找到 ssh 命令")
        if self.process is not None:
            raise TestFailure("SSH 控制连接已经建立")
        self._control_directory = tempfile.TemporaryDirectory(prefix="bird-ssh-")
        forward_spec = f"127.0.0.1:{local_port}:127.0.0.1:{remote_port}"
        command = [
            "ssh",
            "-M",
            "-S",
            self.control_path,
            "-tt",
            "-o",
            "ControlPersist=no",
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
        self._reader = threading.Thread(target=self._read_output, daemon=True)
        self._reader.start()
        marker_token = secrets.token_hex(8)
        marker = f"BIRD_SSH_READY_{marker_token}"
        # The full marker must not appear in the PTY input: the terminal may
        # echo this first command before `stty -echo` takes effect.
        self.process.stdin.write(
            f"stty -echo; printf 'BIRD_SSH_READY_%s\\n' {shlex.quote(marker_token)}\n"
        )
        self.process.stdin.flush()
        self._wait_for_line(marker, timeout=120, failure="SSH 控制连接建立失败")

    def open(
        self,
        script: str,
        arguments: list[str],
        startup_timeout: int,
    ) -> dict[str, Any]:
        if self.process is None or self.process.stdin is None or self.process.stdout is None:
            raise TestFailure("SSH 控制连接尚未建立")

        marker = "BIRD_TEST_CONFIG="
        progress_marker = "BIRD_TEST_PROGRESS="
        completed_token = secrets.token_hex(8)
        completed_marker = f"BIRD_BOOTSTRAP_DONE_{completed_token}="
        argument_text = " ".join(shlex.quote(item) for item in arguments)
        delimiter = "__BIRD_VISION_BOOTSTRAP_8F1E6C__"
        bootstrap_input = (
            f"bash -s -- {argument_text} <<'{delimiter}'\n{script.rstrip()}\n{delimiter}\n"
            f"status=$?\nprintf 'BIRD_BOOTSTRAP_DONE_%s=%s\\n' "
            f"{shlex.quote(completed_token)} \"$status\"\n"
        )
        self.process.stdin.write(bootstrap_input)
        self.process.stdin.flush()

        output_lines: list[str] = []
        deadline = time.monotonic() + startup_timeout + 180
        while time.monotonic() < deadline:
            try:
                line = self._output.get(timeout=min(1.0, max(0.01, deadline - time.monotonic())))
            except queue.Empty:
                if self.process.poll() is not None:
                    break
                continue
            if line is None:
                break
            cleaned = line.strip()
            progress = _marker_payload(cleaned, progress_marker)
            if progress is not None:
                log(f"      {progress}")
                continue
            encoded = _marker_payload(cleaned, marker)
            if encoded is not None:
                try:
                    return json.loads(base64.b64decode(encoded).decode("utf-8"))
                except (ValueError, json.JSONDecodeError) as exc:
                    raise TestFailure("无法解析云端测试配置") from exc
            completed = _marker_payload(cleaned, completed_marker)
            if completed is not None:
                status = completed.split(maxsplit=1)[0]
                detail = "\n".join(output_lines[-40:])
                self.close()
                raise TestFailure(
                    f"云端初始化脚本提前结束（退出码 {status}）。"
                    + (f"\n{detail}" if detail else "")
                )
            if cleaned:
                output_lines.append(cleaned)
                del output_lines[:-80]

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
            if self.process.stdin is not None:
                self.process.stdin.close()
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None
        if self._reader is not None:
            self._reader.join(timeout=1)
            self._reader = None
        if self._control_directory is not None:
            self._control_directory.cleanup()
            self._control_directory = None

    def _wait_for_line(self, marker: str, *, timeout: float, failure: str) -> None:
        if self.process is None:
            raise TestFailure(failure)
        deadline = time.monotonic() + timeout
        output_lines: list[str] = []
        while time.monotonic() < deadline:
            try:
                line = self._output.get(timeout=min(1.0, max(0.01, deadline - time.monotonic())))
            except queue.Empty:
                if self.process.poll() is not None:
                    break
                continue
            if line is None:
                break
            if marker in line:
                return
            if line.strip():
                output_lines.append(line.strip())
                del output_lines[:-20]
        detail = "\n".join(output_lines[-20:])
        self.close()
        raise TestFailure(f"{failure}。" + (f"\n{detail}" if detail else ""))

    def _read_output(self) -> None:
        if self.process is None or self.process.stdout is None:
            self._output.put(None)
            return
        try:
            for line in self.process.stdout:
                self._output.put(line)
        finally:
            self._output.put(None)


def _marker_payload(line: str, marker: str) -> str | None:
    _, separator, payload = line.partition(marker)
    return payload.strip() if separator else None


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

stop_managed_service() {
  if [[ ! -f "$pid_file" ]]; then
    return
  fi
  managed_pid=$(cat "$pid_file")
  if [[ "$managed_pid" =~ ^[0-9]+$ ]] && kill -0 "$managed_pid" 2>/dev/null; then
    if ! "$venv/bin/python" - "$managed_pid" "$backend" "$port" <<'PY'
import os
import sys
from pathlib import Path

pid, backend, port = int(sys.argv[1]), str(Path(sys.argv[2]).resolve()), sys.argv[3]
arguments = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
arguments = [argument.decode(errors="replace") for argument in arguments if argument]
working_directory = str(Path(f"/proc/{pid}/cwd").resolve())
module = any(
    arguments[index : index + 2] == ["-m", "bird_vision.cli"]
    for index in range(len(arguments) - 1)
)
configured_port = any(
    arguments[index : index + 2] == ["--port", port]
    for index in range(len(arguments) - 1)
)
raise SystemExit(0 if module and configured_port and working_directory == backend else 1)
PY
    then
      echo "PID 文件指向的进程不是 Bird Vision 测试服务：$managed_pid" >&2
      exit 19
    fi
    kill "$managed_pid"
    for _ in {1..80}; do
      kill -0 "$managed_pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$managed_pid" 2>/dev/null; then
      echo "测试服务进程 $managed_pid 未能在 20 秒内停止" >&2
      exit 18
    fi
  fi
  rm -f "$pid_file"
}

health_code=$(
  curl -sS --max-time 3 -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:$port/healthz" || true
)
if [[ -f "$pid_file" ]]; then
  echo "BIRD_TEST_PROGRESS=正在重启测试服务以加载刚同步的代码"
  stop_managed_service
  health_code=""
elif [[ "$health_code" == "200" ]]; then
    echo "端口 $port 已有非测试脚本管理的服务；为避免误停服务，请先人工停止后重试" >&2
    exit 17
fi

if [[ "$health_code" != "200" ]]; then
  stop_deadline=$((SECONDS + 20))
  while (( SECONDS < stop_deadline )) && \
      curl -sS --max-time 1 -o /dev/null "http://127.0.0.1:$port/healthz"; do
    sleep 0.25
  done
  if curl -sS --max-time 1 -o /dev/null "http://127.0.0.1:$port/healthz"; then
    echo "旧测试服务未能在 20 秒内停止，请检查端口 $port 的进程" >&2
    exit 18
  fi
  seed_path="$backend/.gbif-occurrence-seed.sqlite3"
  if [[ -f "$seed_path" ]]; then
    echo "BIRD_TEST_PROGRESS=正在把本地预热数据合并到云端 GBIF 区域缓存"
    mapfile -t cache_settings < <(
      PYTHONPATH="$backend/src" "$venv/bin/python" - <<'PY'
from bird_vision.config import Settings
settings = Settings()
print(settings.species_live_occurrence_cache_path.expanduser().resolve())
print(settings.species_live_occurrence_cache_max_entries)
PY
    )
    cache_path=${cache_settings[0]}
    cache_max_entries=${cache_settings[1]}
    PYTHONPATH="$backend/src" timeout 120s \
      "$venv/bin/python" scripts/warm_occurrence_cache.py \
      --cache "$cache_path" --max-entries "$cache_max_entries" --merge "$seed_path"
    rm -f "$seed_path"
  fi
  service_status="started"
  echo "BIRD_TEST_PROGRESS=正在启动云端模型服务，首次加载可能需要数分钟"
  nohup env \
    BIRD_VISION_DETECTION_HIGH_RESOLUTION_ENABLED=true \
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
else
  :
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
print("BIRD_TEST_" + "CONFIG=" + encoded)
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
) -> dict[str, Any]:
    return ssh.open(
        REMOTE_BOOTSTRAP,
        [backend, venv, str(port), str(startup_timeout)],
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
    confirmed = [track for track in tracks if track.get("state") == "confirmed"]
    return {
        "raw_track_count": len(tracks),
        "track_count": len(tracks),
        "confirmed_bird_count": len(confirmed),
        "confirmed_tracks": len(confirmed),
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


def persistent_occurrence_cache(models: list[dict[str, Any]]) -> dict[str, Any]:
    species_model = next(
        (model for model in models if "live_occurrence" in model.get("details", {})),
        None,
    )
    cache = (
        species_model.get("details", {})
        .get("live_occurrence", {})
        .get("coordinate_cache", {})
        if species_model is not None
        else {}
    )
    if not cache.get("persistent") or cache.get("backend") != "sqlite":
        raise TestFailure("云端后端没有启用持久化 SQLite GBIF 区域缓存")
    return cache


def validated_high_resolution_detector(
    models: list[dict[str, Any]], prepared: list[dict[str, Any]]
) -> dict[str, Any]:
    detector = next(
        (model for model in models if model.get("name") == "yolo-bird-detector"), None
    )
    details = detector.get("details", {}) if detector is not None else {}
    base_size = details.get("image_size")
    high_resolution = details.get("high_resolution", {})
    if (
        not isinstance(base_size, int)
        or not high_resolution.get("enabled")
        or not isinstance(high_resolution.get("image_size"), int)
        or base_size % 32 != 0
        or high_resolution["image_size"] % 32 != 0
        or high_resolution["image_size"] <= base_size
    ):
        raise TestFailure("云端测试服务没有有效启用高分辨率小目标检测")
    ratio = high_resolution.get("min_image_ratio")
    if not isinstance(ratio, int | float) or not any(
        max(item["width"], item["height"]) >= base_size * ratio for item in prepared
    ):
        raise TestFailure("本批图片没有实际触发云端高分辨率小目标检测")
    return high_resolution


def resolved_frame_count(requested: int, track_confirm_hits: int) -> int:
    return max(requested, 1, track_confirm_hits)


def occurrence_cache_requests(
    prepared: list[dict[str, Any]], args: argparse.Namespace
) -> list[dict[str, Any]]:
    requests: dict[tuple[str, int | None], dict[str, Any]] = {}
    for item in prepared:
        unknown = (
            args.capture_time_precision == "unknown"
            or item["capture_time_source"] == "file_mtime"
        )
        observed_at = datetime.fromisoformat(item["captured_at"])
        key = ("unknown", None) if unknown else ("exact", observed_at.month)
        requests.setdefault(
            key,
            {
                "latitude": args.latitude,
                "longitude": args.longitude,
                "observed_at": item["captured_at"],
                "time_precision": key[0],
            },
        )
    return list(requests.values())


async def prepare_occurrence_caches(
    client: httpx.AsyncClient,
    prepared: list[dict[str, Any]],
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    concurrency = asyncio.Semaphore(2)

    async def prepare(payload: dict[str, Any]) -> dict[str, Any]:
        async with concurrency:
            deadline = time.monotonic() + args.local_candidate_timeout
            while True:
                response = await client.post(
                    "/api/v1/species/occurrence/cache/prepare", json=payload
                )
                if response.status_code != 200:
                    raise TestFailure(
                        f"准备当地候选失败：HTTP {response.status_code} {response.text[:1000]}"
                    )
                result = response.json()
                if result["status"] == "ready":
                    return {**payload, **result}
                if result["status"] == "unavailable":
                    raise TestFailure(
                        f"当地候选准备失败：status={result['status']} "
                        f"source={result.get('source')}"
                    )
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TestFailure(
                        f"等待当地候选超过 {args.local_candidate_timeout} 秒；"
                        "云端 GBIF 首次查询未完成"
                    )
                await asyncio.sleep(min(1.0, remaining))

    return await asyncio.gather(
        *(prepare(payload) for payload in occurrence_cache_requests(prepared, args))
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

            if has_pending_local_candidates(frame_results[-1]):
                raise TestFailure(
                    "缓存预取已完成，但图片分类仍返回 live_occurrence_lookup_pending"
                )
    finally:
        with contextlib.suppress(httpx.HTTPError):
            await client.delete(f"/api/v1/vision/sessions/{session_id}")

    final = frame_results[-1]
    return {
        **item,
        "status": "ok",
        "frame_count": len(frame_results),
        "local_candidate_rechecks": 0,
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
    frame_count = resolved_frame_count(args.frames, int(remote["track_confirm_hits"]))
    frame_delay = max(0.25, 1.0 / float(remote["max_frame_rate"]) + 0.05)
    results: list[dict[str, Any]] = []

    await wait_for_local_service(http_base)
    async with httpx.AsyncClient(
        base_url=http_base,
        headers=auth_headers,
        timeout=120,
        trust_env=False,
    ) as client:
        models_response = await client.get("/api/v1/models")
        if models_response.status_code != 200:
            raise TestFailure(
                f"读取云端模型缓存状态失败：HTTP {models_response.status_code} "
                f"{models_response.text[:1000]}"
            )
        models = models_response.json()
        remote["high_resolution_detector"] = validated_high_resolution_detector(
            models, prepared
        )
        remote["models"] = models
        remote["occurrence_cache_before"] = persistent_occurrence_cache(models)
        cache_requests = occurrence_cache_requests(prepared, args)
        log(f"      正在准备 {len(cache_requests)} 个地区/月度候选缓存键……")
        remote["occurrence_cache_prepared"] = await prepare_occurrence_caches(
            client, prepared, args
        )
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
                    f"确认鸟体={summary['confirmed_bird_count']}，"
                    f"原始轨迹={summary['track_count']}，"
                    f"{description}，"
                    f"候选范围={','.join(scopes) if scopes else '未分类'}"
                )
            except Exception as exc:  # keep the remaining real images testable
                results.append({**item, "status": "error", "error": str(exc)})
                log(f"[{index:02d}/{total:02d}] {name}：错误：{exc}")
        models_response = await client.get("/api/v1/models")
        if models_response.status_code == 200:
            remote["occurrence_cache_after"] = persistent_occurrence_cache(
                models_response.json()
            )
    return results


def aggregate(results: list[dict[str, Any]], preprocessing_errors: list[dict[str, str]]) -> dict[str, Any]:
    successful = [item for item in results if item.get("status") == "ok"]
    failed = [item for item in results if item.get("status") != "ok"]
    detected = [item for item in successful if item["summary"]["track_count"] > 0]
    confirmed = [item for item in successful if item["summary"]["confirmed_bird_count"] > 0]
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
        "images_with_confirmed_birds": len(confirmed),
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
        "raw_track_count",
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
            first_track = next(
                (track for track in summary["tracks"] if track["track_state"] == "confirmed"),
                summary["tracks"][0] if summary["tracks"] else {},
            )
            ranked = first_track.get("top_candidates") or []
            top = ranked[0] if ranked else {}
            writer.writerow(
                {
                    "image": item["source_relative"],
                    "status": "ok",
                    "track_count": summary["track_count"],
                    "raw_track_count": summary["raw_track_count"],
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


def detection_badge(summary: dict[str, Any]) -> tuple[str, str]:
    if summary["confirmed_bird_count"]:
        return "确认鸟体", "found"
    if summary["track_count"]:
        return "仅原始检测", "empty"
    return "未检测到鸟体", "empty"


def write_html(path: Path, report: dict[str, Any], results: list[dict[str, Any]]) -> None:
    summary = report["summary"]
    cards: list[str] = []
    for item in results:
        image_relative = os.path.relpath(item["prepared"], path.parent).replace(os.sep, "/")
        source_name = html.escape(item["source_relative"])
        if item.get("status") == "ok":
            details = item["summary"]
            badge, badge_class = detection_badge(details)
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
    <div class="metric"><strong>{summary["images_with_confirmed_birds"]}</strong>确认鸟体</div>
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
        local_port = find_free_local_port()
        log(f"[2/5] 建立并验证到 {args.ssh_host} 的 SSH 控制连接……")
        ssh.connect(local_port, args.remote_port)
        log(f"      正在通过已验证连接同步后端代码到 {args.ssh_host}……")
        sync_backend(args, ssh)
        log("[3/5] 检查并启动云端识别服务；首次加载模型可能需要几分钟……")
        remote = bootstrap_remote(
            ssh,
            args.remote_backend,
            args.remote_venv,
            args.remote_port,
            args.startup_timeout,
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
            f"确认鸟体 {summary['images_with_confirmed_birds']} 张；"
            f"原始检测轨迹 {summary['images_with_bird_detections']} 张；"
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
