# The runtime layer on top of the base image.
#
# BASE_IMAGE is an argument so the same Dockerfile serves both paths: a
# developer builds abud-shorts-engine:dev locally and gets the default, while
# the release workflow builds the base in CI and passes its tag in. Without
# this, the published image could not be reproduced outside one machine.
ARG BASE_IMAGE=abud-shorts-engine:dev
FROM ${BASE_IMAGE}

WORKDIR /app

# Quality CPU runtime. opencv-python-headless keeps the image free of GUI
# libraries; PySceneDetect and librosa power real shot detection and beat
# analysis rather than the deterministic fallbacks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates fontconfig \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/pyruntime \
  && /opt/pyruntime/bin/pip install --no-cache-dir \
       pillow==12.3.0 \
       "numpy<2" \
       opencv-python-headless==4.10.0.84 \
       scenedetect==0.6.4 \
       librosa==0.10.2.post1 \
       fonttools==4.53.1

RUN mkdir -p /tmp/pg-install \
  && cd /tmp/pg-install \
  && npm init -y \
  && npm install pg@8.23.0 google-auth-library@11.0.2 @fontsource/cairo@5.3.0 --omit=dev \
  && cp -R node_modules/* /app/node_modules/ \
  && rm -rf /tmp/pg-install

# Bundled OFL Arabic caption fonts. Installed into the system font path so
# fontconfig - and therefore libass - resolves them by family name. No font is
# ever fetched over the network at render time.
COPY assets/fonts /usr/share/fonts/truetype/abud
COPY scripts/instance_fonts.py /opt/abud/instance_fonts.py
RUN /opt/pyruntime/bin/python /opt/abud/instance_fonts.py /usr/share/fonts/truetype/abud \
  && fc-cache -f /usr/share/fonts/truetype/abud \
  && fc-list : family | sort -u | head -40

COPY dist /app/dist
COPY static /app/static

ENV DATA_DIR_PATH=/app/data
ENV DOCKER=true
ENV WHISPER_MODEL=small
ENV KOKORO_MODEL_PRECISION=q4
# Arabic narration is produced by ElevenLabs (configured from the app UI), so the
# Piper Arabic TTS runtime and its ~63 MB voice model are no longer part of the
# image. Historical Piper jobs stay readable; re-rendering one requires the
# optional PIPER_* variables to be supplied by the operator.
ENV PYTHON_BIN=/opt/pyruntime/bin/python
ENV ABUD_FONT_DIR=/usr/share/fonts/truetype/abud
# Optional CPU quality packs are present in this image, so the pipeline may use
# real scene detection and beat analysis instead of deterministic fallbacks.
ENV QUALITY_RUNTIME_ENABLED=true
ENV SCENE_DETECTION_ENABLED=true
ENV BEAT_ANALYSIS_ENABLED=true
ENV CONCURRENCY=1
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000

CMD ["pnpm", "start"]
