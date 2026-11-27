#!/usr/bin/env bash
set -euo pipefail
host=${1:-ubuntu@49.233.81.227}
project=$(cd "$(dirname "$0")/../.." && pwd)
release=$(ssh "$host" 'sudo mktemp -d /opt/bird-assistant/releases/community-XXXXXXXX')
[[ $release =~ ^/opt/bird-assistant/releases/community-[A-Za-z0-9]+$ ]]
tar -C "$project" --exclude=__pycache__ -czf - src/bird_business src/bird_common config/catalog \
  deploy/course/{campus-8080.caddy,community-sync.service,community-sync.timer,admin-credentials.py,configure-trip.py} |
  ssh "$host" "sudo tar -xzf - -C '$release' && sudo chmod 755 '$release'"
ssh "$host" "sudo bash -se -- '$release'" <<'REMOTE'
set -euo pipefail
release=$1
root=/opt/bird-assistant
site=/etc/caddy/bird-course.caddy
drop=/etc/systemd/system/bird-business.service.d/90-community.conf
backup=/var/backups/bird-business/$(basename "$release")
install -d -m 700 "$backup"
cp -p "$site" "$backup/site"
test ! -f "$drop" || cp -p "$drop" "$backup/drop"
old=$(readlink "$root/community-current" || true)
umask 077
python3 - "$backup/observations.sqlite3" <<'PY'
import sqlite3, sys
with sqlite3.connect('file:/var/lib/bird-business/observations.sqlite3?mode=ro',uri=True) as source, sqlite3.connect(sys.argv[1]) as backup:
    source.backup(backup)
PY
umask 022
rollback() {
  cp -p "$backup/site" "$site"
  if [[ -e $backup/drop ]]; then cp -p "$backup/drop" "$drop"; else rm -f "$drop"; fi
  if [[ -n $old ]]; then ln -sfnT "$old" "$root/community-current"; else rm -f "$root/community-current"; fi
  systemctl daemon-reload && systemctl restart bird-business && systemctl reload caddy
}
trap rollback ERR
ln -sfnT "$release" "$root/community-current"
python3 "$release/deploy/course/admin-credentials.py"
printf '[Service]\nEnvironment=PYTHONPATH=%s/src\nEnvironmentFile=/etc/bird-assistant/admin.env\nEnvironmentFile=-/etc/bird-assistant/trip.env\nEnvironmentFile=-/etc/bird-assistant/writing.env\n' "$release" > "$drop"
install -m 644 "$release/deploy/course/campus-8080.caddy" "$site"
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl daemon-reload
systemctl restart bird-business
curl --retry 12 --retry-delay 1 --retry-all-errors -fsS 'http://127.0.0.1:8200/api/v1/species?limit=1' -o /dev/null
systemctl reload caddy
curl --resolve api.auroraliu.cn:8080:127.0.0.1 -fsS 'https://api.auroraliu.cn:8080/api/v1/species?limit=1' -o /dev/null
curl --resolve api.auroraliu.cn:8080:127.0.0.1 -fsS 'https://api.auroraliu.cn:8080/admin/' -o /dev/null
test "$(curl --resolve api.auroraliu.cn:8080:127.0.0.1 -sS -o /dev/null -w '%{http_code}' https://api.auroraliu.cn:8080/admin/queue)" = 401
trap - ERR
install -m 644 "$release/deploy/course/community-sync.service" /etc/systemd/system/
install -m 644 "$release/deploy/course/community-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now community-sync.timer
systemctl start --no-block community-sync.service
printf 'Release %s\nBackup %s\n' "$release" "$backup"
REMOTE
