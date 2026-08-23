FROM abud-shorts-engine:dev

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/pyruntime \
  && /opt/pyruntime/bin/pip install --no-cache-dir pillow==12.3.0

RUN mkdir -p /tmp/pg-install \
  && cd /tmp/pg-install \
  && npm init -y \
  && npm install pg@8.23.0 google-auth-library@11.0.2 @fontsource/cairo@5.3.0 --omit=dev \
  && cp -R node_modules/* /app/node_modules/ \
  && rm -rf /tmp/pg-install

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
ENV CONCURRENCY=1
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000

CMD ["pnpm", "start"]
