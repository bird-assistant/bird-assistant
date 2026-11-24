#!/usr/bin/env bash
set -eu
key=/root/.ssh/bird-aliyun
config=/root/.config/bird-assistant
while true; do
    ssh -NT -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="$config/aliyun-known-hosts" -o HostKeyAlias=bird-aliyun \
        -o ConnectTimeout=10 -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
        -p 22 -i "$key" -R 127.0.0.1:18000:127.0.0.1:8000 bird-tunnel@39.103.59.117 || true
    sleep 5
done
