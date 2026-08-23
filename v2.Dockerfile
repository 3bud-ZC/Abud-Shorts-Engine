FROM abud-shorts-engine:dev

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/piper \
  && /opt/piper/bin/pip install --no-cache-dir piper-tts==1.7.0

RUN mkdir -p /tmp/pg-install \
  && cd /tmp/pg-install \
  && npm init -y \
  && npm install pg@8.23.0 google-auth-library@11.0.2 --omit=dev \
  && cp -R node_modules/* /app/node_modules/ \
  && rm -rf /tmp/pg-install

COPY dist /app/dist
COPY static /app/static

ENV DATA_DIR_PATH=/app/data
ENV DOCKER=true
ENV WHISPER_MODEL=small
ENV KOKORO_MODEL_PRECISION=q4
ENV PIPER_BIN=/opt/piper/bin/piper
ENV PIPER_AR_VOICE_ID=ar_JO-kareem-medium
ENV PIPER_AR_MODEL_PATH=/app/data/models/piper/ar_JO-kareem-medium.onnx
ENV PIPER_AR_MODEL_CONFIG_PATH=/app/data/models/piper/ar_JO-kareem-medium.onnx.json
ENV PIPER_AR_LENGTH_SCALE=1.50
ENV PIPER_AR_SENTENCE_SILENCE=0.25
ENV PIPER_AR_MODEL_LICENSE=MIT
ENV PIPER_AR_RUNTIME_LICENSE=GPL-3.0-or-later
ENV PIPER_AR_MODEL_COMMERCIAL_USE=allowed
ENV CONCURRENCY=1
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000

CMD ["pnpm", "start"]
