#!/bin/sh
# Encodage v2 : sh encode-v3.sh <images composées> <sortie.mp4> [crf=18]
FF="${FF:-/private/tmp/claude-501/-Users-benjaminbinet-Desktop-dossier-sans-titre/6b4f8f3c-2011-4e0a-9799-265a2c10864a/scratchpad/venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1}"
"$FF" -y -loglevel error -framerate 30 -color_primaries bt709 -color_trc bt709 -colorspace bt709 -i "$1/f%04d.png" \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -preset slow -crf ${3:-18} -profile:v high -level 4.1 \
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709" -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -movflags +faststart -an "$2"
