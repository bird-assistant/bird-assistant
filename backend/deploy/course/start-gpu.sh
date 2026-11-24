#!/usr/bin/env bash
set -euo pipefail
directory=/root/.local/share/bird-personal/deploy/course
config=$directory/gpu-supervisord.conf
bin=/base/mambaforge/bin
if "$bin/supervisorctl" -c "$config" pid | grep -Eq '^[1-9][0-9]*$'; then
    "$bin/supervisorctl" -c "$config" restart vision tunnel
else
    /root/venvs/bird-vision/bin/python - <<'PY'
import os
import signal
import socket
import time
from pathlib import Path

backend = Path('/root/shared-nvme/bird-assistant/backend').resolve()
address = ('127.0.0.1', 8000)
with socket.socket() as probe:
    if probe.connect_ex(address) != 0:
        raise SystemExit(0)
pidfile = backend / 'runtime/cloud-image-test-service.pid'
if not pidfile.is_file():
    raise SystemExit('8000 已有服务，请先确认其启动方式。')
pid = int(pidfile.read_text().strip())
process = Path('/proc') / str(pid)
args = process.joinpath('cmdline').read_bytes().split(b'\0')
pairs = set(zip(args, args[1:]))
if process.joinpath('cwd').resolve() != backend or not {(b'-m', b'bird_vision.cli'), (b'--port', b'8000')} <= pairs:
    raise SystemExit('8000 端口进程与项目测试进程不匹配，请核对。')
os.kill(pid, signal.SIGTERM)
for attempt in range(60):
    with socket.socket() as probe:
        if probe.connect_ex(address) != 0:
            pidfile.unlink(missing_ok=True)
            break
    time.sleep(0.5)
else:
    raise SystemExit('等待原模型服务释放 8000 超时。')
PY
    "$bin/supervisord" -c "$config"
fi
started=$SECONDS
next_report=$SECONDS
while (( SECONDS - started < 480 )); do
    if curl --noproxy '*' --max-time 3 -fs http://127.0.0.1:8000/readyz; then exit 0; fi
    if (( SECONDS >= next_report )); then
        echo "正在等待 GPU 模型就绪，已用时 $((SECONDS - started)) 秒。" >&2
        "$bin/supervisorctl" -c "$config" status vision >&2 || true
        next_report=$((SECONDS + 30))
    fi
    sleep 2
done
echo 'GPU 模型启动超时，最近的进程状态及错误日志如下。' >&2
tail -n 8 /root/.local/share/bird-personal/supervisord.log >&2
"$bin/supervisorctl" -c "$config" tail vision stderr >&2 || true
"$bin/supervisorctl" -c "$config" status
exit 1
