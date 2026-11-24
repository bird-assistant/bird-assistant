#!/usr/bin/env bash
set -euo pipefail
campus=(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes ubuntu@49.233.81.227)
gpu=(ssh -T -o StrictHostKeyChecking=yes bird-gpu-new)
key=$("${campus[@]}" 'cat /etc/ssh/ssh_host_ed25519_key.pub')
"${gpu[@]}" "set -eu; umask 077; test -r /root/.ssh/bird-aliyun; read -r kind value rest; test \"\$kind\" = ssh-ed25519; printf 'bird-campus %s %s\\n' \"\$kind\" \"\$value\" > /root/.config/bird-assistant/campus-known-hosts" <<< "$key"
"${gpu[@]}" 'bash -se' <<'GPU'
set -euo pipefail
directory=/root/.local/share/bird-personal/deploy/course
config=$directory/gpu-supervisord.conf
control=/base/mambaforge/bin/supervisorctl
if ! grep -Fxq '[program:campus-tunnel]' "$config"; then
    cp -p "$config" "$config.before-campus"
    cat >> "$config" <<'PROGRAM'

[program:campus-tunnel]
command=/usr/bin/ssh -NT -i /root/.ssh/bird-aliyun -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=bird-campus -o UserKnownHostsFile=/root/.config/bird-assistant/campus-known-hosts -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ConnectTimeout=10 -R 127.0.0.1:18000:127.0.0.1:8000 bird-tunnel@49.233.81.227
autorestart=true
startsecs=3
startretries=5
stopasgroup=true
killasgroup=true
PROGRAM
fi
"$control" -c "$config" reread
"$control" -c "$config" update campus-tunnel
if ! "$control" -c "$config" status campus-tunnel | grep -Eq ' (RUNNING|STARTING) '; then
    "$control" -c "$config" start campus-tunnel
fi
"$control" -c "$config" status campus-tunnel
GPU
"${campus[@]}" 'sudo bash -se' <<'CAMPUS'
set -euo pipefail
project=/opt/bird-assistant/campus-8080
active=/etc/caddy/bird-gpu-upstream.caddy
curl -fsS --retry 15 --retry-connrefused --retry-delay 2 --max-time 4 http://127.0.0.1:18000/readyz >/dev/null
rollback=$(mktemp)
cp -p "$active" "$rollback"
trap 'rm -f "$rollback"' EXIT
install -m 644 "$project/campus-gpu-direct.caddy" "$active"
if ! caddy validate --config /etc/caddy/Caddyfile || ! systemctl reload caddy || ! curl -fsS --max-time 8 --resolve api.auroraliu.cn:8080:127.0.0.1 https://api.auroraliu.cn:8080/api/v1/vision/readyz; then
    cp -p "$rollback" "$active"
    systemctl reload caddy
    exit 1
fi
CAMPUS
