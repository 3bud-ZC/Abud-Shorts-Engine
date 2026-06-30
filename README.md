# Abud Shorts Engine

A local-first, open-source Docker tool for generating branded short videos. Use templates, text-to-speech, automatic captions, Pexels background footage, and background music to produce downloadable MP4s ready for TikTok, Reels, and YouTube Shorts.

## What is Abud Shorts Engine?

Abud Shorts Engine is a self-contained short-video generator that runs on your own machine with Docker.

It is built for creators, marketers, and developers who want to automate short-form content without relying on cloud APIs or paid services. It is **local-first** and **Docker-based**, so your data stays on your machine.

What it does:

- Lets you choose a business template (Product Ad, Restaurant Offer, Real Estate Listing, Educational Tip, Viral Curiosity).
- Generates a branded script, narration, and captions.
- Synthesizes speech with Kokoro TTS.
- Finds background footage from Pexels.
- Composes scenes, captions, watermark, music, and outro with Remotion.
- Renders a downloadable MP4 video.
- Stores a metadata sidecar JSON file next to every video.

The project is intentionally simple to run: clone, copy the environment file, add a Pexels API key, and start the container.

## Features

- Business templates:
  - Product Ad
  - Restaurant Offer
  - Real Estate Listing
  - Educational Tip
  - Viral Curiosity
- Brand Kit with brand name, watermark, colors, caption style, outro text, and contact text.
- Browser-local Brand profiles.
- Template field persistence and Brand Kit saved in browser localStorage.
- Generated video list with status, size, duration, and output path hints.
- Video preview and detail pages with narration, Pexels terms, and metadata.
- Readable download filenames, e.g. `abud-short-product-ad-abud-store-<videoId>.mp4`.
- Metadata sidecar JSON with template, brand, narration, Pexels terms, and delivery info.
- Local output folder for direct access to all generated files.
- Docker-only workflow for Windows users.

## Tech Stack

- React + TypeScript + Vite
- MUI (Material UI)
- Node.js + Express
- Zod validation
- Remotion (video composition)
- FFmpeg (audio/video processing)
- Kokoro TTS (text-to-speech)
- Whisper.cpp (caption generation)
- Pexels API (background footage)
- Docker + Docker Compose
- pnpm (package management)
- Vitest (testing)

## Requirements

- Docker Desktop installed and running
- A free Pexels API key from https://www.pexels.com/api/
- Git
- At least 4 GB RAM recommended (3 GB minimum)
- At least 2 vCPU
- At least 5 GB free disk space
- Windows users must use Docker; native Windows execution is not supported

## Quick Start

Clone the repository:

```bash
git clone https://github.com/3bud-ZC/Abud-Shorts-Engine.git
cd Abud-Shorts-Engine
```

Copy the environment template and add your Pexels API key:

```bash
cp .env.example .env
```

Edit `.env` and set:

```text
PEXELS_API_KEY=your_pexels_api_key_here
```

Build and start the dev container:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Open the Web UI:

```text
http://localhost:3124
```

The original/reference app, if running, remains on `http://localhost:3123` and is untouched.

## Environment Variables

Copy `.env.example` to `.env` and configure only the values you need to change.

| Variable | Description | Default |
| --- | --- | --- |
| `PEXELS_API_KEY` | Your Pexels API key (required for real renders) | `your_pexels_api_key_here` |
| `LOG_LEVEL` | Server log level (pino) | `info` |
| `PORT` | Port the server listens on | `3123` |
| `DATA_DIR_PATH` | Data directory inside the container | `/app/data` |
| `DOCKER` | Whether the app is running inside a container | `true` |
| `DEV` | Development mode flag | `false` |
| `WHISPER_MODEL` | Whisper.cpp model used for captions | `tiny.en` |
| `KOKORO_MODEL_PRECISION` | Kokoro TTS model precision | `q4` |
| `CONCURRENCY` | How many Chrome tabs render in parallel | `1` |
| `VIDEO_CACHE_SIZE_IN_BYTES` | Remotion offthread video cache size | `2097152000` |
| `WHISPER_VERBOSE` | Forward Whisper output to stdout | `false` |

`.env.example` contains placeholders only. Never commit your real `.env`.

## Local Output Files

Inside the container, completed videos are written to:

```text
/app/data/videos
```

On Windows, the container mounts that path to:

```text
C:/abud-shorts-engine/data-dev/videos
```

Each completed render may produce:

```text
<videoId>.mp4
<videoId>.metadata.json
```

The metadata sidecar stores:

- template and brand info
- narration lines
- Pexels search terms
- output filename
- container and host path hints
- download and preview URLs

You can read, copy, or back up these files directly from the host folder.

## How Downloads Work

The generated video is available immediately from the UI.

- On the **Generated Videos** page, click **Download** next to a ready video.
- On the **Video Details** page, click **Download** or **Preview**.
- The download endpoint uses a readable filename when the template and brand are known.

Example:

```text
abud-short-product-ad-abud-store-<videoId>.mp4
```

If no template or brand was set, a safe fallback filename is used.

## Useful Commands

Start the dev container:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

View recent logs:

```bash
docker logs --tail=200 abud-shorts-engine-dev
```

Check health:

```bash
curl http://localhost:3124/health
```

Stop the container:

```bash
docker compose -f docker-compose.dev.yml down
```

Run tests:

```bash
pnpm vitest run
```

Build the UI:

```bash
pnpm build
```

## n8n Automation + Optional YouTube Upload

Abud Shorts Engine ships with an official n8n workflow template. You can use it to generate videos automatically and optionally upload them to YouTube.

- YouTube upload is **optional** and **disabled by default**.
- The workflow uses a safe default privacy status of `private`.
- You must reconnect your own n8n credentials after importing the workflow.

Workflow file:

```text
integrations/n8n/abud-shorts-youtube-workflow.json
```

Documentation:

```text
docs/n8n-youtube-automation.md
```

### How the workflow connects

The workflow needs to reach the engine from n8n. Set `SERVER_URL` in the **Configure** node:

| n8n setup | Recommended `SERVER_URL` |
| --- | --- |
| n8n local (not Docker) | `http://localhost:3124` |
| n8n in Docker Desktop | `http://host.docker.internal:3124` |
| n8n cloud / remote | Local engine is not reachable unless deployed or tunneled |

### Important notes

- The workflow file contains placeholder credential references. You must reconnect your own Gemini and YouTube OAuth2 credentials in n8n after importing.
- Keep `AUTO_UPLOAD_TO_YOUTUBE` on `false` until you want to enable uploads.
- Keep YouTube videos `private` or `unlisted` until you manually review them.
- Do not commit n8n credentials, generated videos, or metadata sidecars.

## Project Structure

```text
src/
  ui/           # React frontend pages and components
  server/       # Express routes, REST API, metadata helpers
  short-creator/# Remotion scenes, templates, Pexels, TTS, rendering
  types/        # Shared TypeScript types
  components/   # Shared React components
  config.ts     # Environment configuration
  index.ts      # Server entry point

integrations/n8n/       # n8n workflow templates
docs/                   # Documentation

docker-compose.dev.yml  # Local Docker Compose setup
main-tiny.Dockerfile    # Docker image for local dev
README.md               # This file
.env.example           # Environment template
```

## Current Status

- Local open-source release ready.
- Render QA passed (one Product Ad render completed successfully).
- All tests passed.
- Build passed.
- Docker health checks passed.
- Production VPS/domain/Nginx deployment is deferred and not part of this release.

## Known Limitations

- English TTS only. Kokoro does not currently support other languages.
- Background footage depends on the Pexels API and its quota/rate limits.
- Docker build can take some time on the first run.
- Brand profiles are stored in browser localStorage only (per-browser, not multi-user).
- Watermark is text-only; logo image upload is not implemented yet.
- ZIP export of video + metadata is deferred.
- Production deployment is not part of the current release.

## Roadmap

Planned optional improvements:

- ZIP export for video + metadata
- Logo image upload in Brand Kit
- Better render progress and queue UI
- More caption styles
- Curated Pexels cache
- More business templates
- Optional production deployment later (VPS/Nginx remains deferred)

## Security Notes

- Never commit `.env` or any file containing real API keys.
- `.env.example` contains placeholders only.
- Generated videos and metadata sidecars should stay local.
- If you ever accidentally commit a secret, rotate the key immediately and remove it from the repository history.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgments

- Remotion for programmatic video generation
- Whisper.cpp for speech-to-text
- Pexels for video content
- FFmpeg for audio/video processing
- Kokoro for text-to-speech
