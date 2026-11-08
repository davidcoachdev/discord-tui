#!/usr/bin/env bash
# Spike Go Live (2026-11-08): qué herramientas de captura hay y si alguna saca
# H264 por stdout. Privacidad: todo va a /dev/null, máximo 2 s por prueba, no se
# guarda ni se mira ningún frame. No toca la cuenta ni la red.
#   bash scripts/spike-golive/capture-check.sh
set -u

echo "== herramientas"
for t in ffmpeg grim wf-recorder wl-screenrec gpu-screen-recorder obs gst-launch-1.0; do
  if command -v "$t" >/dev/null; then echo "  $t: $(command -v "$t")"; else echo "  $t: no"; fi
done

echo "== ffmpeg buildconf (lo que importa)"
ffmpeg -hide_banner -buildconf 2>/dev/null | tr ' ' '\n' | grep -E "zmq|x264|x265|vaapi|nvenc|vulkan|libdrm|pipewire|opus" | sed 's/^/  /'
echo "  dispositivos de captura de ffmpeg:"
ffmpeg -hide_banner -devices 2>/dev/null | grep -E "kmsgrab|x11grab|pipewire|wayland" | sed 's/^/   /'

echo "== gpu-screen-recorder"
if command -v gpu-screen-recorder >/dev/null; then
  missing=$(ldd "$(command -v gpu-screen-recorder)" | grep "not found" | awk '{print $1}' | tr '\n' ' ')
  [ -n "$missing" ] && echo "  NO arranca, faltan: $missing" || echo "  libs ok"
fi

echo "== gstreamer pipewiresrc (camino portal)"
gst-inspect-1.0 pipewiresrc >/dev/null 2>&1 && echo "  pipewiresrc: sí" || echo "  pipewiresrc: no"

echo "== wlr-screencopy (sin portal): grim 2 s a /dev/null"
count=0
end=$((SECONDS + 2))
while [ $SECONDS -lt $end ]; do grim -t ppm - >/dev/null 2>&1 && count=$((count + 1)); done
echo "  grim: $count frames en ~2 s"

echo "== grim -> ffmpeg libx264 -> H264 por stdout (a /dev/null), 2 s"
bytes=$(timeout 2 bash -c 'while :; do grim -t ppm - 2>/dev/null || exit; done' \
  | ffmpeg -hide_banner -nostdin -loglevel error -f image2pipe -c:v ppm -framerate 20 -i - \
      -c:v libx264 -preset ultrafast -tune zerolatency -bf 0 -f h264 - 2>/dev/null | wc -c)
echo "  bytes H264 producidos (descartados): $bytes"

if command -v wf-recorder >/dev/null; then
  echo "== wf-recorder -> H264 por stdout (a /dev/null), 2 s"
  bytes=$(timeout 2 wf-recorder -y -c libx264 -m h264 -f /dev/stdout 2>/dev/null | wc -c)
  echo "  bytes: $bytes"
fi
