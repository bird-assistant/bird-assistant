#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
site_dir=/www/server/panel/vhost/nginx
test -d "$site_dir"
command -v certbot >/dev/null
backend=/opt/bird-assistant/backend
venv=/opt/bird-assistant/venv
install -d "$backend/deploy/course"
cp -R src "$backend/"
install -m 644 pyproject.toml "$backend/"
install -m 644 deploy/course/{configure-business.py,bird-tunnel.sshd,authorize-tunnel.sh,api-certificate.sh} "$backend/deploy/course/"
python3.11 -m venv "$venv"
"$venv/bin/pip" install --disable-pip-version-check "$backend"
"$venv/bin/python" "$backend/deploy/course/configure-business.py" init
if ! id bird-business >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --shell /usr/sbin/nologin bird-business
fi
install -m 644 deploy/course/bird-business.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable bird-business
systemctl restart bird-business
for attempt in {1..15}; do
    if curl -fs http://127.0.0.1:8200/readyz; then break; fi
    sleep 1
done
curl -fsS http://127.0.0.1:8200/readyz >/dev/null
install -d -m 755 /etc/bird-assistant/nginx /var/www/bird-acme/.well-known/acme-challenge
install -m 644 deploy/course/bird-api.nginx /etc/bird-assistant/nginx/bird-api.nginx
if [[ ! -f /etc/bird-assistant/nginx/api-tls.conf ]]; then
    printf 'ssl_reject_handshake on;\n' > /etc/bird-assistant/nginx/api-tls.conf
fi
site=$site_dir/zz-bird-assistant-api.conf
backup=$(mktemp)
trap 'rm -f "$backup"' EXIT
if [[ -f $site ]]; then cp -p "$site" "$backup"; fi
install -m 644 deploy/course/api-site.nginx "$site"
if ! config_test=$(nginx -t 2>&1) || [[ $config_test == *'conflicting server name "api.auroraliu.cn"'* ]] || ! nginx -s reload; then
    printf '%s\n' "$config_test" >&2
    if [[ -s $backup ]]; then cp -p "$backup" "$site"; else rm -f "$site"; fi
    exit 1
fi
install -m 644 deploy/course/bird-api-certificate.{timer,service} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bird-api-certificate.timer
systemctl start bird-api-certificate.service
