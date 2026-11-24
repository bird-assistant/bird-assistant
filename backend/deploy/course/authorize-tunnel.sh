#!/usr/bin/env bash
set -euo pipefail
read -r kind pubkey rest
[[ $kind == ssh-ed25519 && $pubkey =~ ^[A-Za-z0-9+/]+=*$ ]]
if ! id bird-tunnel >/dev/null 2>&1; then
    useradd --system --user-group --create-home --home-dir /var/lib/bird-tunnel --shell /usr/sbin/nologin bird-tunnel
fi
base=/etc/ssh/sshd_config
marker='# bird-assistant tunnel account'
if ! grep -qxF "$marker" "$base"; then
    candidate=$(mktemp /etc/ssh/sshd_config.bird.XXXXXX)
    trap 'rm -f "$candidate"' EXIT
    cp -p "$base" "$candidate"
    printf '\n%s\n' "$marker" >> "$candidate"
    cat "$(dirname "$0")/bird-tunnel.sshd" >> "$candidate"
    /usr/sbin/sshd -t -f "$candidate"
    effective=$(/usr/sbin/sshd -T -f "$candidate" -C user=bird-tunnel,host=localhost,addr=127.0.0.1)
    grep -qx 'maxsessions 0' <<< "$effective"
    grep -qx 'allowtcpforwarding remote' <<< "$effective"
    grep -qx 'permitlisten 127.0.0.1:18000' <<< "$effective"
    if [[ ! -f $base.before-bird ]]; then cp -p "$base" "$base.before-bird"; fi
    mv "$candidate" "$base"
fi
systemctl reload sshd
directory=/var/lib/bird-tunnel/.ssh
install -d -m 700 -o bird-tunnel -g bird-tunnel "$directory"
entry="restrict,port-forwarding,permitlisten=\"127.0.0.1:18000\" $kind $pubkey"
authorized=$directory/authorized_keys
touch "$authorized"
chmod 600 "$authorized"
chown bird-tunnel:bird-tunnel "$authorized"
grep -qxF "$entry" "$authorized" || printf '%s\n' "$entry" >> "$authorized"
