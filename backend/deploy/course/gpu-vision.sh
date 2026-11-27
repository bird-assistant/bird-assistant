#!/usr/bin/env bash
set -eu
runner=$(dirname "$(realpath "${BASH_SOURCE[0]}")")/vision-device-guard.sh
cd /root/shared-nvme/bird-assistant/backend
IFS= read -r BIRD_VISION_MOBILE_SIGNING_KEY < /root/.config/bird-assistant/aliyun-signing-key
[[ $BIRD_VISION_MOBILE_SIGNING_KEY =~ ^[a-f0-9]{64}$ ]]
export BIRD_VISION_MOBILE_SIGNING_KEY BIRD_VISION_DETECTION_HIGH_RESOLUTION_ENABLED=true
export PYTHONPATH=/root/.local/share/bird-personal/src HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
if [[ -r /sys/fs/cgroup/cpu.max ]]; then
    read -r quota period < /sys/fs/cgroup/cpu.max
    if [[ $quota =~ ^[0-9]+$ ]] && (( quota <= period )); then
        export OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
    fi
fi
exec bash "$runner" \
    /root/.local/share/bird-personal/vision-cpu-after-sigbus \
    /root/venvs/bird-vision/bin/python -m bird_vision.cli --host 127.0.0.1 --port 8000 --workers 1
