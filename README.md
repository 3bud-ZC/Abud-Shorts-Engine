# ABUD Shorts Engine V2

**Version:** `2.0.0-rc.1` (Release Candidate)  
**Canonical URL:** `http://localhost:3130`  
**License:** MIT  

An enterprise-grade, local-first video generation, multi-platform publishing, and distribution engine for YouTube Shorts, Instagram Reels, TikTok, and Telegram.

---

## Quick Start (One-Command Installer)

### Windows (PowerShell)
```powershell
.\install.ps1
```

### Linux / macOS (Bash)
```bash
chmod +x install.sh
./install.sh
```

The installer automatically verifies Docker, creates persistent directories, generates cryptographically secure secrets (`INTERNAL_SERVICE_TOKEN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `SESSION_SECRET`), starts the 4-container stack, runs database migrations, and opens the First-Run Setup Wizard at:
$$\text{http://localhost:3130/setup}$$

---

## Key Architecture & Features

- **Prompt Studio & Template Mode**: AI Creative Director with Egyptian Arabic, Gulf, MSA, and English scriptwriting.
- **Production Spec V2**: Strict duration enforcement (variance $\le 0.3\%$), multi-scene timeline, multi-asset scenes, motion presets, dynamic transitions, and RTL captions.
- **Free-First Local Pipeline**: 100% functional without paid AI subscriptions (Local Director, Pexels footage, Kokoro TTS, Whisper subtitles, Remotion composition, FFmpeg rendering).
- **Multi-Platform Publishing Engine**: Aggregated publishing (Upload-Post), direct bot publishing (Telegram), and direct extension points (YouTube Shorts, Meta Reels, TikTok) with idempotency, atomic background scheduler, partial failure isolation, and live SSE event streams.
- **Local Admin Security**: Salted PBKDF2 password hashing, session lifecycle, security headers (CSP, X-Frame-Options, X-Content-Type-Options), rate limiting, and zero secret leakage.
- **Backup & Disaster Recovery**: User-triggered backups (`config_only`, `config_db`, `full`), SHA256 checksum manifests, automated pre-restore safety snapshots, and staged restore.
- **Diagnostics & Support**: System telemetry, storage breakdown, secret-redacted real-time logs, and one-click Diagnostic Bundle export.
- **Maintenance & Upgrades**: `upgrade.ps1`/`upgrade.sh` with automated pre-upgrade backups, `uninstall.ps1`/`uninstall.sh` preserving media by default.
- **Outbound Webhooks**: Event dispatching (`video.ready`, `video.failed`, `publication.published`, `publication.failed`) with HMAC-SHA256 signatures (`x-abud-signature`, `x-abud-timestamp`).
- **Remote Deployment**: Production reference `nginx.conf.reference` supporting reverse proxy, WebSocket, SSE, and media byte-range streaming.

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

Build and start the V2 stack:

```bash
docker compose -f docker-compose.v2.yml up -d --build
```

Open the Web UI:

```text
http://localhost:3130
```

Check system health:

```bash
curl http://localhost:3130/api/v2/system/health
```

Create the first video from **Create Video**, track it in **Jobs**, then preview or download the MP4 from **Videos**.

## V2 Control Plane

Milestone V2-01 adds a dashboard-led control plane:

- Web dashboard at `http://localhost:3130`
- PostgreSQL-backed jobs and job events
- Internal n8n orchestration
- Separate render-worker service using the existing Remotion, FFmpeg, Kokoro, Whisper, and Pexels pipeline
- Server-sent job progress events
- Backward-compatible video library over the existing video folder
- Persistent brand profiles, template browser, provider validation, and structured system health

Start V2:

```bash
docker compose -f docker-compose.v2.yml up -d --build
```

Open:

```text
http://localhost:3130
```

Stop V2:

```bash
docker compose -f docker-compose.v2.yml down
```

V2 services:

| Service | Responsibility | Public port |
| --- | --- | --- |
| `abud-shorts-app` | Dashboard, public API, internal job API, migrations | `3130` |
| `abud-shorts-render-worker` | Local/free rendering pipeline | none |
| `abud-shorts-n8n` | Internal orchestration workflow | none |
| `abud-shorts-postgres` | Persistent V2 jobs/settings/assets | none |

The V2 compose network provides internal DNS aliases: `app`, `render-worker`, `n8n`, and `postgres`. V2 service-to-service calls do not use `host.docker.internal`.

The V2 n8n bootstrap imports `abud-shorts-v2-control-plane-workflow.json`, activates it, publishes it, and then starts n8n. This n8n image still exposes workflow activation through the deprecated `update:workflow --active=true` CLI; `publish:workflow` registers the production version but does not provide an activation flag in this installed n8n version.

### V2 first run

1. Copy `.env.example` to `.env`.
2. Set `PEXELS_API_KEY`.
3. Replace `INTERNAL_SERVICE_TOKEN`, `POSTGRES_PASSWORD`, and `N8N_ENCRYPTION_KEY` with local secret values.
4. Start V2 with `docker compose -f docker-compose.v2.yml up -d --build`.
5. Check health at `http://localhost:3130/api/v2/system/health`.
6. Create the first video from **Create Video**.
7. Track progress in **Jobs**.
8. Preview or download the completed MP4 from **Videos**.

### V2 database migration

The app runs the minimum V2 PostgreSQL migration on startup. It creates:

- `jobs`
- `job_events`
- `app_settings`
- `provider_settings`
- `generated_assets`
- `brands`

If PostgreSQL is unavailable, the dashboard starts degraded and `/api/v2/system/health` reports the database as unhealthy.

### V2 Pexels configuration

`PEXELS_API_KEY` is read server-side only. The frontend receives only configured/missing state and never receives the key value or key suffix.

If the key is missing, V2 still starts and reports Pexels as unhealthy. Video generation requires a valid key.

Use **Providers** or `POST /api/v2/providers/pexels/validate` to validate the configured key. The response distinguishes `healthy`, `not_configured`, `invalid_credentials`, `rate_limited`, `timeout`, and `provider_unavailable` states without returning the secret. Validation is bounded by `PEXELS_VALIDATION_TIMEOUT_MS`, which defaults to `12000` ms so slower live Pexels responses do not falsely fail while still preventing application hangs.

### V2 generated videos

V2 uses the existing mounted video storage:

```text
/app/data/videos
C:/abud-shorts-engine/data-dev/videos
```

Existing MP4 files and metadata sidecars remain visible in the V2 Videos Library even if they do not have PostgreSQL job records.

## Environment Variables

Copy `.env.example` to `.env` and configure only the values you need to change.

| Variable | Description | Default |
| --- | --- | --- |
| `PEXELS_API_KEY` | Your Pexels API key (required for real renders) | `your_pexels_api_key_here` |
| `PEXELS_VALIDATION_TIMEOUT_MS` | Bounded timeout for live Pexels validation and health checks | `12000` |
| `INTERNAL_SERVICE_TOKEN` | Shared secret for trusted app, n8n, and render-worker calls (generate with `openssl rand -hex 32`) | required (no default) |
| `DATABASE_URL` | PostgreSQL connection string inside V2 containers | compose-managed |
| `POSTGRES_DB` | V2 database name | `abud_shorts` |
| `POSTGRES_USER` | V2 database user | `abud_shorts` |
| `POSTGRES_PASSWORD` | V2 database password | `change-me-v2-postgres` |
| `N8N_ENCRYPTION_KEY` | n8n encryption key | `change-me-v2-n8n-encryption-key-32` |
| `N8N_BASE_URL` | Internal n8n base URL for the app | `http://n8n:5678` |
| `RENDER_WORKER_BASE_URL` | Internal render worker URL | `http://render-worker:3125` |
| `APP_INTERNAL_BASE_URL` | Internal app URL for callbacks | `http://app:3123` |
| `V2_PUBLIC_URL` | User-facing dashboard URL | `http://localhost:3130` |
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

Start V2:

```bash
docker compose -f docker-compose.v2.yml up -d --build
```

View recent logs:

```bash
docker logs --tail=200 abud-shorts-app
docker logs --tail=200 abud-shorts-render-worker
```

Check health:

```bash
curl http://localhost:3130/api/v2/system/health
```

Stop V2:

```bash
docker compose -f docker-compose.v2.yml down
```

Run tests:

```bash
pnpm vitest run
```

Build the UI:

```bash
pnpm build
```

Legacy/reference dev compose files may still exist for migration work, but new local development should use V2 at `http://localhost:3130`.

## Legacy n8n Automation + Optional YouTube Upload

This section documents the older visible n8n upload workflow. V2 normal video creation uses the hidden internal workflow from `integrations/n8n/abud-shorts-v2-control-plane-workflow.json` and does not require users to open n8n.

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

Optional n8n Docker Compose file:

```text
integrations/n8n/docker-compose.n8n.yml
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

## Public Release Status

This project is ready for public sharing as a local-first open-source MVP.

- Local Docker app validated and running.
- Render QA passed: the engine produces downloadable MP4 videos.
- n8n dry run reached the render/download path successfully.
- YouTube upload is optional and disabled by default (`AUTO_UPLOAD_TO_YOUTUBE=false`).
- YouTube upload is skipped when disabled; this is expected and safe.
- No secrets, credentials, generated videos, or metadata sidecars are committed.
- Project is ready for GitHub, portfolio website, and LinkedIn sharing.

## License

This project is licensed under the [MIT License](LICENSE).

## Acknowledgments

- Remotion for programmatic video generation
- Whisper.cpp for speech-to-text
- Pexels for video content
- FFmpeg for audio/video processing
- Kokoro for text-to-speech
