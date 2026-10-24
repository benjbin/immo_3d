#!/bin/sh
# Encodage H.264 de la story : sh encode.sh <dossier des images composées> <sortie.mp4>
FF="${FF:-/private/tmp/claude-501/-Users-benjaminbinet-Desktop-dossier-sans-titre/6b4f8f3c-2011-4e0a-9799-265a2c10864a/scratchpad/venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1}"
"$FF" -y -loglevel error -framerate 30 -i "$1/f%04d.png" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart -an "$2"
