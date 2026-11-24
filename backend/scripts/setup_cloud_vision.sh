#!/usr/bin/env bash
set -euo pipefail

backend=$1
venv=$2
cd -- "$backend"
if [[ ! -x $venv/bin/python ]]; then
  python3 -m venv --system-site-packages "$venv"
fi
python_bin=$venv/bin/python
constraints=$(mktemp)
trap 'rm -f -- "$constraints"' EXIT
python3 - "$constraints" <<'PY'
import sys
from importlib.metadata import version
from pathlib import Path

import torch
import torchvision

if not torch.cuda.is_available():
    raise SystemExit("云镜像的 PyTorch 无法访问 CUDA，请确认 GPU 已分配。")
torchvision.ops.nms(torch.zeros((1, 4), device="cuda"), torch.ones(1, device="cuda"), 0.5)
Path(sys.argv[1]).write_text("".join(f"{name}=={version(name)}\n" for name in ("torch", "torchvision", "numpy")))
print(torch.cuda.get_device_name(), torch.__version__, flush=True)
PY
"$python_bin" -m pip install -c "$constraints" -e '.[gpu]'
"$python_bin" -c 'import torch, torchvision, open_clip, ultralytics, lap, bird_vision.app; torchvision.ops.nms(torch.zeros((1,4), device="cuda"), torch.ones(1, device="cuda"), 0.5)'
[[ -f .env ]] || { echo "请按部署说明配置 $backend/.env" >&2; exit 1; }
