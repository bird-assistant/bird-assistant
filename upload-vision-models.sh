#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

yolo_sha=9ebd0e09d59811db4b1d61e2bc6730649608b1ac47f8dd01e2da6bca7c20023f
bioclip_sha=29bac58b858900b344946aca3b401657bb4bd0911cc94911f9cd8e59ea12e282
source_dir=${BIRD_MODEL_SOURCE:-"$HOME/bird-model-staging"}

usage() {
  cat <<'EOF'
用法（在本机 Linux / WSL 上运行）
  ./upload-vision-models.sh [-p SSH端口] [用户@]主机 云端模型目录绝对路径
  ./upload-vision-models.sh --check-local

示例
  ./upload-vision-models.sh -p 2222 root@gpu.example.com /mnt/data/models
  ./upload-vision-models.sh bird-gpu-new /root/shared-nvme/models

本地默认读取 ~/bird-model-staging，可通过 BIRD_MODEL_SOURCE 指定其他备份目录。
校验需要 Bash 和 GNU coreutils。传输需要两端安装 rsync 3.1+。中断后可用同一命令续传。
EOF
}

bioclip_files() {
  local file
  shopt -s nullglob dotglob
  for file in bioclip-2/*; do
    [[ -f $file ]] || continue
    case "$file" in
      *.bin|*.pth|*.safetensors|*.json|*.txt|*.model|*.gz|*.bpe) printf '%s\0' "$file" ;;
    esac
  done
}

verify_bundle() (
  cd -- "$1"
  printf '%s  yolo/yolo11l.pt\n' "$yolo_sha" | sha256sum --check -
  local fingerprint file
  fingerprint=$(bioclip_files | while IFS= read -r -d '' file; do
    printf '%s\0' "${file#bioclip-2/}"
    cat -- "$file" || exit 1
  done | sha256sum)
  if [[ ${fingerprint%% *} != "$bioclip_sha" ]]; then
    echo "BioCLIP 2 指纹不符，请检查 $PWD/bioclip-2 下的权重、配置和分词文件。" >&2
    exit 1
  fi
  echo 'BioCLIP 2: OK'
)

if [[ $# == 1 && $1 == --check-local ]]; then
  verify_bundle "$source_dir"
  exit 0
fi
if [[ ${1:-} == --help ]]; then usage; exit 0; fi
ssh_cmd=(ssh)
while getopts ':p:h' option; do
  case "$option" in
    p)
      if [[ ! $OPTARG =~ ^[0-9]{1,5}$ ]] || (( 10#$OPTARG < 1 || 10#$OPTARG > 65535 )); then
        echo 'SSH 端口应为 1 到 65535。' >&2; exit 2
      fi
      ssh_cmd+=(-p "$OPTARG") ;;
    h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
shift "$((OPTIND - 1))"
if [[ $# != 2 || ! $1 =~ ^[[:alnum:]_][[:alnum:]_.@-]*$ || $2 != /* || $2 == *[[:cntrl:]]* ]]; then
  usage >&2
  exit 2
fi
host=$1
remote_dir=${2%/}
[[ -n $remote_dir ]] || { echo '请指定数据盘上的模型子目录。' >&2; exit 2; }
quoted_dir="'${remote_dir//\'/\'\\\'\'}'"

echo "校验本机模型 $source_dir"
cd -- "$source_dir"
verify_bundle .
echo "正在连接 $host，检查云端模型目录 $remote_dir"
if "${ssh_cmd[@]}" "$host" "command -v rsync >/dev/null || exit 42; mkdir -p -- $quoted_dir"; then
  echo "上传到 $host:$remote_dir"
  { printf 'yolo/yolo11l.pt\0'; bioclip_files; } |
    rsync -rLs --checksum --partial-dir=.rsync-partial --info=progress2 \
      --from0 --files-from=- -e "${ssh_cmd[*]}" -- ./ "$host:$remote_dir/"
else
  status=$?
  case $status in
    42) echo 'SSH 登录成功。云端缺少 rsync，检查指定目录中已有的模型。' ;;
    255) echo "SSH 登录或连接失败，请在本机终端运行 ssh $host 并查看登录提示。" >&2; exit "$status" ;;
    *) echo "云端目录准备失败（退出码 $status），请检查 $remote_dir 的路径和写权限。" >&2; exit "$status" ;;
  esac
fi

echo '校验云端模型'
{
  printf 'set -euo pipefail\nexport LC_ALL=C\n'
  declare -p yolo_sha bioclip_sha
  declare -f bioclip_files verify_bundle
  printf 'verify_bundle "$1"\n'
} | "${ssh_cmd[@]}" "$host" "bash -s -- $quoted_dir" || {
  status_verify=$?
  if [[ ${status:-0} == 42 && $status_verify != 255 ]]; then
    echo '请确认参数指向实际的共享盘模型目录。如需上传，在 Ubuntu 容器内以 root 运行 apt-get update && apt-get install -y rsync 后重试。' >&2
  fi
  exit "$status_verify"
}

dotenv_dir=${remote_dir//\\/\\\\}
dotenv_dir=${dotenv_dir//\'/\\\'}
cat <<EOF
云端模型校验通过。以下配置可用于云端 backend/.env：
BIRD_VISION_MODEL_PATH='$dotenv_dir/yolo/yolo11l.pt'
BIRD_VISION_MODEL_SHA256=$yolo_sha
BIRD_VISION_BIOCLIP_MODEL='local-dir:$dotenv_dir/bioclip-2'
BIRD_VISION_BIOCLIP_MODEL_REVISION=
BIRD_VISION_BIOCLIP_EXPECTED_FINGERPRINT=$bioclip_sha
EOF
