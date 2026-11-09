#!/usr/bin/env bash
# Mide la demo de zcord en una terminal virtual de 160x45: memoria (PSS) y CPU en reposo. Uso:
#   scripts/measure.sh dev        (bun scripts/demo.tsx, con el preload de Babel)
#   scripts/measure.sh build      (dist/scripts/demo.js, ya compilado)
set -eu
cd "$(dirname "$0")/.."
mode="${1:-build}"; settle="${SETTLE:-8}"; window="${WINDOW:-20}"
if [ "$mode" = dev ]; then cmd="bun scripts/demo.tsx"; pat="scripts/demo.tsx"
elif [ "$mode" = smol ]; then cmd="cd dist && bun --smol scripts/demo.js"; pat="scripts/demo.js"
else cmd="cd dist && bun scripts/demo.js"; pat="scripts/demo.js"; fi
( sleep 3600 | TERM=xterm-256color script -qfc "stty cols 160 rows 45; $cmd" /dev/null >/dev/null 2>&1 ) &
wrapper=$!
sleep "$settle"
pid=$(pgrep -f "bun .*$pat" | while read -r p; do [ "$(cat /proc/$p/comm)" = bun ] && echo "$p"; done | head -1)
[ -n "$pid" ] || { echo "no encontré el proceso"; kill $wrapper 2>/dev/null; exit 1; }
tick=$(getconf CLK_TCK)
read -r -a f < /proc/$pid/stat; a=$((f[13] + f[14])); sleep "$window"; read -r -a f < /proc/$pid/stat; b=$((f[13] + f[14]))
pss=$(awk '/^Pss:/{print $2}' /proc/$pid/smaps_rollup)
awk -v m="$mode" -v p="$pss" -v a="$a" -v b="$b" -v t="$tick" -v w="$window" -v h="$(ls /proc/$pid/task | wc -l)" \
  'BEGIN { printf "%s  pss=%.1f MB  cpu=%.2f %%  hilos=%s\n", m, p / 1024, (b - a) * 100 / t / w, h }'
kill "$pid" 2>/dev/null; sleep 0.5; kill -9 "$pid" 2>/dev/null || true; pkill -P $wrapper 2>/dev/null; kill $wrapper 2>/dev/null || true; pkill -f "sleep 3600" 2>/dev/null || true
