#!/usr/bin/env bash
# Publica la landing (site/ + capturas de docs/img) en cerostation:/srv/www/zcord → https://zcord.gonzalorocca.com
# Cloudflare cachea css/img unas horas e ignora el query string: si cambia una imagen, cambiale el nombre.
set -euo pipefail
cd "$(dirname "$0")/.."
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/img"
cp site/index.html "$stage/"
cp docs/img/zcord.gif docs/img/voz.png docs/img/saltar.png docs/img/og.png "$stage/img/"
ssh -o ConnectTimeout=5 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 minipc 'rm -rf /tmp/zcord-site && mkdir -p /tmp/zcord-site'
scp -q -r "$stage"/. minipc:/tmp/zcord-site/
ssh -o ConnectTimeout=5 minipc 'sudo -n mkdir -p /srv/www/zcord && sudo -n cp -r /tmp/zcord-site/. /srv/www/zcord/ && sudo -n chown -R www-data:www-data /srv/www/zcord && rm -rf /tmp/zcord-site && ls -la /srv/www/zcord /srv/www/zcord/img'
