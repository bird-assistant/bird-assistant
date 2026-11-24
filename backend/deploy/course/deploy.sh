#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
server=(ssh.exe -T -o StrictHostKeyChecking=yes -o BatchMode=yes root@39.103.59.117)
gpu=(ssh -T -o StrictHostKeyChecking=yes bird-gpu-new)
bundle() {
    tar --exclude=__pycache__ --exclude='*.egg-info' -czf - pyproject.toml src deploy/course
}
case ${1:-gpu} in
    server)
        bundle | "${server[@]}" 'set -e; install -d -m 700 /root/.bird-stage; tar -xzf - -C /root/.bird-stage; bash /root/.bird-stage/deploy/course/install-server.sh'
        ;;
    gpu)
        echo '登录 GPU 容器，提示密码时输入容器平台的 SSH 密码。'
        "${gpu[@]}" 'set -eu
            umask 077
            install -d -m 700 /root/.local/share/bird-personal /root/.config/bird-assistant /root/.ssh
            if [ ! -f /root/.ssh/bird-aliyun ]; then ssh-keygen -q -t ed25519 -N "" -f /root/.ssh/bird-aliyun; fi'
        bundle | "${gpu[@]}" 'tar -xzf - -C /root/.local/share/bird-personal'
        "${gpu[@]}" 'ssh-keygen -y -f /root/.ssh/bird-aliyun' | "${server[@]}" 'bash /opt/bird-assistant/backend/deploy/course/authorize-tunnel.sh'
        "${server[@]}" 'cat /etc/ssh/ssh_host_ed25519_key.pub' | "${gpu[@]}" 'set -eu; umask 077
            read -r kind key rest; test "$kind" = ssh-ed25519
            printf "bird-aliyun %s %s\n" "$kind" "$key" > /root/.config/bird-assistant/aliyun-known-hosts'
        "${server[@]}" '/opt/bird-assistant/venv/bin/python /opt/bird-assistant/backend/deploy/course/configure-business.py gpu-key' | "${gpu[@]}" 'set -eu; umask 077
            read -r key; key=$(printf "%s" "$key" | tr -d "\r"); test "${#key}" = 64
            case "$key" in *[!0-9a-f]*) exit 1;; esac
            printf "%s\n" "$key" > /root/.config/bird-assistant/aliyun-signing-key.tmp
            mv /root/.config/bird-assistant/aliyun-signing-key.tmp /root/.config/bird-assistant/aliyun-signing-key'
        "${gpu[@]}" 'bash /root/.local/share/bird-personal/deploy/course/start-gpu.sh'
        curl --fail --silent --show-error --retry 5 --retry-delay 3 https://api.auroraliu.cn/api/v1/vision/readyz
        ;;
    *) echo '用法：bash deploy.sh server 或 bash deploy.sh gpu' >&2; exit 2 ;;
esac
