#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="$PROJECT_ROOT/backend/.venv/bin/python"
TEST_SCRIPT="$PROJECT_ROOT/backend/scripts/test_cloud_images.py"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "错误：没有找到本地后端虚拟环境：$PYTHON_BIN" >&2
  echo "请先在 backend/.venv 中安装项目的开发依赖。" >&2
  exit 2
fi

exec "$PYTHON_BIN" "$TEST_SCRIPT" \
  --region-code CN \
  --latitude 31.8206 \
  --longitude 117.2272 \
  --location-name "合肥" \
  "$@"
