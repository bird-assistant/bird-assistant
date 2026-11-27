#!/usr/bin/env bash
set -eu
marker=$1
shift
if [[ ! -f $marker ]]; then
    if "$@"; then
        exit 0
    else
        status=$?
    fi
    if (( status != 128 + $(kill -l BUS) )); then
        exit "$status"
    fi
    date -Is > "$marker"
fi
echo "视觉服务使用 CPU 恢复模式，SIGBUS 记录位于 $marker" >&2
export CUDA_VISIBLE_DEVICES='' BIRD_VISION_DEVICE=cpu BIRD_VISION_ALLOW_PRODUCTION_CPU=true
export BIRD_VISION_SPECIES_PRECISION=fp32 BIRD_VISION_SPECIES_TEXT_BATCH_SIZE=16
exec "$@"
