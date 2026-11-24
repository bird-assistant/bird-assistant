#!/usr/bin/env bash
set -euo pipefail
domain=api.auroraliu.cn
live=/etc/letsencrypt/live/$domain
renewed=false
if ! openssl x509 -in "$live/fullchain.pem" -noout -checkend 2592000 >/dev/null 2>&1; then
    if [[ $(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u) != 39.103.59.117 ]]; then
        echo "等待 $domain 的 A 记录指向 39.103.59.117"
        exit 0
    fi
    certbot certonly --webroot -w /var/www/bird-acme -d "$domain" --cert-name "$domain" \
        --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
    renewed=true
fi
tls=/etc/bird-assistant/nginx/api-tls.conf
candidate=$(mktemp "${tls}.XXXXXX")
backup=$(mktemp)
trap 'rm -f "$candidate" "$backup"' EXIT
printf 'ssl_certificate %s/fullchain.pem;\nssl_certificate_key %s/privkey.pem;\n' "$live" "$live" > "$candidate"
if ! cmp -s "$candidate" "$tls" || [[ $renewed == true ]]; then
    cp -p "$tls" "$backup"
    install -m 644 "$candidate" "$tls"
    if ! nginx -t || ! nginx -s reload; then
        cp -p "$backup" "$tls"
        exit 1
    fi
fi
