FROM abud-shorts-engine:dev

WORKDIR /app

RUN mkdir -p /tmp/pg-install \
  && cd /tmp/pg-install \
  && npm init -y \
  && npm install pg@8.23.0 --omit=dev \
  && cp -R node_modules/* /app/node_modules/ \
  && rm -rf /tmp/pg-install

COPY dist /app/dist
COPY static /app/static

ENV DATA_DIR_PATH=/app/data
ENV DOCKER=true
ENV WHISPER_MODEL=tiny.en
ENV KOKORO_MODEL_PRECISION=q4
ENV CONCURRENCY=1
ENV VIDEO_CACHE_SIZE_IN_BYTES=2097152000

CMD ["pnpm", "start"]
