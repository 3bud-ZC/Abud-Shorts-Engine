# ABUD Shorts Engine V2 — Status

## Current Product State

Product: ABUD Shorts Engine V2

Current milestone: V2.2 — Creative Quality Engine & Provider Vault

Milestone completion: V2.2 foundational development slice complete; Arabic voice policy migrated to ElevenLabs-only; human voice selection remains the outstanding blocker

Overall project completion: V2.1 GA complete; V2.2 development in progress

Release status: V2.1 GENERAL AVAILABILITY; V2.2 NOT RELEASED

Version: 2.1.0 stable baseline (Build 2026.08.23.4, Schema 2.10.0 in development source)

Target release: 2.1.0 ACHIEVED; V2.2 development started

Human Arabic voice acceptance: PENDING — ElevenLabs must be configured, then the user auditions voices in the Voice Lab and selects the default Arabic voice

Final acceptance testing: PASS WITH HUMAN VOICE REVIEW DEFERRED

Canonical URL: http://localhost:3130

Canonical Docker services:
- `abud-shorts-app` — healthy, exposed at `localhost:3130 -> 3123`
- `abud-shorts-render-worker` — healthy, internal only
- `abud-shorts-n8n` — healthy, internal only on Docker DNS alias `n8n`
- `abud-shorts-postgres` — healthy, internal only on Docker DNS alias `postgres`

---

## Milestone V2-04: Publishing, Scheduling & Distribution Engine (Summary & Architecture)

### 1. Architectural Overview & Workflow
ABUD Shorts Engine is transformed from a video-generation tool into an end-to-end content distribution platform:
$$\text{CREATE} \longrightarrow \text{REVIEW} \longrightarrow \text{SCHEDULE} \longrightarrow \text{PUBLISH} \longrightarrow \text{TRACK} \longrightarrow \text{RETRY}$$

All publishing operations are managed entirely from the ABUD Shorts dashboard without requiring manual file handling or external UI workflows.

### 2. Canonical PostgreSQL Schema
Implemented full persistence models in PostgreSQL (`db.ts`):
- `social_accounts`: Connected social channel credentials, platform metadata, masked tokens (`1234****5678`), capabilities, and health status.
- `publications`: Individual platform distribution records with platform-tailored titles, captions, hashtags, custom metadata, execution timestamps, provider URLs, and error tracking.
- `scheduled_publications`: Timezone-aware background scheduling queue with atomic claim locks (`SELECT FOR UPDATE` / `RETURNING`).
- `publishing_attempts`: Detailed execution attempt history recording HTTP status, provider raw responses, and technical stack traces.
- `publishing_events`: Real-time audit events streamed to clients via Server-Sent Events (SSE) `/api/v2/publishing/events/stream`.
- `automation_rules`: Declarative auto-publish rules (e.g. auto-distribute on successful render).

### 3. Provider Abstraction & Platform Support
Created `PublishingProvider` interface and `PublishingProviderRegistry` supporting 8 platforms:
- **UploadPostProvider**: Multi-platform aggregator for YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, LinkedIn, X/Twitter, and Threads with native multipart `FormData`/`Blob`.
- **TelegramPublishingProvider**: Direct bot integration via Telegram Bot API (`getMe`, `sendVideo`) with HTML caption formatting and chat targeting.
- **Direct Extension Points**: `YouTubeDirectProvider` (Data API v3), `MetaDirectProvider` (Instagram/Facebook Graph API), `TikTokDirectProvider` (TikTok Content Posting API).

### 4. Platform-Tailored AI Metadata & Format Pre-flight Validation
- **AIMetadataGenerator**: Generates platform-optimized titles, descriptions, punchy hashtags, and visibility settings in Arabic (RTL) and English tailored to each platform's character limits and algorithms.
- **Pre-flight Media Format Validator**: Verifies aspect ratios (9:16 portrait vs 16:9 landscape), maximum video duration limits (e.g. 60s for YouTube Shorts / TikTok), and file size ceilings before initiating network upload.

### 5. Idempotency, Scheduler & Partial Failure Isolation
- **Idempotency Deduplication**: SHA-256 / UUID key deduplication prevents duplicate posts on network retries.
- **Partial Failure Isolation**: When distributing a video across multiple platforms simultaneously, each platform publishes independently. Successful platforms receive live post URLs while failed platforms record clear technical reasons without aborting other distributions.
- **Smart Retry Engine**: Differentiates between retryable errors (429 Rate Limits, 5xx Server Errors, Network Timeouts) with exponential backoff vs non-retryable errors (401 Unauthorized, 400 Bad Request) requiring user attention.
- **PublishingScheduler**: Background daemon with atomic worker locks (`workerId`, `locked_at`) running periodically to claim and execute due scheduled publications.

### 6. Security & Credential Masking
- Plaintext API keys and bot tokens are **never** exposed in REST API responses, UI components, or logs.
- Secrets are masked using `maskSecret()` format (e.g., `1234****5678`) and verified via `/api/v2/settings` and `/api/v2/publishing/accounts/:id/test`.

### 7. Frontend UI Suite
- **Publishing Control Center (`/publishing`)**: Dedicated full-featured dashboard with Overview stats, Scheduled queue, Published library, Failed/Retry action center, and Connected Social Accounts manager.
- **Review & Publish Modal (`ReviewPublishModal.tsx`)**: Platform tab switching, AI one-click metadata optimizer, immediate publish vs scheduled date/time/timezone picker, and validation warning alerts.
- **Batch Distribution Modal (`BatchPublishModal.tsx`)**: Multi-video distribution across multiple social networks in one click.
- **Video Details Distribution Panel (`VideoDetails.tsx`)**: Live platform badges, direct post hyperlinks, retry triggers, and distribution status overview.
- **Video List Multi-Select Bar (`VideoList.tsx`)**: Multi-video selection with instant "Distribute X Videos" action bar.
- **Settings Distribution Section (`SettingsPage.tsx`)**: Platform defaults, auto-publish preferences, and masked API secrets management.

---

## V2-03 Finalization Hotfix: Root Cause & Architectural Solutions

### 1. Root Cause of Duration Regression
1. **Schema Default Overwrite**: `promptJobInputSchema` previously applied `.default(30)` to `durationSeconds`. When client requests passed `{ duration: 20 }`, Zod stripped the unmapped `duration` alias and populated `durationSeconds = 30` from the default, overriding prompt text regex extraction and forcing a 30s budget regardless of user prompt.
2. **Template Conversion Hardcoding**: `convertTemplateToProductionSpec()` in `templateToSpec.ts` hardcoded `template.targetDurationSeconds` without inspecting explicit duration parameters from the request.
3. **Post-Render Quality Score Inflation**: `validateRenderedVideo()` previously measured variance against `timeline.finalExpectedDurationSeconds` rather than the canonical `requestedDurationSeconds`, allowing duration-inflated videos to falsely receive 100/100 technical scores.

### 2. Architectural Invariants Implemented
- **Canonical Duration Precedence**: Normalized across all endpoints (`promptJobInputSchema`, `templateJobInputSchema`, `productionSpecPreviewSchema`) using `normalizeDurationInput()`:
  $$\text{Explicit API/UI Parameter} \longrightarrow \text{Extracted Prompt Duration (Regex)} \longrightarrow \text{Configured Default (30s)}$$
- **Media Intelligence Multi-Segment Invariant**: Added `normalizeSceneSegments()` ensuring:
  $$\sum_{s \in \text{segments}} \text{duration}_s = \text{targetSceneDuration}$$
  Multi-clip cutaways and visual segmentation will **never** expand or alter the canonical timeline budget.
- **Strict Post-Render Quality Scoring**: `FFMpeg.validateRenderedVideo()` evaluates `actualFinalDuration` directly against `requestedDurationSeconds`.
  - Variance $\le 0.5\text{s}$: 0 deduction
  - Variance $0.5\text{s} - 1.0\text{s}$: $-5$ deduction
  - Variance $1.0\text{s} - 3.0\text{s}$: $-25$ deduction
  - Variance $3.0\text{s} - 5.0\text{s}$: $-45$ deduction
  - Variance $> 5.0\text{s}$: $-70$ deduction and marked `valid: false` (max score $\le 30/100$).
- **Remotion Chromium Headless Stability**: Added `enableMultiProcessOnLinux: true`, `disableWebSecurity: true`, and increased headless browser setup timeouts (120s / 180s) to guarantee zero setup timeouts inside Docker Linux workers.
- **Calibrated Voice-First Audio Mixing**:
  - Voice audio volume kept at 1.0.
  - Background music volume calibrated to: Low = 0.15, Medium = 0.25, High = 0.35.
  - Smooth 15-frame fade-in and 25-frame fade-out volume curves.
  - Automated mood matching linking Media Intelligence visual intent to curated background music.
- **Rich Metadata Sidecar & UI Exposure**: Stored in `.meta.json` and exposed in Video Details card:
  `captionProfileUsed`, `musicTrack`, `musicMood`, `motionPresetsUsed`, `transitionPresetsUsed`, `mediaSegmentCount`, `technicalScore`, `mediaPlanScore`, `overallProductionScore`, `durationVariancePercent`.

---

## Milestone V2-04 Live Runtime Verification & Release-Gate Results

### 1. Publishing Provider 4-State Verification Matrix

| Publishing Provider | Implemented | Configured | Live Healthy | Live Verified | Notes / External Blocker |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Upload-Post** | **Yes** | No | Not Tested | No | LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS (`UPLOAD_POST_API_KEY`) |
| **Telegram Direct** | **Yes** | No | Not Tested | No | LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS (`TELEGRAM_BOT_TOKEN`) |
| **YouTube Direct** | **Yes** | No | Not Tested | No | LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS (OAuth Client Credential) |
| **Meta Direct** | **Yes** | No | Not Tested | No | LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS (Meta App Access Token) |
| **TikTok Direct** | **Yes** | No | Not Tested | No | LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS (TikTok App Access Token) |
| **TestPublishingProvider** | **Yes** | **Yes** | **Healthy** | **Live Verified** | Internal dev/test deterministic provider for complete pipeline testing |

> [!NOTE]
> **Real Social Credential Audit**: `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS`.
> External social publishing was safely gated without fabricating any external accounts, tokens, post IDs, or social URLs. Full runtime orchestration, background polling, restart survival, atomic locking, and PostgreSQL persistence were verified using `TestPublishingProvider`.

### 2. Live Runtime Release-Gate Audit

- **Internal Token Fallback Removal**: 100% removed across entire repository, workflow JSONs, and compose files.
  - Missing token header: **Rejected (HTTP 401 Unauthorized)**.
  - Invalid token header: **Rejected (HTTP 401 Unauthorized)**.
  - Deprecated `change-me-v2-internal-token`: **Rejected (HTTP 401 Unauthorized)**.
  - Valid `INTERNAL_SERVICE_TOKEN`: **Accepted**.
- **Internal Test Publishing Provider**: Implemented in `testPublishingProvider.ts` supporting `success`, `failure`, `429`, `500`, `timeout`, `401` modes with deterministic invocation counting and isolated from customer UI.
- **Scheduler Terminal-State Verification**:
  - Publication ID: `cmt4h20iq000207qsh9047f8b`
  - Scheduled At: `2026-08-22T14:27:50.013Z` (Timezone: `Africa/Cairo`)
  - Claimed & Executed by: `worker_7_1787408687920`
  - Final Terminal Status: **`published`** (PostgreSQL records verified in `publications`, `scheduled_publications`, `publishing_attempts`, `publishing_events`)
  - Provider Post ID: `test_post_cmt4h20iq000207qsh9047f8b`
- **Restart Recovery to Terminal State**:
  - Pre-Restart Publication ID: `cmt4h3e2a000407qseh9ocoub`
  - Scheduled At: `2026-08-22T14:28:54.223Z`
  - Containers Restarted: `abud-shorts-app` and `abud-shorts-n8n`
  - Post-Restart Resumed Worker: `worker_7_1787408877214`
  - Final Terminal Status: **`published`**
  - Provider Post ID: `test_post_cmt4h3e2a000407qseh9ocoub`
- **Real n8n Execution**:
  - Workflow ID: `abud-shorts-v2-publishing` (Active, Version: `b1f3114e-449c-4bef-9c72-b9a8c13fd7b1`)
  - Webhook Path: `/webhook/abud-v2/publishing/publish`
  - Orchestration Status: HTTP 200 completed callback dispatching to `/internal/v1/publishing/publications/:id/execute` with verified token header.
- **Full Pipeline Idempotency**: Repeated publication requests with identical `idempotencyKey` returned identical publication record `cmt4h4s84000007qs4k7j0e0f` with `invocationCount = 1`.
- **Partial Failure & Targeted Retry**: Independent per-platform failure isolation verified (Platform A `published`, Platform B `failed` $\rightarrow$ overall `partially_published`; targeted retry executes only on Platform B).
- **Retry Classification**: Verified 429, 500, and timeout categorized as `retryable` (with exponential backoff) and 401 as `non_retryable`.
- **Scheduler Concurrency**: Verified PostgreSQL atomic locking query (`UPDATE ... WHERE status = 'pending' RETURNING *`) prevents double execution across parallel scheduler workers.
- **Live SSE Event Stream**: Verified real lifecycle events (`created`, `scheduled`, `upload_started`, `provider_accepted`, `published`) delivered over `GET /api/v2/publishing/events/stream`.
- **Security & Secret Masking Audit**: Verified zero plaintext secrets in REST responses, DB records, or logs (masked with `1234****5678`). Secrets exposed = **NO**.

---

## Live Video Generation Verification Suite Results

| Test Name | Mode | Aspect Ratio | Requested Duration | Video ID | Actual Duration | Variance | Technical Score | Media Plan Score | Overall Score | File Size | Output Thumbnail | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Test D: Egyptian Arabic Cloud Backup Ad (V2-04 Regression Pass)** | Prompt Studio | **9:16** Portrait | **20s** | `cmt4fjtnf000407qkgba301m4` | **20.05s** | **0.05s (0.3%)** | **100/100** | **92/100** | **96/100** | 18.17 MB | HTTP 200 (image/jpeg) | `completed` (100%) |
| **Test A: Egyptian Arabic Streetwear Ad** | Prompt Studio | **9:16** Portrait | **25s** | `cmt4agi1r000107qt67qzcgl5` | **25.05s** | **0.05s (0.2%)** | **100/100** | **92/100** | **96/100** | 26.05 MB | HTTP 200 (95.9 KB) | `ready` (100%) |
| **Test B: Cloud Backup Tech Explainer** | Prompt Studio | **16:9** Landscape | **20s** | `cmt4auiqj000107k14l2t0med` | **20.05s** | **0.05s (0.3%)** | **100/100** | **92/100** | **96/100** | 21.47 MB | HTTP 200 (64.5 KB) | `ready` (100%) |
| **Test C: Product Ad Template Mode** | Template Mode | **9:16** Portrait | **20s** | `cmt4ay4z0000307k1aeopbrvr` | **20.05s** | **0.05s (0.3%)** | **100/100** | **93/100** | **97/100** | 19.99 MB | HTTP 200 (98.3 KB) | `ready` (100%) |

### Detailed Test Run Summaries

#### Test A (Prompt Mode — 25s Portrait — Egyptian Arabic)
- **Job ID / Video ID**: `cmt4agi1r000107qt67qzcgl5`
- **Resolution**: 1080x1920 (9:16 Portrait)
- **Requested Duration**: 25.00s | **Resolved Target**: 25.00s | **Actual FFprobe**: 25.05s | **Variance**: 0.05s (0.2%)
- **Quality Scores**: Technical: 100/100, Media Plan: 92/100, Overall: 96/100
- **Audio & Visuals**: Music Track: `Name The Time And Place - Telecasted.mp3` (Mood: `excited`), Voice: Kokoro (`af_heart`), Captions: `bold` preset with Arabic RTL centering
- **Camera Motions & Transitions**: Presets: `punch_in`, `handheld_subtle`, `zoom_out` | Transitions: `whip`, `zoom`
- **Media Segments**: 4 sub-clips
- **Thumbnail URL**: `http://localhost:3130/api/videos/cmt4agi1r000107qt67qzcgl5/thumbnail` (HTTP 200 OK, 95,934 bytes)
- **Download Endpoint**: `http://localhost:3130/api/videos/cmt4agi1r000107qt67qzcgl5/download` (HTTP 200 OK, 27.3 MB)

#### Test B (Prompt Mode — 20s Landscape — Tech Explainer)
- **Job ID / Video ID**: `cmt4auiqj000107k14l2t0med`
- **Resolution**: 1920x1080 (16:9 Landscape)
- **Requested Duration**: 20.00s | **Resolved Target**: 20.00s | **Actual FFprobe**: 20.05s | **Variance**: 0.05s (0.3%)
- **Quality Scores**: Technical: 100/100, Media Plan: 92/100, Overall: 96/100
- **Audio & Visuals**: Music Track: `Name The Time And Place - Telecasted.mp3` (Mood: `excited`), Voice: Kokoro (`af_heart`), Captions: `bold` cyan pop typography
- **Camera Motions & Transitions**: Presets: `zoom_in`, `pan_left`, `zoom_out`, `punch_in` | Transitions: `fade`, `zoom`
- **Media Segments**: 4 sub-clips
- **Thumbnail URL**: `http://localhost:3130/api/videos/cmt4auiqj000107k14l2t0med/thumbnail` (HTTP 200 OK, 64,510 bytes)
- **Download Endpoint**: `http://localhost:3130/api/videos/cmt4auiqj000107k14l2t0med/download` (HTTP 200 OK, 22.5 MB)

#### Test C (Template Mode — 20s Portrait — Product Ad)
- **Job ID / Video ID**: `cmt4ay4z0000307k1aeopbrvr`
- **Template ID**: `product_ad` (Classic Oversized Egyptian Cotton Tee)
- **Resolution**: 1080x1920 (9:16 Portrait)
- **Requested Duration**: 20.00s | **Resolved Target**: 20.00s | **Actual FFprobe**: 20.05s | **Variance**: 0.05s (0.3%)
- **Quality Scores**: Technical: 100/100, Media Plan: 93/100, Overall: 97/100
- **Audio & Visuals**: Music Track: `Name The Time And Place - Telecasted.mp3` (Mood: `excited`), Voice: Kokoro (`af_heart`), Captions: `clean` preset
- **Camera Motions & Transitions**: Presets: `punch_in`, `handheld_subtle`, `zoom_out` | Transitions: `whip`, `zoom`
- **Media Segments**: 4 sub-clips
- **Thumbnail URL**: `http://localhost:3130/api/videos/cmt4ay4z0000307k1aeopbrvr/thumbnail` (HTTP 200 OK, 98,295 bytes)
- **Download Endpoint**: `http://localhost:3130/api/videos/cmt4ay4z0000307k1aeopbrvr/download` (HTTP 200 OK, 21.0 MB)

---

## AI Provider Status Audit (`GET /api/v2/providers`)

| Provider Name | Category | Tier | Configured | Live Status | Health Message |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Local AI Creative Director** | Content AI | `free` | Yes | `healthy` | Deterministic rule-based creative director is active. |
| **Google Gemini** | Content AI | `cloud` | No | `not_configured` | GEMINI_API_KEY is not configured. |
| **Pexels** | Visuals | `stock` | Yes | `healthy` | Pexels responded with an authorized video search result. |
| **Google Veo** | Visuals | `ai_video` | No | `not_configured` | VEO_API_KEY is not configured. |
| **fal.ai (Kling / Wan / Seedance)** | Visuals | `ai_video` | No | `not_configured` | FAL_KEY is not configured. |
| **Kokoro TTS** | Voice | `free` | Yes | `healthy` | Kokoro local TTS is available in the application image. |
| **ElevenLabs** | Voice | `premium` | No | `not_configured` | ELEVENLABS_API_KEY is not configured. |
| **Whisper** | Captions | `free` | Yes | `healthy` | Whisper model directory exists. |
| **Remotion** | Renderer | `local` | Yes | `healthy` | Remotion runtime is installed in the application image. |
| **FFmpeg** | Renderer | `local` | Yes | `healthy` | FFmpeg runtime is installed in the application image. |
| **n8n** | Infrastructure | `internal`| Yes | `healthy` | n8n health endpoint responded. |
| **PostgreSQL** | Infrastructure | `internal`| Yes | `healthy` | PostgreSQL connection is healthy. |

---

## Automated Test Suites & System Health Verification

- **Vitest Suite**: `pnpm vitest run` $\longrightarrow$ **20 test files passed, 158 unit tests passed (100% pass rate)**.
- **Production Build**: `pnpm build` $\longrightarrow$ **Clean TypeScript compilation and Vite frontend bundle (0 errors, build in 2.84s)**.
- **System Health**: `GET /api/v2/system/health` $\longrightarrow$ **10/10 components healthy (Application, Database, n8n, Render Worker, Remotion, FFmpeg, Kokoro, Whisper, Pexels, Disk)**.

---

## Files Added or Modified (Milestones V2-01 through V2-04)

- `ABUD_SHORTS_ENGINE_STATUS.md`
- `source/src/server/v2/db.ts`
- `source/src/server/v2/routes.ts`
- `source/src/server/v2/types.ts`
- `source/src/server/v2/publishing/types.ts`
- `source/src/server/v2/publishing/publishingProvider.ts`
- `source/src/server/v2/publishing/providers/uploadPostProvider.ts`
- `source/src/server/v2/publishing/providers/telegramProvider.ts`
- `source/src/server/v2/publishing/providers/youtubeDirectProvider.ts`
- `source/src/server/v2/publishing/providers/metaDirectProvider.ts`
- `source/src/server/v2/publishing/providers/tiktokDirectProvider.ts`
- `source/src/server/v2/publishing/registry.ts`
- `source/src/server/v2/publishing/aiMetadataGenerator.ts`
- `source/src/server/v2/publishing/publishingService.ts`
- `source/src/server/v2/publishing/scheduler.ts`
- `source/src/server/v2/publishing/routes.ts`
- `source/src/server/v2/publishing.test.ts`
- `source/src/ui/pages/v2Types.ts`
- `source/src/ui/components/publishing/ReviewPublishModal.tsx`
- `source/src/ui/components/publishing/AccountConnectModal.tsx`
- `source/src/ui/components/publishing/BatchPublishModal.tsx`
- `source/src/ui/pages/PublishingPage.tsx`
- `source/src/ui/pages/VideoDetails.tsx`
- `source/src/ui/pages/VideoList.tsx`
- `source/src/ui/pages/SettingsPage.tsx`
- `source/src/ui/components/Layout.tsx`
- `source/src/ui/App.tsx`
- `source/src/server/v2/content-ai/types.ts`
- `source/src/server/v2/content-ai/localProvider.ts`
- `source/src/server/v2/content-ai/geminiProvider.ts`
- `source/src/server/v2/templateToSpec.ts`
- `source/src/server/v2/media-intelligence/types.ts`
- `source/src/server/v2/media-intelligence/assetScorer.ts`
- `source/src/server/v2/media-intelligence/mediaIntelligenceService.ts`
- `source/src/server/v2/media-intelligence/mediaIntelligence.test.ts`
- `source/src/server/v2/durationPrecedence.test.ts`
- `source/src/server/v2/image-providers/types.ts`
- `source/src/server/v2/image-providers/localImageProvider.ts`
- `source/src/server/v2/image-providers/geminiImageProvider.ts`
- `source/src/server/v2/image-providers/falImageProvider.ts`
- `source/src/server/v2/image-providers/registry.ts`
- `source/src/server/v2/image-providers/imageProviders.test.ts`
- `source/src/server/v2/media-cache/mediaCache.ts`
- `source/src/components/videos/MotionWrapper.tsx`
- `source/src/components/videos/AdvancedCaptions.tsx`
- `source/src/components/videos/AdvancedCtaOverlay.tsx`
- `source/src/components/utils.ts`
- `source/src/components/videos/PortraitVideo.tsx`
- `source/src/components/videos/LandscapeVideo.tsx`
- `source/src/short-creator/libraries/FFmpeg.ts`
- `source/src/short-creator/libraries/FFmpeg.test.ts`
- `source/src/short-creator/libraries/Remotion.ts`
- `source/src/short-creator/libraries/Pexels.ts`
- `source/src/short-creator/music.test.ts`
- `source/src/short-creator/ShortCreator.ts`
- `source/src/server/videoMetadata.ts`
- `source/src/server/routers/rest.ts`
- `source/src/version.ts`
- `source/src/server/v2/auth/authService.ts`
- `source/src/server/v2/backup/backupService.ts`
- `source/src/server/v2/diagnostics/diagnosticsService.ts`
- `source/src/server/v2/webhooks/webhookService.ts`
- `source/src/server/v2/analytics/analyticsService.ts`
- `source/src/server/v2/system/systemHealthService.ts`
- `source/src/server/v2/migrations/migrationRunner.ts`
- `source/src/ui/pages/SetupWizard.tsx`
- `source/src/ui/pages/LoginPage.tsx`
- `source/install.ps1`
- `source/install.sh`
- `source/upgrade.ps1`
- `source/upgrade.sh`
- `source/uninstall.ps1`
- `source/uninstall.sh`
- `source/nginx.conf.reference`
- `source/src/server/v2/v2_05.test.ts`

---

## Milestone V2-05: Client Packaging, Installer, Backup/Restore, Security, Diagnostics & Release Candidate (Summary & Verification)

### 1. Milestone Overview & Architecture
ABUD Shorts Engine V2 is packaged and hardened into a client-friendly, production-ready distribution model:
- **Canonical Versioning**: Standardized product version `2.0.0-rc.1` (Release Candidate, Build `2026.08.22`, Schema `2.5.0`) exposed across API, logs, UI, backup manifests, and diagnostic bundles.
- **One-Command Installers**: Implemented `install.ps1` (Windows) and `install.sh` (Linux/macOS) featuring automated Docker daemon verification, port availability checks (`3130`), minimum disk space verification, directory creation, cryptographic secret generation (`INTERNAL_SERVICE_TOKEN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `SESSION_SECRET`), Docker stack bootstrap, and health waiting.
- **First-Run Setup Wizard (`/setup`)**: 10-step wizard guiding users through System Checks, Admin Account Setup, Storage Paths, Free-First Providers (Local Director, Pexels, Kokoro, Whisper, Remotion), Optional AI Models, Social Publishing, Production Defaults, and Verification. Persists completion state in PostgreSQL (`system_settings`).
- **Local Admin Security**: PBKDF2 salted password hashing (100,000 rounds, SHA-512) with constant-time verification, session token management, and Web Security Headers (CSP, X-Frame-Options: SAMEORIGIN, X-Content-Type-Options: nosniff).
- **Backup & Disaster Recovery Engine**: User-triggered backups (`config_only`, `config_db`, `full`), SHA256 checksum verification, automated pre-restore safety snapshots (`safetyBackupId`), and safe staged restore.
- **Diagnostics & Support Bundle**: Detailed system diagnostics, storage allocation breakdown (videos, cache, models, backups, logs), secret-redacted real-time logs, and one-click Diagnostic Bundle export (`.json`).
- **Operational Analytics**: Local metrics computed from PostgreSQL (`totalJobs`, `completedJobs`, `jobSuccessRatePercent`, `platformBreakdown`, `storage`). Zero external product telemetry.
- **Outbound Webhook Engine**: Event dispatching (`video.ready`, `video.failed`, `publication.published`, `publication.failed`) with HMAC-SHA256 signatures (`x-abud-signature`, `x-abud-timestamp`).
- **Lifecycle & Maintenance**: Stale job recovery on startup, graceful shutdown (SIGTERM/SIGINT), `upgrade.ps1`/`upgrade.sh` with automated pre-upgrade backup, `uninstall.ps1`/`uninstall.sh` preserving user media by default.

### 2. Live Isolated Release Validation Gate Evidence

#### A. Isolated Release Installation & Installer Execution
- **Docker Compose Project**: `abud-v2-reltest`
- **Host Port**: `3131` (Isolated from primary `3130`)
- **Storage Directory**: `./data-test`
- **Windows Installer (`install.ps1`)**:
  - Command: `powershell -ExecutionPolicy Bypass -File install.ps1 -Port 3131 -ProjectName abud-v2-reltest -ComposeFile docker-compose.reltest.yml -DataDir data-test`
  - Exit Code: `0`
  - Elapsed Time: `38s`
  - Health Status: `http://localhost:3131/health/ready` $\longrightarrow$ `ready: true`
- **Installer Idempotency**: Second execution against same installation succeeded with exit code `0`, preserving existing data and configuration with zero service disruption.
- **Linux/macOS Installer Validation**:
  - Syntax check on `install.sh`, `upgrade.sh`, `uninstall.sh`: **PASSED**
  - Verification Status: `IMPLEMENTED + STATICALLY VALIDATED | NOT LIVE VERIFIED ON NATIVE LINUX/macOS`

#### B. Setup Wizard & Local Admin Security
- **Clean Installation State**: `GET http://localhost:3131/api/v2/setup/status` $\longrightarrow$ `isSetupCompleted: false, isAdminConfigured: false`
- **Setup Completion**: Completed 10-step wizard with ephemeral admin account (`admin_reltest`) and Egyptian Arabic free-first defaults.
- **Authentication Lifecycle**:
  - Wrong password attempt $\longrightarrow$ HTTP `401 Unauthorized`
  - Correct password login $\longrightarrow$ HTTP `200 OK` (Session token issued)
  - `/api/v2/auth/me` with session token $\longrightarrow$ HTTP `200 OK`
  - Logout $\longrightarrow$ Session destroyed; subsequent requests $\longrightarrow$ HTTP `401 Unauthorized`
  - Protected REST endpoints without token $\longrightarrow$ HTTP `401 Unauthorized`

#### C. Clean Install Golden Path Video Generation
- **Video ID**: `cmt4kt21i000407qq5sw95mjr`
- **Creation Mode**: `prompt` (Prompt Studio — Free Local Pipeline: Local Director, Pexels, Kokoro, Whisper, Remotion, FFmpeg)
- **Prompt**: *"اعمل فيديو 20 ثانية باللهجة المصرية يشرح ليه المشاريع الصغيرة محتاجة تعمل نسخ احتياطي لبياناتها، مع Hook واضح وCTA بسيط."*
- **Requested Duration**: `20.00s` | **Actual FFprobe Duration**: `20.05s` (Variance: `0.05s` / `0.3%`)
- **Technical Score**: `100/100` | **Media Plan Score**: `92/100` | **Overall Production Score**: `96/100`
- **Output File Size**: `18,238,097 bytes` (17.39 MB)
- **Media Endpoints**:
  - Thumbnail: `http://localhost:3131/api/videos/cmt4kt21i000407qq5sw95mjr/thumbnail` (HTTP 200 image/jpeg)
  - Preview: `http://localhost:3131/api/short-video/cmt4kt21i000407qq5sw95mjr` (HTTP 200 video/mp4)
  - Download: `http://localhost:3131/api/videos/cmt4kt21i000407qq5sw95mjr/download` (HTTP 200 video/mp4)

#### D. Stack Restart, Backup, Safety Snapshot & State-Mutation Restore
- **Full Stack Restart**: All 4 containers restarted; verified `ready: true`, setup persisted, admin login operational, generated video exists and previewable.
- **Backup Creation**:
  - `config_db` backup: `cmt4kws3g000007qq0fj76elo` (`abud_backup_config_db_2026-08-22T16-14-44-285Z_j76elo.abudbak`, 3.8 KB, SHA256 `6a083a342ea565242d5f7472c0246a4dedba27affbdac099a910ba788ae8620d`)
  - `full` backup: `cmt4kws45000107qqfabha3q6` (`abud_backup_full_2026-08-22T16-14-44-309Z_bha3q6.abudbak`, 18.06 MB, media count: 3)
- **State Mutation & Restore**:
  - Created post-backup test brand (`Mutation Test Brand`).
  - Restored `config_db` backup $\longrightarrow$ Post-backup brand reverted/removed, pre-backup state restored.
  - Automated pre-restore safety snapshot created: `cmt4kwsm5000307qq3jcuabvl`.

#### E. Diagnostics, Config Export & Secret Redaction
- **Config Export**: `GET /api/v2/config/export` $\longrightarrow$ Validated 0 secret matches (`INTERNAL_SERVICE_TOKEN`, `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY`, `SESSION_SECRET`, API keys all excluded).
- **Diagnostic Bundle**: `GET /api/v2/system/diagnostics/bundle` $\longrightarrow$ Automated regex secret scan found **0 real secret matches**.

#### F. Upgrade Simulation & Uninstall Modes
- **Upgrade Simulation (`upgrade.ps1`)**: Executed upgrade simulation against isolated stack with exit code `0`, pre-upgrade backup created, and health verified.
- **Uninstall Safe Mode**: Executed `uninstall.ps1` without `-RemoveData` $\longrightarrow$ Containers removed, persistent data directory preserved.
- **Uninstall Destructive Mode**: Executed `uninstall.ps1 -RemoveData` $\longrightarrow$ Isolated test containers and `data-test` cleanly purged.

#### G. Outbound Webhooks, Security Headers & Responsive QA
- **Webhooks**: Webhook `cmt4kwv95000507qq9oak5zf7` registered; HMAC-SHA256 signature verified (`x-abud-signature: sha256=1b142e029eb8069db59ab80b01af047b22a4ce3c272351b032604238a7be7153`).
- **Security Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy` present on all HTTP responses.
- **Test Provider Isolation**: `TestPublishingProvider` excluded from public provider list.
- **Responsive Browser QA**: 32/32 tests passed across 4 viewports (`1920x1080`, `1440x900`, `1366x768`, `390x844`) on all 8 application pages.

#### H. Primary Development Environment Untouched
- **Primary URL**: `http://localhost:3130`
- **Health**: `ready: true`
- **Existing Jobs Count**: 23 jobs completely intact and untouched.

#### I. Test Suite & Production Build
- **Vitest Suite**: `pnpm vitest run` $\longrightarrow$ **21 test files passed, 175 unit and integration tests passed (100% green)**.
- **Production Build**: `pnpm build` $\longrightarrow$ **Clean build in 3.08s (0 errors)**.
- **Release Status**: **CORE PRODUCT RELEASE CANDIDATE** (Version `2.0.0-rc.1`).

---

## POST-RC VALIDATION — POST-RC 01: Live External Providers & Native Linux Validation

### 1. External Provider Security & Credential Audit Matrix

| Provider | Category | Implemented | Configured | Healthy | Live Verified | Current Runtime State |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local Creative Director** | Content AI | Yes | Yes (Built-in) | Yes | **Yes** | Built-in zero-dependency deterministic planner |
| **Pexels** | Visuals | Yes | Yes (`PEXELS_API_KEY`) | Yes | **Yes** | Live footage scoring, download, resolution verification |
| **Kokoro TTS** | Voice | Yes | Yes (Built-in ONNX) | Yes | **Yes** | Live Egyptian/Arabic audio synthesis |
| **Whisper** | Captions | Yes | Yes (Built-in GGML) | Yes | **Yes** | Live word-level RTL caption alignment |
| **Remotion & FFmpeg** | Renderer | Yes | Yes (Bundled) | Yes | **Yes** | Hardware-accelerated composition & sidecar encoding |
| **Gemini Content AI** | Content AI | Yes | No | Not Tested | No | `GEMINI LIVE VERIFICATION BLOCKED — NOT CONFIGURED` |
| **Google Veo** | Visuals (AI) | Yes | No | Not Tested | No | `VEO LIVE VERIFICATION BLOCKED — NOT CONFIGURED` |
| **fal.ai** | Visuals (AI) | Yes | No | Not Tested | No | `FAL.AI LIVE VERIFICATION BLOCKED — NOT CONFIGURED` |
| **ElevenLabs** | Voice (Premium) | Yes | No | Not Tested | No | `ELEVENLABS LIVE VERIFICATION BLOCKED — NOT CONFIGURED` |
| **Upload-Post** | Publishing | Yes | No | Not Tested | No | `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS` |
| **Telegram Bot** | Publishing | Yes | No | Not Tested | No | `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS` |
| **YouTube Direct** | Publishing | Yes | No | Not Tested | No | `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS` |
| **Meta Direct** | Publishing | Yes | No | Not Tested | No | `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS` |
| **TikTok Direct** | Publishing | Yes | No | Not Tested | No | `LIVE SOCIAL PUBLICATION PENDING EXTERNAL CREDENTIALS` |

### 2. Native Linux Environment Discovery & Static Script Validation
- **WSL Discovery**: `wsl --list --verbose` $\longrightarrow$ Default WSL2 backend: `docker-desktop` (Docker Desktop daemon VM). No user distributions (Ubuntu, Debian, Fedora) installed on the Windows host.
- **Linux Execution Policy**: In accordance with specification, user environments were not modified or installed.
- **Linux Script Validation**: Executed strict POSIX/Bash syntax verification on `install.sh`, `upgrade.sh`, and `uninstall.sh` inside an isolated Linux container (`alpine:latest` with bash 5.3.9).
- **Validation Result**: **ALL LINUX SCRIPTS PASSED SYNTAX CHECK IN LINUX CONTAINER**.
- **Formal Status**: `IMPLEMENTED + STATICALLY VALIDATED | NOT LIVE VERIFIED ON NATIVE LINUX/macOS`.

### 3. Post-RC Free/Local Pipeline Regression Test
- **Job ID / Video ID**: `cmt4lmfzt000107pfdd615rq4`
- **Canonical Stack**: `http://localhost:3130`
- **Creation Mode**: `prompt` (Prompt Studio)
- **Prompt**: *"اعمل فيديو 20 ثانية باللهجة المصرية لخدمة تصميم مواقع للشركات الصغيرة، البداية Hook واضح والنهاية CTA للتواصل."*
- **Requested Duration**: `20.00s` | **Actual FFprobe Duration**: `20.05s` (Variance: `0.05s` / `0.3%`)
- **Technical Score**: `100/100` | **Media Plan Score**: `92/100` | **Overall Production Score**: `96/100`
- **Output Endpoints**:
  - Thumbnail: `http://localhost:3130/api/videos/cmt4lmfzt000107pfdd615rq4/thumbnail` (HTTP 200 image/jpeg)
  - Preview: `http://localhost:3130/api/short-video/cmt4lmfzt000107pfdd615rq4` (HTTP 200 video/mp4)
  - Download: `http://localhost:3130/api/videos/cmt4lmfzt000107pfdd615rq4/download` (HTTP 200 video/mp4)

### 4. Post-RC Secret Leak Audit
- **Diagnostic Bundle Scan**: `GET /api/v2/system/diagnostics/bundle` scanned with high-sensitivity credential patterns.
- **Leak Count**: **0 plaintext secret matches**. All environment secrets and tokens remain properly redacted.

### 5. Regression Test Baseline
- **Vitest Suite**: `pnpm vitest run` $\longrightarrow$ **21 test files, 175 tests (100% passing)**.
- **Production Build**: `pnpm build` $\longrightarrow$ Clean build in 3.08s (0 errors).
- **Primary Installation Integrity**: `http://localhost:3130` fully healthy (`ready: true`), 24 total jobs and videos intact.

---

## POST-RC VALIDATION — POST-RC 02: Soak, Performance, Failure, Recovery & Release Artifact Validation

### 1. Release Candidate Build Immutability & Test Freeze
- **Target Release Candidate**: `2.0.0-rc.2`
- **Build Identifier**: `2026.08.22.2`
- **Final Frozen Git Commit SHA**: `65f32dd5421237d0aec3bc0e2ed2ce7efc63c01d`
- **Working Tree**: 100% Clean (`git status --porcelain` empty)
- **Database Schema Version**: `2.5.0`
- **Container Image Digests**:
  - `abud-shorts-app`: `sha256:bee3948817b1d7fdeb245205a5cfda3049bf3f68d9f67e19bfe4598fa396d1ce`
  - `abud-shorts-render-worker`: `sha256:bee3948817b1d7fdeb245205a5cfda3049bf3f68d9f67e19bfe4598fa396d1ce`
  - `abud-shorts-n8n`: `sha256:8a184acb2efa74a3e3d9d023cd39fa2f423cbc4ff51e999cfcd33566365a0f92`
  - `abud-shorts-postgres`: `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`
- **Single Build Execution**: All soak, performance, failure injection, recovery, memory, and security results below were executed against this single frozen release candidate build.

### 2. Repeated-Render Memory Profile & Soak Workload
Continuous sequential workload comprising 7 real video generations (5 sequential soak renders + 1 worker interruption recovery + 1 SSE client reconnect render):
- **Actual Workload Duration**: `17.9 minutes` continuous execution
- **Successful Renders**: 7 / 7 (100% pass) | **Corrupted / Orphaned Renders**: 0
- **Sequential Memory Timeline**:
  - **Before Render 1**: Worker = `895.3 MiB` | App = `834.7 MiB` | DB Conn = `3`
  - **After Render 1** (`cmt5cg50b`): Worker = `1.936 GiB` | App = `833.9 MiB` | DB Conn = `2`
  - **After Render 2** (`cmt5ck2wr`): Worker = `1.968 GiB` | App = `832.0 MiB` | DB Conn = `2`
  - **After Render 3** (`cmt5cmlt3`): Worker = `1.977 GiB` | App = `831.8 MiB` | DB Conn = `2`
  - **After Render 4** (`cmt5coz7h`): Worker = `1.981 GiB` | App = `831.8 MiB` | DB Conn = `2`
  - **After Render 5** (`cmt5cre04`): Worker = `1.984 GiB` | App = `831.8 MiB` | DB Conn = `2`
  - **After 60s Idle**: Worker = `1.963 GiB` (bounded, Chromium recycling) | App = `831.9 MiB` (flat, 0 leak) | DB Conn = `2`
- **Database Connection Pool Stability**: Baseline = `2` | Peak = `3` | After Idle = `2` (0 leaked connections)

### 3. Fault Injection & Recovery Matrix

| Test Suite | Fault Injection Scenario | Observed Runtime Behavior | Recovery Action | Final Status | Endpoints Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Worker Interruption** | `abud-shorts-render-worker` restarted mid-render (`cmt5cvojp` in voice stage) | Job did not hang; canceled cleanly | Dispatched retry (`cmt5cvwen`) | `ready` | Preview: 200, Download: 200, Thumb: 200 |
| **PostgreSQL Outage** | `abud-shorts-postgres` container stopped | `/health/live` = 200, `/health/ready` = 503 (`ready: false`), no false health | Restarted container; reconnected in 1.88s | `healthy` | Readiness returned true; all 100 jobs preserved |
| **Pexels Matrix** | Simulated 401, 429, 500, timeout | Bounded retries, fallback classification, no infinite job hang | Live key verified healthy | `healthy` | 100% video generation operational |
| **Kokoro & Whisper** | Audio/Caption subsystem verification | Non-blocking advisory callbacks, graceful fallback word timestamp synthesis | Built-in ONNX/GGML pipelines intact | `healthy` | High-accuracy Arabic narration & RTL captions |
| **Low Disk Simulation** | Disk threshold warning evaluated | Warning recorded in diagnostics; existing videos preserved; no destructive deletion | Preserved data | `safe` | 0 video loss |

### 4. Client Recovery & Frontend QA
- **SSE Stream Reconnect**: Client disconnected during active generation (`cmt5cz8nr`), reconnected, received latest progress and completed as `ready`.
- **Browser Reload & Navigation**: Reloaded during active job; same Job ID tracked; 0 duplicate jobs created.
- **Frontend Navigation & Responsive QA**: Evaluated across Dashboard, Create Video, Videos, Publishing, System, Brands, Settings; 0 fatal Javascript errors, 0 failed API requests (`390x844` mobile & `1920x1080` desktop verified).
- **Large Video Library**: 100 video records in database rendered smoothly without UI freeze.

### 5. Storage, Backup & Docker Log Retention
- **Storage Before**: `2,372,624,904 bytes` (~2.37 GB)
- **Storage After Workload**: `2,470,634,277 bytes` (~2.47 GB, net delta: `98,009,373 bytes` across 7 HD MP4s + metadata + backup)
- **Unexplained Residual / Temp Leaks**: `0 bytes` (strict cleanup on job completion)
- **Active Backup**: Generated `cmt5d2hjo` during active workload (`c060b02e5260def442db2d1fd5e21bb1cbc44bdfb568b74ac5c63dedd35d4864`, manifest valid).
- **Effective Docker Log Retention**: Configured `driver: json-file` with `max-size: 20m` and `max-file: 5` on all 4 canonical containers (`abud-shorts-app`, `abud-shorts-render-worker`, `abud-shorts-n8n`, `abud-shorts-postgres`). Unbounded Docker logging eliminated.

### 6. Publishing & Scheduler Stress
- **Publishing Stress**: 10 publication records created via `test_provider`; 10 invocations, 10 successes, 0 failures, 0 retries.
- **Idempotency Replay**: Replayed duplicate key `ga_stress_key_1` $\longrightarrow$ identical publication record returned without duplicate post creation (`idempotent: true`).
- **Scheduler Multi-Event Soak**: 5 scheduled publications timed across window; all 5 claimed atomically and executed exactly once with zero duplicate claims.

### 7. API Latency Comparison (Before vs After Soak)
- **`/health/live`**: Pre = `2.3 ms` (p95: `3.3 ms`) $\longrightarrow$ Post = `2.0 ms` (p95: `2.3 ms`)
- **`/health/ready`**: Pre = `4.0 ms` (p95: `4.5 ms`) $\longrightarrow$ Post = `3.5 ms` (p95: `4.0 ms`)
- **`/api/v2/system/health`**: Pre = `225.8 ms` (p95: `279.3 ms`) $\longrightarrow$ Post = `204.6 ms` (p95: `242.7 ms`)
- **`/api/v2/jobs`**: Pre = `29.2 ms` (p95: `54.4 ms`) $\longrightarrow$ Post = `39.4 ms` (p95: `56.8 ms`)
- **`/api/v2/analytics/overview`**: Pre = `3.5 ms` (p95: `4.2 ms`) $\longrightarrow$ Post = `3.3 ms` (p95: `4.4 ms`)
- **Degradation**: None. Latencies remained sub-5ms for operational endpoints under sustained soak.

### 8. Security Regression & Diagnostic Audit
- **Authentication**: Local admin auth active.
- **Internal Service Token**: Protected via `INTERNAL_SERVICE_TOKEN`, header-only validation, 0 plaintext exposure.
- **Security Headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, CSP active.
- **Diagnostic Secret Scan**: 0 plaintext secret leaks across full bundle and config export.
- **Test Provider Isolation**: `TestPublishingProvider` excluded from public provider listings.

### 9. Test Suite Integrity & Defect History
- **Test Suite**: `pnpm vitest run` $\longrightarrow$ **21 test files, 175 tests (100% green)**.
- **Production Build**: `pnpm build` $\longrightarrow$ **Clean build in 3.68s (0 errors)**.
- **Test Assertion Integrity**: 0 assertions weakened or removed.

#### Discovered & Resolved Defect History:
1. **DEF-01 (P2 - Reliability)**: Missing Docker log retention policy in compose files allowing unbounded JSON log growth.
   - *Fix*: Added `logging: driver: json-file, options: { max-size: 20m, max-file: 5 }` to all services in `docker-compose.v2.yml` and `docker-compose.reltest.yml`. Fixed in `2.0.0-rc.2`.
2. **DEF-02 (P2 - State Machine)**: `allowedTransitions` in `jobs.ts` rejected `canceled` transition from active stages (`generating_voice`, `rendering`, etc.), preventing interrupted jobs from being cancelled/retried.
   - *Fix*: Added `canceled` to `allowedTransitions` for all non-terminal states. Fixed in `2.0.0-rc.2`.
3. **DEF-03 (P2 - Rendering)**: Remotion sequence frame duration threw zero-frame error on edge-case zero-duration Whisper tokens.
   - *Fix*: Wrapped duration frames in `Math.max(1, ...)`. Fixed in `2.0.0-rc.2`.
4. **DEF-04 (P2 - Network)**: Headless Remotion Chromium timed out attempting remote Google Fonts network fetches in container.
   - *Fix*: Replaced remote font loader with robust offline font fallbacks. Fixed in `2.0.0-rc.2`.

- **Current Unresolved Defects**:
  - **P0**: `0`
  - **P1**: `0`
  - **P2**: `0`
  - **P3**: `0`

### 10. Final GA Recommendation

$$\mathbf{Recommendation:\ GA\_DELIVERED}$$

The Release Candidate `2.0.0-rc.2` was promoted to `2.0.0` (General Availability). The codebase is clean, tested, packaged, and delivered.

---

## FINAL GA RELEASE (v2.0.0) — DELIVERY RECORD

- **Product**: ABUD Shorts Engine V2
- **Version**: `2.0.0`
- **Release Stage**: GENERAL AVAILABILITY
- **Core Product Completion**: 100%
- **GA Commit SHA**: `0837ea85948bed5f1f446f497b022edc0cd625ff`
- **Git Tag**: `v2.0.0` (annotated tag pointing to `0837ea8`)
- **Git Push**: Succeeded — pushed `main` branch and `v2.0.0` tag to `https://github.com/3bud-ZC/Abud-Shorts-Engine.git`
- **GitHub Release**: Published at `https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/tag/v2.0.0`
  - Attached assets: `ABUD-Shorts-Engine-2.0.0.zip` (52.26 MB), `SHA256SUMS.txt`

### Verification Summary
- **Vitest Suite**: 21 test files, 175 tests passed (100% green)
- **Vite & TS Build**: Production bundle generated in 3.54s (0 errors)
- **Docker Stack Health**:
  - `GET http://localhost:3130/health/live` $\longrightarrow$ HTTP 200 `{"status":"ok"}`
  - `GET http://localhost:3130/health/ready` $\longrightarrow$ HTTP 200 `{"ready":true}`
  - `GET http://localhost:3130/api/v2/system/info` $\longrightarrow$ HTTP 200 `{"version":"2.0.0","stage":"General Availability","build":"2026.08.23.1"}`

### Video Pipeline Smoke Check
- **Video ID**: `cmt5cz8nr000e07n3452rcx07`
- **Metadata**: HTTP 200 (readable)
- **Preview Stream**: HTTP 200 (`/api/short-video/cmt5cz8nr000e07n3452rcx07`)
- **Download**: HTTP 200 (`/api/videos/cmt5cz8nr000e07n3452rcx07/download`)
- **Thumbnail**: HTTP 200 (`/api/videos/cmt5cz8nr000e07n3452rcx07/thumbnail`)

### Client Delivery Package
- **Archive File**: `release/ABUD-Shorts-Engine-2.0.0.zip`
- **Package Directory**: `release/ABUD-Shorts-Engine-2.0.0/`
- **Archive Size**: 54,795,423 bytes (52.26 MB)
- **SHA256 Checksum**: `a46d2689f1b00e08bdcbba1aa8f6b151baa4efa245c5f9b9804a484cd37edded`
- **Checksums Manifest**: `release/SHA256SUMS.txt`
- **Secrets Detected**: 0 (no `.env`, no keys, no private tokens)
- **Developer Data Included**: 0 (clean initial installation)
- **Core Files Packaged**:
  - `install.ps1`, `install.sh` (One-command installer for Windows and Linux/macOS)
  - `upgrade.ps1`, `upgrade.sh` (Safe updater with automated pre-upgrade backups)
  - `uninstall.ps1`, `uninstall.sh` (Safe uninstaller preserving media storage by default)
  - `docker-compose.yml`, `docker-compose.v2.yml`, `docker-compose.dev.yml`
  - `v2.Dockerfile`, `main.Dockerfile`, `main-cuda.Dockerfile`, `main-tiny.Dockerfile`
  - `nginx.conf.reference` (Reverse proxy template for VPS / remote hosting)
  - `.env.example`, `.dockerignore`, `.editorconfig`, `.prettierrc`
  - `README.md`, `CLIENT_QUICK_START.md`, `RELEASE_NOTES.md`, `LICENSE`, `CONTRIBUTING.md`
  - Source directories: `src/`, `static/`, `integrations/` (n8n workflows), `docs/`

### Final Developer Installation Safety Backup
- **Backup ID**: `cmt5fedaq000007pcalrce6p0`
- **Filename**: `abud_backup_config_db_2026-08-23T06-28-13-394Z_rce6p0.abudbak`
- **Filepath**: `/app/data/backups/abud_backup_config_db_2026-08-23T06-28-13-394Z_rce6p0.abudbak`
- **Checksum SHA256**: `6c5af9fcbae8ce2a0f30dfcdc1cb042158303d09bbbf7b181f410124eade8d22`
- **Size**: 133,873 bytes

### External Providers Status
- **Local/Free Pipeline** (Local Creative Director, Pexels, Kokoro TTS, Whisper, Remotion, FFmpeg): Live Verified & Operational.
- **Optional External AI/Social Providers** (Google Gemini, ElevenLabs, Google Veo, fal.ai, Meta Direct, TikTok Direct): Implemented, Not Configured (Awaiting Customer API Credentials).

---

## PATCH 2.0.1 — Client UI Stability & Polish

- **Product**: ABUD Shorts Engine V2
- **Version**: `2.0.1`
- **Release Stage**: General Availability (UI Stability Patch)
- **Patch Commit**: `8c60084` (`fix(ui): polish dashboard and repair job details page for v2.0.1`)
- **Git Tag**: `v2.0.1`
- **Git Push**: Succeeded (`main` and `v2.0.1` pushed to remote repository)
- **GitHub Release**: Published at `https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/tag/v2.0.1`

### Root Cause of Blank Job Details Page
1. **Missing Import Reference**: In `src/ui/pages/JobDetails.tsx`, `<Divider />` was rendered on line 219 without being imported from `@mui/material`, throwing an unhandled `ReferenceError: Divider is not defined` as soon as job data loaded.
2. **Missing Route Error Boundary**: The application lacked React Error Boundaries around route components, causing any runtime rendering exception to unmount the entire component tree into a blank white screen.
3. **Route Parameter Flexibility**: Enhanced `useParams` handling in `JobDetails.tsx` to support both `/jobs/:jobId` and `/jobs/:id` seamlessly.

### UI Improvements & Fixes
- **Robust Error Boundaries**: Added `ErrorBoundary` class component in `src/ui/components/v2.tsx` with friendly recovery actions (Reload Page, Return to Dashboard) wrapping all core routes and detail views.
- **Arabic / English Mixed Direction**:
  - Implemented `isArabicText()` and `bidiProps()` helpers.
  - Applied `dir="rtl"` with appropriate font/line-height to Arabic job titles, prompts, narration, and timeline messages.
  - Preserved strict `dir="ltr"` for status chips, dates, timestamps, percentages, and technical IDs.
- **Redesigned Recent Jobs Card**:
  - Clear visual hierarchy with title on left/RTL and status badge top-right.
  - Secondary metadata subtitle (`Creation Mode` · `Brand` · `Timestamp`).
  - Current stage name and percentage aligned with progress bar.
  - Interactive hover state and link directly to `/jobs/:id`.
- **SaaS Dashboard Layout Polish**:
  - 6 standardized `StatCard` metric tiles with consistent height (`110px`), bold numbers, and uppercase category labels.
  - Clean proportions for Recent Jobs (8 cols) and System Health / Recent Videos (4 cols).
  - Compact System Health status matrix for all 9 pipeline services.
- **Centralized Job Status & Stage Labels**:
  - `JOB_STATUS_LABELS` and `STAGE_LABELS` standardize human-readable names for `queued`, `planning`, `collecting_media`, `generating_voice`, `generating_captions`, `rendering`, `validating`, `ready`, `failed`, `canceled`.
- **Loading & Empty States**:
  - Added skeleton loaders (`DashboardSkeleton`, `JobDetailsSkeleton`, `JobsListSkeleton`) to prevent blank flashes during API queries.
  - Added clean empty states for empty jobs, videos, and search filters with action buttons.
- **Job Details View Rebuild**:
  - Complete execution progress display with duration calculation.
  - Embedded video player preview for completed jobs with direct "Preview Video", "Download MP4", and "Publish" actions.
  - Creative prompt box with scene-by-scene breakdown table.
  - Live Server-Sent Events (SSE) progress timeline.
  - Collapsible raw technical specification and output JSON accordion.
  - Dedicated 404 "Job Not Found" and API Error with "Retry" action.

### Responsive QA Verification
- **1920x1080**: Full desktop layout, 6 stat cards, side-by-side job grid & health panel.
- **1366x768**: Standard laptop layout, proper card wrapping, 0 horizontal scroll.
- **390x844 (Mobile)**: Clean stacked layout, mobile navigation drawer, wrapping chips and buttons.

### Test & Build Verification
- **Vitest**: 42 test files / 350 tests (or 21 test files / 175 tests in root) passed (100% green).
- **Vite & TS Build**: Production bundle built cleanly in 3.13s (0 errors).
- **Core Pipeline Modified**: **NO** (ShortCreator, Remotion, FFmpeg, Kokoro, Whisper, Publishing, and PostgreSQL schema preserved 100%).

### Client Delivery Package
- **Archive**: `release/ABUD-Shorts-Engine-2.0.1.zip`
- **Size**: 54,801,118 bytes (52.26 MB)
- **SHA256 Checksum**: `683fe94022150a36276f6654984628f074e36c0e04b0cb68ab70fcc9c39df078`
- **Secrets**: 0 detected
- **Developer Data**: 0 included

---

## V2.1 — Production Quality & Platform Upgrade

### Current Gate Status
- **Previous Version**: `2.0.1`
- **Target Version**: `2.1.0`
- **Release Status**: **READY FOR HUMAN ACCEPTANCE / RELEASE PREP**
- **Version Promotion**: Not performed. `package.json` and `src/version.ts` remain `2.0.1`.
- **V2.1 Technical Completion**: `100%`.
- **Remaining**: Human Arabic voice acceptance and final release ceremony only.
- **Verification Date**: 2026-08-23
- **Phase 2 Technical Status**: **PASS**
- **Phase 3 Technical Status**: **PASS**
- **Human Voice Acceptance**: **PENDING**

### Phase 2 Scope Completed
- Arabic production routing no longer uses Kokoro. Arabic `balanced` and `fast` route to Piper Arabic; Arabic `premium` uses ElevenLabs only when configured.
- Local Arabic TTS runtime/model provisioning is Docker-compatible and checksum-validated.
- Voice Preview works end-to-end from the real UI for Egyptian Arabic `balanced` using Piper Arabic.
- Audio mastering service runs on generated voice stems and final mixes.
- Narration-aware music ducking runs with `balanced` default profile.
- Multilingual Whisper `small` runtime is provisioned and used for Arabic caption timing.
- Sensitive `/api/v2` control routes and private media routes are admin/session or scoped-token gated.
- API token foundation is implemented with hashed storage, show-once token creation, scopes, `lastUsedAt`, and revoke.
- Golden Egyptian Arabic 20s video reached `ready` with objective media/audio QA passing.

### Arabic Local Voice
| Field | Value |
| :--- | :--- |
| Engine | `piper-tts` |
| Runtime Version | `1.7.0` |
| Runtime Source | `https://pypi.org/project/piper-tts/1.7.0/` |
| Runtime License | `GPL-3.0-or-later` |
| Model | `ar_JO-kareem-medium` |
| Voice | `kareem` |
| Language | `ar_JO` |
| Gender | male |
| Quality | medium |
| Model Source | `https://huggingface.co/rhasspy/piper-voices/tree/main/ar/ar_JO/kareem/medium` |
| Model License | `MIT (rhasspy/piper-voices repository metadata)` |
| Commercial Use | Allowed by recorded MIT model metadata |
| Redistribution | Allowed by recorded MIT model metadata |
| Attribution | `Piper voice ar_JO/kareem from rhasspy/piper-voices` |
| Model Size | `63.2 MB` ONNX, `5.0 KB` JSON config |
| Model SHA-256 | `9e95cab07b679da603bba17c4dec7ab3111320571964ee95c0379603c086491e` |
| Config SHA-256 | `ea6d9b9d9076dbdb6bf5c98c6a141ef154959d2359709b37855727964e7d6c4d` |
| Docker Verified | Yes; provider health reports Piper Arabic `healthy`, model files exist, hashes match |

### TTS Candidates Evaluated
| Engine | Model | Decision | License / Commercial Notes |
| :--- | :--- | :--- | :--- |
| Piper | `ar_JO-kareem-medium` | Selected local Arabic path | Runtime `GPL-3.0-or-later`; model MIT metadata; commercial/redistribution allowed by recorded model metadata |
| Kokoro | `onnx-community/Kokoro-82M-v1.0-ONNX`, `af_heart` | Retained for English only; rejected for Arabic production | English-focused in this product path; historical comparison only |
| ElevenLabs | Account-configured multilingual voices | Retained as premium path only | Not configured in Docker; no sample generated |
| Coqui XTTS v2 | XTTS v2 | Rejected | Model-weight commercial terms not clear/compatible enough for this client product gate |
| eSpeak NG | Arabic voices | Rejected | Local but not suitable as production Shorts narration voice |

### A/B Audio Samples
- **Old Kokoro historical comparison**: `C:\abud-shorts-engine\data-dev\videos\v2_1_phase2_samples\kokoro_af_heart_arabic_historical_15s_sample.mp3` (`15.00s`, trimmed comparison from full historical Kokoro output).
- **New local Arabic balanced**: `C:\abud-shorts-engine\data-dev\videos\v2_1_phase2_samples\piper_ar_JO_kareem_balanced_egyptian_sample.mp3` (`8.29s`, provider `piper`, voice `ar_JO-kareem-medium`, LUFS `-15.66`, true peak `-4.32 dBTP`, clipping `false`).
- **English regression sample**: `C:\abud-shorts-engine\data-dev\videos\v2_1_phase2_samples\kokoro_af_heart_english_preview_sample.mp3` (provider `kokoro`, voice `af_heart`).
- **Premium ElevenLabs sample**: Not generated; `ELEVENLABS_API_KEY` is not configured.
- **Human Listening Acceptance**: **PENDING**.

### Voice Router State
- **Arabic**: `piper` for `balanced`/`fast`; `elevenlabs` only for explicitly configured `premium`.
- **English**: `kokoro` local/free for `balanced`/`fast`; `elevenlabs` only when configured for `premium`.
- **Fallback**: Arabic fails closed if no verified Arabic provider is available; no Arabic fallback to Kokoro.
- **Voice ID Guard**: Provider/voice mismatch is normalized, so `provider=piper` cannot report `af_heart`.

### Arabic Preprocessing And Narration
- Verified coverage includes Arabic-Indic digits, Western digits, currency, percentages, dates, times, URLs, phone-like sequences, abbreviations, English product names, mixed English/Arabic, and technology terms.
- Verified terms include `AI`, `API`, `SEO`, `SaaS`, `n8n`, `ChatGPT`, `ABUD`, `50%`, `2026`, `1500 جنيه`, and `10:30`.
- Pronunciation dictionary resolution order implemented: job override -> brand dictionary -> system dictionary -> default normalization.
- Dictionary entries support written form, spoken form, language, and dialect applicability; malformed entries are ignored and placeholder replacement prevents recursive substitutions.
- Production metadata now separates `spokenNarration`, `displayText`, `captionText`, and `visualIntent`; captions and overlays are not forced to contain TTS-normalized text.

### Audio Mastering
- **Service**: `AudioMasteringService` implemented.
- **Voice Mastering Chain**: safe silence trim, high-pass, compression, loudness normalization, conservative gain trim, limiter.
- **Final Mix QA Gate**: Ready is blocked if audio stream is missing, voice file is invalid, severe clipping is detected, audio is effectively silent, or mastering critically fails.
- **Golden Voice Input LUFS**: scene values `-16.53`, `-16.46`, `-16.35`.
- **Golden Mastered Voice LUFS**: scene values `-15.34`, `-15.07`, `-15.08`.
- **Golden Mastered Voice True Peak**: scene values `-0.89`, `-0.89`, `-0.90 dBTP`; clipping `false`.
- **Golden Final Mix LUFS**: `-15.70`.
- **Golden Final Mix True Peak**: `-1.87 dBTP`.
- **Golden Final Mix Clipping**: `false`.
- **Golden Final Mix Silent**: `false`.
- **Ducking**: `balanced` speech-aware music ducking.

### Captions
- **Whisper Model**: `small`, file `ggml-small.bin`.
- **Docker Model Verified**: Yes; model size `487,601,967 bytes`.
- **Model Repair**: Invalid undersized `ggml-small.bin` was detected and reprovisioned.
- **Timing Source**: `whisper` for all Golden video voice artifacts.
- **Arabic Timing Sample**: Piper sample transcription produced token timings with Arabic language forced; start `لو` at `20-420ms`, middle `قديم` at `4200-5040ms`, end `مصلاً` at `6930-8100ms` for the voiced sample segment.
- **Golden Timing Result**: Whisper timings persisted per scene; no synthetic fallback was used.
- **RTL UI Check**: Golden video details page loaded in mobile viewport with Arabic content, authenticated media URL, and `0` detected horizontal overflow elements.

### Security Route Matrix
| Area | Access Policy |
| :--- | :--- |
| `/api/v2/system/health`, `/api/v2/system/info`, `/api/v2/setup/status` | Public bootstrap/health |
| `/api/v2/auth/login` | Public login |
| `/api/v2/auth/setup-admin` | Public only before admin/setup exists; blocked after setup |
| Jobs, prompt/spec creation, production creation | Admin session or scoped API token |
| Settings, providers config, brands/templates mutations | Admin session |
| Publishing mutations/social accounts | Admin session or `publishing:write` where scoped |
| Backups, restore, diagnostics bundle, logs, webhooks, admin/system mutations | Admin session |
| API token management | Admin session |
| Private generated videos, thumbnails, downloads, voice previews | Admin session or scoped media token; preview supports HTTP Range after auth |

### API Token Verification
- **Scopes**: `production:create`, `production:read`, `videos:read`, `publishing:write`.
- **Storage**: SHA-256 hash at rest; token value shown once on creation.
- **Runtime Matrix**:
  - Anonymous sensitive route -> `401`
  - Valid admin session -> `200`
  - Invalid/expired credential -> `401`
  - Valid API token + correct scope -> `200`
  - Valid API token + wrong scope -> `403`
  - Revoked token -> `401`
  - Setup status before/after setup -> public read
  - Setup mutation after completion anonymously -> rejected (`401`)
- **Plaintext Token Hash Rows**: `0`.

### Golden Egyptian Video
- **Job ID**: `cmt5m4hdw000307qtepy8hgut`
- **Video ID**: `cmt5m4hdw000307qtepy8hgut`
- **Prompt**: `اعمل فيديو إعلان 20 ثانية باللهجة المصرية لخدمة تصميم مواقع للشركات الصغيرة. ابدأ بجملة قوية تخلي صاحب البيزنس يكمل الفيديو، اشرح الفايدة بكلام طبيعي مش رسمي، واختم بدعوة واضحة للتواصل.`
- **Voice**: `piper`, `ar_JO-kareem-medium`, `kareem`.
- **Requested Duration**: `20.00s`
- **Actual Duration**: `20.05s`
- **Resolution**: `1080x1920`, `9:16`, `25fps`
- **Audio Codec**: `aac`
- **Audio Sample Rate**: `48000 Hz`
- **Audio Stream**: present
- **File Size**: `17,777,226 bytes`
- **Voice Generation Time**: summed provider generation `4.999s` (`1585ms`, `1729ms`, `1685ms`)
- **Caption Generation Time**: approximately `22.4s` from job events
- **Render Time**: approximately `84.6s` from `rendering` to `finalizing`
- **Total Time**: approximately `136.2s` from created to ready
- **Preview URL**: `/api/short-video/cmt5m4hdw000307qtepy8hgut`
- **Download URL**: `/api/videos/cmt5m4hdw000307qtepy8hgut/download`
- **Thumbnail URL**: `/api/videos/cmt5m4hdw000307qtepy8hgut/thumbnail`
- **Thumbnail HTTP**: `200`, `image/jpeg`, `76,813 bytes`
- **Preview HTTP**: `200`, `video/mp4`, `17,777,226 bytes`
- **Download HTTP**: `200`, `video/mp4`, `17,777,226 bytes`
- **Range HTTP**: `206`, `bytes 0-1023/17777226`
- **Technical Voice Path**: **VERIFIED**
- **Objective Audio QA**: **PASS**
- **Human Voice Acceptance**: **PENDING**

### Docker Runtime Verification
- `abud-shorts-app`: healthy, `localhost:3130 -> 3123`
- `abud-shorts-render-worker`: healthy
- `abud-shorts-n8n`: healthy
- `abud-shorts-postgres`: healthy
- `GET /api/v2/system/health`: `healthy`
- Provider health: Piper Arabic `healthy`, Whisper `healthy`, Pexels `healthy`, Kokoro English-focused `healthy`.

### Phase 3 — Visual Intelligence, Revision Studio, Checkpoints, Worker Platform, API
- **Implementation Status**: Major Phase 3 platform slice implemented and Docker runtime verified; 2.1.0 still not promoted.
- **Visual Intelligence V2**: Search candidates generated per scene, ranked stock candidates recorded, near-duplicate risk estimated, smart clip windows selected, portrait crop safety estimated, and editing rhythm profile selected.
- **Asset QA**: Runtime metadata now persists selected visuals, candidate count, selected score, score breakdown, smart clip/crop metadata, technical validation, scene QA, duplicate risk, duration fit, readability, voice fit, and caption layout safety.
- **Checkpoint Pipeline**: Stage checkpoints implemented for `planning`, `media`, `voice`, `captions`, `render`, `mastering`, and `validation`, with stage status, attempt, provider, input hash, timing, artifacts, and downstream invalidation rules.
- **Stage Retry**: `POST /api/v2/jobs/:id/stages/:stage/retry` implemented for stage-specific invalidation and requeue, accessible to admin sessions and `production:create` scoped tokens.
- **Revision Studio**: UI/API support added for voice revisions, media revisions, version history, single-final revision selection, and revision ready propagation.
- **Revision Runtime Evidence**:
  - Base runtime video/job: `cmt5niqhx000107qveai27qz6`, `ready`, `15.062s`, `1080x1920`, `aac`, `48000 Hz`, final mix LUFS `-15.58`, true peak `-4.33 dBTP`, clipping `false`.
  - Voice revision: revision `2`, job/video `cmt5no4kv000107uq9m7p3owh`, status `ready`, reused stages recorded `["planning","media"]`, final mix LUFS `-15.64`, true peak `-4.34 dBTP`, clipping `false`.
  - Media revision: revision `3`, job/video `cmt5no4o1000507uq8wmo32bj`, status `ready`, marked final, changed scene index `1`, reused stages recorded `["planning","voice","captions"]`, final mix LUFS `-15.56`, true peak `-4.35 dBTP`, clipping `false`.
  - Revision history invariant verified: exactly one final revision for project `cmt5niqhx000107qveai27qz6`.
- **Durable Artifact Reuse Closure**:
  - **Status**: **PASS**
  - **Schema / Migration**: Migration `2.8.0` adds `scene_artifacts` with `artifact_id`, `project_id`, `type`, `scene_index`, `segment_index`, `source_job_id`, `source_revision_id`, `provider`, `model`, `input_hash`, `storage_ref`, `checksum_sha256`, `duration_seconds`, `metadata`, `valid`, `superseded_at`, and `created_at`.
  - **Storage**: Durable reusable files persist under data-dir relative `artifacts/scene/...`; temporary render scratch remains separate and cleanable.
  - **Hashing**: Voice keys account for spoken narration, provider, model, voice, language, dialect, pace/style/settings, and Arabic preprocessor version. Caption keys account for voice artifact checksum, Whisper model, language, and timing config. Media keys account for provider/source, clip/crop metadata, scene index, and visual intent.
  - **Reference Safety**: Reuse uses immutable artifact references with checksum validation before copying into the temp workspace. Client-provided absolute paths or traversal refs are rejected. No artifact garbage collection deletes referenced artifacts in this slice.
  - **Backup Compatibility**: `config_db` backups include `video_revisions` and `scene_artifacts` metadata. `full` backups include required durable artifact files under `artifacts/`. Restore upserts revision/artifact metadata and only writes artifact files beneath `data/artifacts`.
  - **Legacy Compatibility**: Pre-artifact/2.0.1 jobs remain readable; legacy revisions report reuse unavailable instead of creating fake artifacts.
- **True Media-Only Revision Evidence**:
  - **Base Video / Revision**: `cmt5ozki2000107qs7ivrd2z1`
  - **New Revision**: `cmt5parud000007tc0lk798uw`
  - **Job / Video**: `cmt5parug000107tc2qrzcta0`
  - **Changed Scene**: `0`
  - **Status**: `ready`
  - **Voice Artifacts Reused**: `voice_3772f631bf7f2dd6_531869c3e33a`, `voice_b4b92db33fa8db95_a016e0533193`, `voice_bd2c98c9e78dcdb0_676c154c69f3`
  - **Caption Artifacts Reused**: `captions_6d8c066ed3946f03_5b74a5f4e64d`, `captions_b66c21825230112c_b1b49620a74e`, `captions_a85b1805c08426b8_ad96f8e203ac`
  - **New Media Artifact**: `media_8a5b2c311a6a54d9_e61450087f3d`
  - **Provider Invocations**: Piper `0`, Whisper `0`, Pexels `1`, Kokoro `0`, ElevenLabs `0`
  - **Runtime**: `45.3s` active runtime; render stage `43.04s`; final duration `12.05s`; resolution `1080p`; audio QA pass, AAC `48000 Hz`, LUFS `-15.46`, true peak `-4.33 dBTP`, clipping `false`.
  - **HTTP Media Checks**: thumbnail `200`, preview `200`, download `200`.
- **Voice-Only Revision Evidence**:
  - **Revision / Job / Video**: `cmt5pbqy5000307tcc3nd9sqj` / `cmt5pbqy6000407tca1lx70a8` / `cmt5pbqy6000407tca1lx70a8`
  - **Status**: `ready`
  - **Planning/Media Reused**: Media artifacts reused: `media_6ea1591830335e38_e61450087f3d`, `media_02b8c6f6c7ca57be_d793efe0d1f6`, `media_91e7194fcf6e0b0c_4b1d3ad9ddb9`
  - **Provider Invocations**: Piper `6`, Whisper `3`, Pexels `0`, Kokoro `0`, ElevenLabs `0`
  - **Runtime**: `75.8s`; captions regenerated because audio changed.
- **Caption-Style Revision Evidence**:
  - **Revision / Job / Video**: `cmt5pddi8000607tcb0fk3nyd` / `cmt5pddi9000707tc9stkf0p5` / `cmt5pddi9000707tc9stkf0p5`
  - **Status**: `ready`
  - **Voice Reused**: same 3 base voice artifact IDs.
  - **Whisper Timings Reused**: same 3 base caption artifact IDs.
  - **Media Reused**: same 3 base media artifact IDs.
  - **Provider Invocations**: Piper `0`, Whisper `0`, Pexels `0`, Kokoro `0`, ElevenLabs `0`
  - **Runtime**: `48.4s`; render/validation regenerated only.
- **Worker Platform**: Worker leases, heartbeat, queue observability, max-concurrent-render backpressure, expired lease recovery, and atomic job claiming implemented with PostgreSQL.
- **Backpressure Fix**: Internal job start now schedules a delayed internal retry when max concurrent renders are active, avoiding stalled queued jobs when n8n does not retry a `202 queued` response.
- **n8n Contract**: Internal job orchestration now sends schema-versioned contract payloads with `schemaVersion: abud.v2.internal.job.v1`, request ID, idempotency key, timestamp, callback target, app/render worker URLs, and original job input while retaining workflow compatibility.
- **Professional API**:
  - `POST /api/v2/production/jobs`
  - `GET /api/v2/production/jobs/:id`
  - `GET /api/v2/production/jobs/:id/stages`
  - `GET /api/v2/production/jobs/:id/output`
  - API token scopes verified: `production:create`, `production:read`, `videos:read`, `publishing:write`.
- **Webhooks**: Expanded event model includes job stage, revision, video, and publishing events. Delivery now includes HMAC SHA-256 signature versioning, retry attempts, `next_attempt_at`, and localhost/private-host URL rejection for new webhook targets.
- **Observability UI**: `/system` now exposes queue depth, active workers, active renders, average generation time, recent bottleneck, worker lease status, cache/storage usage, job counts, and recent webhook deliveries.
- **Revision UI**: `/video/:videoId` exposes Revision Studio with voice narration replacement, scene media replacement, version history, and Mark Final.
- **Job UI**: `/jobs/:jobId` exposes production timing and checkpoint state, with retry actions for eligible stages.
- **Settings UI**: `/settings` exposes API token creation, show-once token display, scope selection, token list, last-used state, and revoke.
- **Compliance Artifact**: `source/THIRD_PARTY_NOTICES.md` added for third-party dependency/license notices; this is not a status/progress report.
- **Subjective Score Guard**: Metadata now records `qualityScoreV2.subjectiveQuality = "Human Review Required"` and does not present a fabricated perceptual 100/100 quality score.
- **Runtime API/Media Security Matrix**:
  - Anonymous `GET /api/v2/production/jobs/:id` -> `401`.
  - Correct scoped API token -> `200`.
  - Wrong scoped API token -> `403`.
  - Revoked API token -> `401`.
  - Admin session `GET /api/v2/system/observability` -> `200`.
  - Scoped API token `GET /api/v2/system/observability` -> `401` (`Admin session required`).
  - Anonymous post-setup `POST /api/v2/auth/setup-admin` -> `401`.
  - Anonymous private preview -> `401`.
  - Scoped-token private preview with Range -> `206`, `1024 bytes`.
  - Scoped-token thumbnail -> `200`, `76,680 bytes`.
  - Scoped-token download -> `200`, `13,490,043 bytes`.
  - Admin API token list -> `200`; scoped API token list -> `401`.
  - Durable artifact reuse is generated server-side from authorized project metadata; clients do not submit storage paths.
  - Cross-project artifact reuse is not exposed as a public API; runtime proof used artifacts belonging to base project `cmt5ozki2000107qs7ivrd2z1`.
  - Artifact storage refs reject absolute paths and `..` traversal.
  - Temporary runtime API tokens used for verification were revoked after use.
- **Browser QA**:
  - `/video/cmt5parug000107tc2qrzcta0`: Revision Studio rendered on desktop and mobile; Restyle Captions action present.
  - `/jobs/cmt5parug000107tc2qrzcta0`: Production Timing / Checkpoints rendered on desktop and mobile; REUSED/GENERATED state visible.
  - Fatal console errors: `0`.
  - V2 EventSource job timeline auth fixed to use the existing `access_token` query-token pattern because EventSource cannot send Axios Authorization headers.
- **Phase 3 Runtime Timing Evidence**:
  - Base job total: `103.3s` from created to ready; FFprobe duration `15.062s`.
  - Voice revision total: `83.4s`; FFprobe duration `15.062s`.
  - Media revision total: `282.9s` created-to-ready due queue wait; active runtime `143.4s`; FFprobe duration `15.062s`.
  - Base job improved against Phase 2 20s Golden total (`136.2s`) only as a rough directional comparison; durations differ, so this is not a strict benchmark.
- **Docker Model Evidence**:
  - Piper ONNX: `/app/data/models/piper/ar_JO-kareem-medium.onnx`, SHA-256 `9e95cab07b679da603bba17c4dec7ab3111320571964ee95c0379603c086491e`.
  - Piper config: `/app/data/models/piper/ar_JO-kareem-medium.onnx.json`, SHA-256 `ea6d9b9d9076dbdb6bf5c98c6a141ef154959d2359709b37855727964e7d6c4d`.
  - Whisper model: `/app/data/libs/whisper/models/ggml-small.bin`, size `487,601,967 bytes`, SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.

### Tests And Build
- **Vitest duplicate discovery fixed**: `release/**`, `dist/**`, `.system_generated/**`, `temp/**`, and `data/**` excluded.
- **Canonical Test Count**: `26` files, `212` tests.
- **Canonical Test Result**: `pnpm vitest run` passed: `26 passed`, `212 passed`.
- **Build Result**: `pnpm build` passed after Google Cloud TTS and dashboard metrics changes.
- **Docker Rebuild**: `docker compose -f docker-compose.v2.yml up -d --build` passed.
- **Docker Health After Rebuild**:
  - `abud-shorts-app`: healthy.
  - `abud-shorts-render-worker`: healthy.
  - `abud-shorts-n8n`: healthy.
  - `abud-shorts-postgres`: healthy.

### Final Pre-Release Enhancement — Google Cloud TTS And Dashboard Metrics
- **Status**: Implemented and runtime verified as an optional provider. No `2.1.0` release, tag, package, or version promotion was performed.
- **Google Cloud TTS Provider**:
  - Provider ID: `google_cloud_tts`.
  - Voice abstraction: implemented through `VoiceProvider` and `VoiceRegistry`; no rendering bypass path added.
  - Tier: `cloud_free_tier` / `Google Cloud - Free Tier Available`.
  - Authentication: server-side Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; credential JSON/private keys are not exposed to the frontend, logs, n8n payloads, or status output.
  - Arabic locale: `ar-XA`, displayed as `Arabic - Modern Standard Arabic`; Egyptian Arabic is explicitly `not_specifically_verified`.
  - Capabilities: SSML `true`, speaking rate `true`, pitch `true`, word timings `false`; caption timing remains Whisper when Google is used.
  - Runtime dependency: `google-auth-library@11.0.2`; Docker image installs it alongside `pg`.
  - Pricing label: billing account may be required; usage above Google's free monthly allowance may incur charges. No quota number is hardcoded in business logic.
  - Configured in current Docker runtime: `false`.
  - Live verified in current Docker runtime: `false`.
  - Available Google voice families in current runtime: none loaded because credentials are not configured.
  - Google preview runtime result without credentials: expected `422` with clear provider-unavailable message; no local or paid fallback was used.
- **Voice Router Policy**:
  - Egyptian Arabic `fast` / default local: `piper`.
  - Egyptian Arabic `balanced`: `piper` unless Google is explicitly selected by the operator.
  - MSA Arabic `balanced`: `google_cloud_tts` preferred only when configured; otherwise `piper`.
  - English local/default: `kokoro`.
  - Premium: `elevenlabs` only when explicitly configured/selected.
  - Explicit unavailable cloud/premium providers now fail clearly instead of silently falling back.
- **Voice Preview UI**:
  - Provider selector includes `Piper Arabic`, `Google Cloud - Free Tier Available`, `Kokoro`, and `ElevenLabs`.
  - Voice selector loads provider voice IDs from protected `/api/v2/voices`; Google returns only actual Google voice IDs when credentials are configured.
  - Google selection shows the MSA and billing notice.
  - Piper runtime preview verified: provider `piper`, voice `ar_JO-kareem-medium`, duration `4.82s`, URL `/api/voice-preview/cmt5qcoab000107qqedqk14an.mp3`.
  - ElevenLabs remains not configured; no premium sample was generated.
- **Brand Voice Profile**:
  - Provider choices now include `piper`, `google_cloud_tts`, `kokoro`, and `elevenlabs` plus optional selected `voiceId`.
  - Existing brand records remain compatible; no migration was required.
- **Dashboard Metrics Root Cause**:
  - Missing/expired admin session caused protected dashboard endpoints (`/api/v2/jobs`, `/api/videos`) to return `401`; the Dashboard still rendered empty arrays as zeros.
  - `/api/v2/jobs` also defaulted to `LIMIT 100`, capping dashboard job metrics below PostgreSQL's canonical `122` job records.
- **Dashboard Metrics Fix**:
  - Central Axios auth handling now clears stale sessions and redirects protected `401` responses to `/login` without weakening route authentication.
  - Dashboard metric loading is source-aware; one failed group produces a targeted warning and does not zero unrelated cards.
  - Dashboard requests `/api/v2/jobs?limit=1000`; server bounds the limit to `1..1000`.
  - Video totals continue to come from protected `/api/videos`, counting generated MP4 outputs including completed revision outputs and excluding temp files.
- **Runtime Dashboard Counts After Fix**:
  - PostgreSQL jobs returned to Dashboard: `122`.
  - Ready jobs: `92`.
  - Failed jobs: `20`.
  - Active jobs: `9`.
  - Generated video MP4 outputs: `100`.
  - Ready video MP4 outputs: `100`.
  - Videos today: `34`.
  - Disk storage: `2.10 GB` (`2,249,685,402 bytes`).
  - Dashboard warning: removed when backend/session are healthy.
- **Browser QA**:
  - Desktop `1366x900`: Dashboard, Create Video / Voice Preview controls, and Providers rendered; warning absent; Google selector usable; fatal console/page errors `0`.
  - Mobile `390x844`: Dashboard, Create Video / Voice Preview controls, and Providers rendered; warning absent; Google selector usable; fatal console/page errors `0`.
- **Third-Party Notices**: `source/THIRD_PARTY_NOTICES.md` updated for `google-auth-library` and optional Google Cloud TTS billing/auth notice.
- **Human Voice Acceptance**: **PENDING**.

### Data Safety
- Existing data preserved; historical videos/jobs were not deleted.
- Pre-change backup created: `abud_backup_config_db_2026-08-23T08-57-51-811Z_05bset.abudbak`, `includesSecrets=false`.
- Migration `2.6.0` remains backwards-compatible and includes `api_tokens`, `brands.voice_profile`, `jobs.stage_timings`, and `jobs.checkpoint`.
- Migration `2.7.0` applied for Phase 3 and remains backwards-compatible: `video_revisions`, `worker_leases`, and webhook retry/signature metadata.
- Migration `2.8.0` applied and remains backwards-compatible: `scene_artifacts` durable artifact metadata.
- No release ZIP, tag, push, or GitHub Release was created.

### Client Delivery Decision
- **CLIENT DELIVERY**: **NOT READY**
- **Objective QA**: Phase 2 technical slice passed; Phase 3 durable artifact closure passed.
- **Human Voice Acceptance**: Pending.
- **Release Acceptance**: Ready for human voice acceptance / release prep.
- **Remaining V2.1 Work**: human listening acceptance, then final version promotion to `2.1.0`, release packaging, tag, push, and GitHub release.

---

## V2.2 - Final Engineering & Product Closure

### Current Gate Status
- **Stable Public Version**: `2.0.1`.
- **Target Release**: `2.1.0`.
- **Release Control**: No version promotion, tag, release ZIP, GitHub Release, or client package was created.
- **V2.2 Phase 01 - Server/System Hardening**: **PASS** for the implemented technical slice.
- **V2.2 Phase 02 - Workflow/Integration Closure**: **PASS** for the implemented technical slice.
- **V2.2 Phase 03 - UI/UX Final Product Closure**: **PASS** for the implemented technical slice.
- **Overall V2.2 Completion**: approximately `75%`.
- **Feature Freeze**: **ACTIVE** after Phase 03; remaining work is final acceptance, human Arabic voice acceptance, and release ceremony only.
- **Remaining**: final acceptance testing, human Arabic voice acceptance, then version promotion and release ceremony.
- **Human Voice Acceptance**: **PENDING**.
- **Verification Date**: 2026-08-23.

### Server And Runtime Hardening
- **Boot Validation**: `Config.validateRuntimeConfig()` added. V2 app role now validates `DATABASE_URL`, `INTERNAL_SERVICE_TOKEN`, service URLs, production placeholder tokens, and production test-provider flags without logging secrets.
- **Runtime Knobs**: added `REQUEST_TIMEOUT_MS`, `PROVIDER_TIMEOUT_MS`, `WEBHOOK_TIMEOUT_MS`, `MIN_FREE_DISK_BYTES`, `TEMP_MAX_AGE_MS`, `HEALTH_CACHE_TTL_MS`, and PostgreSQL pool timeout/limit knobs.
- **Request IDs**: Express now accepts safe `X-Request-ID` or generates a UUID, echoes `X-Request-ID`, and includes `requestId` in API 404/error responses.
- **Request Limits**: REST and app-level JSON body parsing now use an explicit `2mb` limit.
- **API Error Boundary**: API/internal/MCP unknown routes return structured JSON errors; React SPA fallback remains for non-API routes.
- **Graceful Shutdown**: server shutdown hooks added; app role closes the PostgreSQL pool during SIGTERM/SIGINT shutdown.
- **Temp Cleanup**: startup temp cleanup ran in Docker and deleted `17` stale temp files, `83,616,429 bytes`; durable artifacts were not cleaned.

### Database
- **Schema Migration**: `2.9.0 v2_2_server_workflow_hardening` applied successfully in Docker.
- **DB Pool**: PostgreSQL pool now uses configured max connections, idle timeout, connection timeout, and statement timeout.
- **Pool Runtime Evidence**: readiness reported `totalCount=1`, `idleCount=1`, `waitingCount=0`, `maxConnections=10`.
- **Indexes Added**:
  - `idx_jobs_idempotency_key`, `idx_jobs_status_created`, `idx_jobs_status_updated`, `idx_jobs_today`.
  - `idx_scene_artifacts_reuse`, `idx_scene_artifacts_ref_lifecycle`.
  - `idx_worker_leases_expiry_busy`.
  - `idx_webhook_deliveries_retry`.
  - `idx_publications_schedule_lookup`, `idx_scheduled_publications_claim`.
- **Runtime Index Evidence**: PostgreSQL reported `21` operational indexes across jobs, scene artifacts, worker leases, webhook deliveries, and scheduled publications.
- **Data Counts After Migration**: jobs `122`, ready jobs `92`, failed jobs `20`, scene artifacts `34`, worker leases `1`.

### Job Idempotency
- **Job Idempotency Key**: `jobs.idempotency_key` added with partial unique index.
- **API Contract**: `POST /api/v2/jobs` accepts an explicit `idempotencyKey` in ProductionSpec payloads and standard `Idempotency-Key` header.
- **Behavior**: duplicate create requests with the same valid key return the existing job instead of creating a duplicate.
- **Safety**: malformed idempotency keys are rejected by normalization and are not stored.

### Workers
- **Atomic Claim**: existing `FOR UPDATE SKIP LOCKED` worker claim path preserved.
- **Lease**: existing `worker_leases` table and lease expiry recovery preserved.
- **Heartbeat**: worker heartbeat/idle state preserved; runtime worker lease row exists.
- **Backpressure**: max concurrent render guard remains `CONCURRENCY`-driven; Docker default `1`.
- **Recovery**: startup stale job/publication recovery preserved; V2-05 tests still pass.

### Storage
- **Storage Policy**: new `storagePolicy` module validates data/videos/temp paths, blocks path escape, checks writable directories, and reports available disk when supported.
- **Render Disk Guard**: `ShortCreator` now calls `assertStorageReady()` before starting render work.
- **Readiness Evidence**: `/health/ready` returned `ready=true`, storage `ok=true`, available disk `181,500,964,864 bytes`, guard `536,870,912 bytes`, no storage issues.
- **Lifecycle**: temp artifacts are cleaned by age under `tempDir`; reusable durable artifacts under `artifacts/scene` remain outside temp cleanup.

### Health And Observability
- **Live Health**: `/health/live` returned HTTP `200`.
- **Ready Health**: `/health/ready` returned HTTP `200` with config/storage/videosDir/postgres all `true`.
- **Detailed Health**: protected `/api/v2/health` returned HTTP `401` anonymously as expected after Phase 2 security hardening.
- **Observability**: readiness now includes storage and DB pool details without exposing secrets or absolute host paths.

### n8n Workflow Closure
- **Workflows Present**:
  - `abud-shorts-v2-control-plane | ABUD Shorts V2 - Internal Job Orchestration`.
  - `abud-shorts-v2-publishing | ABUD Shorts V2 - Internal Publishing Orchestration`.
- **Activation Evidence**: n8n logs reported both workflows activated and published.
- **Obsolete Workflows**: no additional obsolete workflow files were introduced during this run.
- **Contract**: `N8nOrchestrator` continues to validate payloads with `n8nContractSchema`.
- **Callbacks**: internal callback routes remain protected by `x-internal-token`; anonymous internal job start returned HTTP `401`.
- **Failure Handling**: orchestration/render dispatch timeouts now use configured timeout policy.

### Providers And Runtime Dependencies
- **Provider Registry**: V2 provider registry preserved.
- **Piper**: local Arabic model present in Docker at `/app/data/models/piper/ar_JO-kareem-medium.onnx`, size `63,201,294 bytes`.
- **Kokoro**: local English path preserved.
- **Google TTS**: optional provider preserved; credentials not configured in this runtime, live verification remains `NO`.
- **ElevenLabs**: optional premium path preserved; not configured in this runtime.
- **Whisper**: multilingual small model present in Docker at `/app/data/libs/whisper/models/ggml-small.bin`, size `487,601,967 bytes`.
- **Pexels**: existing stock provider preserved.
- **Remotion / FFmpeg**: Docker app and render-worker booted with FFmpeg initialized; build passed.

### API And Security
- **Internal Auth**: anonymous `/internal/v1/jobs/test/start` returned HTTP `401`.
- **V2 API Auth**: anonymous `/api/v2/jobs` returned HTTP `401`.
- **Detailed Health Auth**: anonymous `/api/v2/health` returned HTTP `401`.
- **API Token Scopes**: Phase 2 scoped hashed API token foundation preserved; database contains `7` tokens, `3` active.
- **SSE**: job event route remains under protected `/api/v2/jobs/:id/events`.
- **Webhooks**: webhook HMAC signing and SSRF URL guard preserved; database contains `1` webhook.
- **Public Services**: only `abud-shorts-app` publishes host port `3130`; render-worker, n8n, and PostgreSQL remain internal Docker services.

### Publishing
- **Scheduler**: publishing scheduler starts in app runtime.
- **Idempotency**: existing publication idempotency preserved.
- **Retries**: webhook retry metadata/index preserved; scheduled publication claim index added.
- **Runtime Publishing Data**: publications: draft `25`, failed `3`, published `10`; scheduled publications: completed `9`, failed `3`.

### Backup And Restore
- **Backup Compatibility**: existing backup service remains compatible with `scene_artifacts`; backups table preserved with `5` backup records.
- **Restore Compatibility**: no restore architecture redesign was performed.
- **Data Safety**: historical jobs, videos, artifacts, backups, API tokens, webhooks, and publications were not deleted.

### Tests, Build, Docker
- **Vitest**: `pnpm vitest run` passed: `26` files, `217` tests.
- **Build**: `pnpm build` passed; Vite produced production UI bundle.
- **Docker Rebuild**: `docker compose -f docker-compose.v2.yml up -d --build` passed.
- **Docker Health**:
  - `abud-shorts-app`: healthy, host `3130 -> 3123`.
  - `abud-shorts-render-worker`: healthy, no public host port.
  - `abud-shorts-n8n`: healthy, no public host port.
  - `abud-shorts-postgres`: healthy, no public host port.

### Phase 03 - UI/UX Final Product Closure
- **Status**: **PASS**.
- **Scope Control**: UI/client workflow copy, navigation, route rendering, dashboard metrics visibility, and accessibility fixes only; no release/tag/package was created.
- **Status Header**: corrected the stale GA header to the V2.2 pre-release state. Stable public version remains `2.0.1`; target release remains `2.1.0`; release status is `DEVELOPMENT / ACCEPTANCE PENDING`.
- **Navigation**: left navigation is grouped into Overview, Production, Content, Distribution, Configuration, and Operations. Login renders outside the dashboard shell. Mobile drawer opens successfully.
- **Login**: copy changed from internal "Admin Login / Control Plane" language to "Sign in / ABUD Shorts Engine V2"; expired protected sessions clear the stale token, show a session-expired notice, and return the user to the protected route after successful login.
- **Setup Wizard**: provider copy now distinguishes local-first providers from optional cloud providers: Piper for local Arabic, Kokoro for local English, Whisper small, Remotion/FFmpeg, Google Cloud TTS MSA optional, and ElevenLabs premium optional. Internal PostgreSQL/container path wording was removed from client-facing setup text.
- **Create Video**: prompt workflow keeps the real production controls visible: language/dialect, duration, aspect ratio, quality, resolution, visual mode, voice provider, voice, captions, brand profile, voice preview, production spec preview, and create job. Voice provider options show Auto, Piper local Arabic, Google Cloud Arabic MSA/free-tier available, Kokoro local English, and ElevenLabs premium. Google/ElevenLabs remain blocked with clear copy when not configured.
- **Voice Preview UI**: provider selector opens and shows expected local/cloud options. Preview button is visible; no full render was launched during this UI pass.
- **Dashboard Metrics**: warning is gone when backend is healthy. Authenticated browser/API evidence: `/api/v2/jobs?limit=1000` HTTP `200`, `/api/videos` HTTP `200`, `/api/v2/system/health` HTTP `200`. Displayed metrics use real data: total videos `100`, videos ready `100`, active jobs `9`, failed jobs `20`, videos today `34`, disk storage `2.10 GB`.
- **Videos**: fixed fatal `/videos` route crash by importing `Divider` in `BatchPublishModal` and `VideoList`. Video library renders on desktop and mobile without React error boundary.
- **Video Details**: renders the selected Arabic video at `/video/cmt5pddi9000707tc9stkf0p5`; protected preview/download links retain media access token behavior.
- **Jobs / Job Details**: list and selected Arabic job detail render on desktop and mobile. Checkpoint copy remains client-friendly while preserving reuse/generated/invalidated states.
- **Providers**: renders provider cards including Google Cloud TTS configuration state without exposing credentials.
- **System**: health, storage, diagnostics, and observability endpoints return HTTP `200`; page renders after diagnostics completes. No secrets are shown in UI diagnostics copy.
- **Browser QA**: Playwright checked `25` route/viewport combinations: `/login`, `/setup`, `/`, `/create`, `/jobs`, `/jobs/cmt5pddi9000707tc9stkf0p5`, `/videos`, `/video/cmt5pddi9000707tc9stkf0p5`, `/publishing`, `/brands`, `/templates`, `/providers`, `/settings`, `/system` at `1366x768`; `/`, `/create`, `/video/cmt5pddi9000707tc9stkf0p5` at `1920x1080`; `/`, `/create`, `/jobs`, `/jobs/cmt5pddi9000707tc9stkf0p5`, `/videos`, `/video/cmt5pddi9000707tc9stkf0p5`, `/providers`, `/system` at `390x844`.
- **Browser Result**: `0` blank pages, `0` fatal console errors after the final `/videos` fix, no horizontal overflow detected in checked viewports.
- **Accessibility / Usability**: production settings selects now have explicit stable label/id bindings; visible focus outline remains enabled.
- **Data Safety**: no historical jobs, videos, artifacts, backups, tokens, webhooks, or publications were deleted. A short-lived QA admin session was inserted for browser verification and removed after the browser pass.
- **Tests**: `pnpm vitest run` passed: `26` files, `217` tests.
- **Build**: `pnpm build` passed; final UI bundle emitted `main-XmO2dr29.js`.
- **Docker**: final `docker compose -f docker-compose.v2.yml up -d --build` passed; `abud-shorts-app`, `abud-shorts-render-worker`, `abud-shorts-n8n`, and `abud-shorts-postgres` all healthy.

## FINAL V2.1 ACCEPTANCE & RELEASE

### Release State
- **Version**: `2.1.0`.
- **Release Stage**: `GENERAL AVAILABILITY`.
- **Technical Development**: `COMPLETE`.
- **Final Acceptance**: `PASS WITH HUMAN VOICE REVIEW DEFERRED`.
- **Human Voice Acceptance**: `DEFERRED BY USER`.
- **Schema Version**: `2.9.0`; no final migration was required.
- **Feature Freeze**: remained active; no new feature development was opened during final closure.

### Admin Login
- **Admin Username Configured**: `1234`.
- **Password Configured**: `YES`; stored through the existing password hashing mechanism.
- **Old Sessions Revoked**: `YES`.
- **Login Verification**: `POST /api/v2/auth/login` returned HTTP `200`.
- **Authenticated Session Verification**: `GET /api/v2/auth/me` returned authenticated admin user `1234`.
- **Wrong Password Verification**: returned HTTP `401`.
- **Logout Verification**: logout returned HTTP `200`; protected route after logout returned HTTP `401`; login again returned HTTP `200`.

### Final Acceptance Evidence
- **Health**: `/health/live` HTTP `200`; `/health/ready` HTTP `200` with `ready=true`; authenticated `/api/v2/health` HTTP `200`.
- **Dashboard**: real dashboard rendered; metrics, recent jobs, recent videos, and system health loaded without the healthy-state warning.
- **Create Video**: prompt, duration, aspect ratio, language/dialect, quality, voice provider, voice, voice preview, and create-job controls rendered. Piper was selectable for Egyptian Arabic.
- **Voice Preview**: one short Piper Egyptian Arabic preview succeeded with provider `piper`, voice `ar_JO-kareem-medium`, audio HTTP `200`, and no secret exposure.
- **Jobs / Videos UI**: Jobs, Job Details, Videos, and Video Details rendered without blank pages or fatal browser errors. Preview and download actions worked.
- **Revision**: one caption-style revision reused durable artifacts; Piper invocations `0`, Whisper invocations `0`, Pexels invocations `0`; final render reached Ready.
- **Publishing**: Publishing page rendered; connected/not-configured states and scheduled/history data were readable; unconfigured providers were not shown as broken system components.
- **Providers**: Piper available/local Arabic; Kokoro available/local English; Google Cloud TTS implemented/not configured; ElevenLabs implemented/not configured; Whisper, Remotion, FFmpeg, and Pexels available in the current runtime.
- **Settings**: settings and API token management opened; secrets were masked; production defaults were readable; no developer-only broken controls were found.
- **System**: System, Workers, Queue, Storage, Health, Backups, and Diagnostics views rendered without raw credentials or sensitive absolute host paths in normal customer view.

### Golden Video
- **Job ID**: `cmt5us7fa000707kp2o2p58w5`.
- **Video ID**: `cmt5us7fa000707kp2o2p58w5`.
- **Prompt**: Egyptian Arabic 15-second website design service ad requested by the user.
- **Requested Duration**: `15 seconds`.
- **Actual Duration**: `15.062 seconds`.
- **Resolution**: `1080x1920`, `9:16`.
- **Voice Provider**: `Piper`, voice `ar_JO-kareem-medium`.
- **Caption Model**: `Whisper small`.
- **Media Provider**: `Pexels`.
- **Audio Mastering**: executed with balanced ducking; audio QA pass true, final mix `-15.59 LUFS`, true peak `-4.31 dBTP`, no clipping, not silent.
- **Total Generation Time**: approximately `90 seconds`.
- **Thumbnail**: HTTP `200`.
- **Preview**: HTTP `206` range response.
- **Download**: HTTP `200`, `13,492,892 bytes`.
- **FFprobe**: video stream present; audio stream present; H.264 video `1080x1920` at `25 fps`; AAC stereo audio `48 kHz`.
- **Technical QA**: pass; validation true; technical score `100`; no critical QA failure recorded.
- **Human Voice Acceptance**: `DEFERRED BY USER`.

### Revision Quick Check
- **Revision ID**: `cmt5uv3x4000c07kp655x0o5g`.
- **Revision Job ID**: `cmt5uv3x5000d07kp61dlcqw5`.
- **Revision Output Video ID**: `cmt5uv3x5000d07kp61dlcqw5`.
- **Reuse Evidence**: reused `planning`, `media`, `voice`, and `speech_timings`; regenerated `render` and `validation`; reused artifacts `9`.
- **Provider Invocations**: Piper `0`, Whisper `0`, Pexels `0`, Kokoro `0`, Google Cloud TTS `0`, ElevenLabs `0`.
- **Result**: reached Ready.

### Backup And Diagnostics
- **Final Backup ID**: `cmt5uzn23000i07kpgxigbrps`.
- **Backup Type**: `config_db`.
- **Backup Result**: HTTP `201`; manifest/checksum present.
- **includesSecrets**: `false`.
- **Diagnostic Bundle**: `abud_diagnostics_2026-08-23T13-44-43-904Z.json`.
- **Diagnostic Secret Scan**: `0` real plaintext secrets.

### Security Sanity
- **Anonymous Protected API**: returned HTTP `401`.
- **Wrong Internal Token**: returned HTTP `401`.
- **Valid Admin**: allowed.
- **Security Headers**: present.
- **Private Media**: protected without media token/session.
- **API Token Scopes**: scoped token could read videos and was denied settings access; test token was revoked.
- **Frontend Credential Exposure**: Google credentials, API keys, internal tokens, and test provider were absent from frontend-visible content.

### Tests, Build, Docker
- **Vitest**: `pnpm vitest run` passed: `26` files, `217` tests.
- **Build**: `pnpm build` passed with no TypeScript or Vite build errors.
- **Docker Final Health**:
  - `abud-shorts-app`: healthy, host `3130 -> 3123`.
  - `abud-shorts-render-worker`: healthy, internal only.
  - `abud-shorts-n8n`: healthy, internal only.
  - `abud-shorts-postgres`: healthy, internal only.

### Defects
- **P0**: `0` unresolved.
- **P1**: `0` unresolved.
- **P2**: `0` blocking.
- **P3**: `0` blocking.
- **Fixed During Final Closure**: `/api/v2/health` compatibility alias added; normal video API responses stopped exposing sensitive local path fields; final version/provider defaults/docs/package hygiene corrected.

### Release Artifacts
- **Commit**: `a50cb487c8a103624c793760f01aab237ce690b7`.
- **Tag**: annotated `v2.1.0`.
- **Push**: `main` and `v2.1.0` pushed to `origin`.
- **GitHub Release**: https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/tag/v2.1.0
- **Package**: `ABUD-Shorts-Engine-2.1.0.zip`.
- **Package Size**: `55,428,884 bytes`.
- **SHA256**: `cc5454daaeb4b346fb07250cb4b92b9cd29abbd8cc1b78f2b5b67a99087405c1`.
- **SHA256SUMS**: updated.
- **Package Secret Scan**: secrets detected `0`; developer data detected `0`; private credentials detected `0`.

### Client Delivery Readiness
- **Current Prepared Local URL**: `http://localhost:3130`.
- **Current Prepared Local Login Username**: `1234`.
- **Password Delivery**: configured in the current installation; password should be provided through the private handoff channel, not public repository documentation.
- **Fresh Install Behavior**: Setup Wizard remains the secure default path; no universal weak credential was embedded in source.
- **Client Delivery**: `READY`.

---

## V2.2 — Creative Quality Engine & Provider Vault

### Release Control
- **Stable Baseline**: `v2.1.0` remains immutable. The existing tag, GitHub Release, and `ABUD-Shorts-Engine-2.1.0.zip` package were not rewritten.
- **Release State**: V2.2 is development work only; no `v2.2.0` tag, release, or client package was created.
- **Schema**: development source includes migration `2.10.0` for Provider Credentials Vault tables.

### Implemented Tools And Contracts
- **Voice Selector Contract**: Arabic + Egyptian + Auto resolves to Piper `ar_JO-kareem-medium`; English + Auto resolves to Kokoro `af_heart`; incompatible or unconfigured explicit premium/cloud providers cannot silently become render-time surprises.
- **Duration/Dialect Contract**: stale preview specs are canonicalized against the current UI payload before job creation. Verified live preview preserved `20s`, `egyptian`, `stock_cinematic`, `stock`, `piper`, and `ar_JO-kareem-medium`.
- **Cost Contract**: fully local/free route reports external API cost `0`; usage-based cloud/premium routes are not assigned invented fixed prices.
- **ArabicCaptionEngine V2**: preserves Unicode logical order, uses Bidi isolation, groups captions by semantic punctuation/conjunctions instead of fixed word counts, caps default layout at two lines, records safe margins/platform safe zone, and supports cinematic, viral bold, clean, minimal, product ad, and educational styles.
- **Arabic Fonts**: bundled `@fontsource/cairo@5.3.0` locally for offline rendering; Docker runtime explicitly includes it so Remotion can resolve the font in `/app`.
- **Content AI**: added optional `OllamaContentAIProvider` with local HTTP JSON contract and conservative default model hint `qwen2.5:3b-instruct`; deterministic Local Content AI remains the final fail-safe. No local model was downloaded or claimed available.
- **Arabic Script Pipeline**: Local Content AI records draft, dialect rewrite, spoken-language normalization, duration fit, hook check, repetition cleanup, CTA check, and scene segmentation metadata for Arabic specs without fabricating subjective scores.
- **Edge TTS**: added optional `edge_tts` voice provider as `EXPERIMENTAL_FREE_ONLINE`, disabled unless explicitly enabled/configured. Dynamic voice listing is implemented through the CLI when installed. Live runtime state: not configured.
- **Voice Routing V2**: explicit routing order now keeps Piper as reliable local Arabic fallback, Edge TTS as experimental online when enabled, Google Cloud only when configured and compatible, ElevenLabs explicit premium only, and Kokoro as English local.
- **SceneSourceRouter**: per-scene routing implemented for stock, uploaded media, motion graphics, product composition, AI generated video, and image animation; selected source is persisted into render metadata.
- **Production Modes**: exposed in Create Video and schema: `AUTO_HYBRID`, `STOCK_CINEMATIC`, `PRODUCT_AD`, `MOTION_GRAPHICS`, `ANIMATED_EXPLAINER`, `AI_GENERATED`, `SOCIAL_VIRAL`, `EDUCATIONAL`, `CUSTOM_MEDIA`.
- **PostProductionPipeline**: composable processor descriptors implemented for PySceneDetect, MediaPipe, rembg, Real-ESRGAN, librosa beat analysis, Arabic caption composition, and FFmpeg audio mastering. Optional processors report implemented/available/enabled/runtime/failurePolicy and stay disabled when the runtime is absent.
- **AI GPU Pack**: ComfyUI and Wan2.2 are represented as profile-gated optional capabilities only. No huge models were added to the base Docker image and no GPU availability was claimed.
- **Caption Backends**: whisper.cpp small remains baseline. faster-whisper and WhisperX are optional capability entries only; no speedup or Arabic forced alignment was claimed.
- **Provider Credentials Vault**: AES-256-GCM vault implemented with a dedicated installer-generated `PROVIDER_VAULT_MASTER_KEY`, per-credential nonce/auth tag/key version/masked hint, and no plaintext return after save. Live PostgreSQL migration verified tables `provider_credentials_vault` and `provider_oauth_states`.
- **Provider APIs**: implemented admin-protected provider credential save/delete, provider voice listing, validation, and OAuth start/callback state endpoints. OAuth handlers create CSRF state and return not-configured when provider app credentials are absent.
- **Providers UI V2**: provider cards now show configure/replace credentials, test connection, disconnect, vault masked hints, tier, capabilities, and live status without plaintext secrets.
- **Create Video UI**: added Production Mode, Max Quality Local, expanded visual strategy, dynamic voice filtering, resolved voice display, provider warnings, and cost label fixes.
- **Publishing Connections**: provider vault supports credential types for Pexels, Gemini, Google Cloud TTS, ElevenLabs, Telegram, Upload-Post, YouTube, Meta, and TikTok. OAuth platforms are not represented as simple permanent API-key boxes in the vault contract.

### Exact Versions And Licenses
- **@fontsource/cairo**: `5.3.0`, OFL-1.1, bundled locally.
- **edge-tts**: optional `rany2/edge-tts`, LGPL-3.0 per upstream LICENSE; online Microsoft Edge service terms may apply.
- **Motion Canvas**: optional Motion Pack route, MIT; not installed/enabled in the base image.
- **PySceneDetect**: optional Quality CPU Pack route; not installed/enabled in the base image.
- **MediaPipe**: optional Quality CPU Pack route; Apache-2.0; not installed/enabled in the base image.
- **rembg**: optional Product Ad route; MIT; not installed/enabled in the base image.
- **Real-ESRGAN**: optional enhancement route; project code BSD-3-Clause; model terms vary; not installed/enabled in the base image.
- **librosa**: optional beat analysis route; ISC; not installed/enabled in the base image.
- **faster-whisper**: optional caption backend route; MIT runtime; model terms depend on selected model.
- **WhisperX**: optional alignment route; BSD-2-Clause; Arabic forced alignment remains disabled until verified.
- **ComfyUI**: optional isolated GPU sidecar route; GPL-3.0; not installed/enabled in the base image.
- **Wan2.2**: optional GPU workflow route; hardware and model license acceptance required before enabling.
- **Ollama/Qwen**: optional local HTTP provider; model license depends on operator-selected local model.

### Runtime Verification & Real Outputs Closure
- **Live API Auth**: login with configured admin returned HTTP `200`; `/api/v2/auth/me` returned admin.
- **Voice API**: `/api/v2/voices?provider=auto&language=ar&dialect=egyptian` returned resolved provider `piper`, voice `ar_JO-kareem-medium`; English Auto returned `kokoro`, `af_heart`.
- **System Capabilities**: `/api/v2/system/capabilities` returns hardware detection (NVIDIA RTX 4070 12GB VRAM, 20 CPU cores, 32GB RAM), pack statuses `CORE`, `QUALITY_CPU`, `MOTION` active, `AI_GPU` gated.
- **System Readiness**: `/api/v2/system/readiness` accurately evaluates required and optional capabilities per production mode.
- **Product Media Upload API**: `/api/v2/media/product-upload` accepts multipart images, runs background removal (`rembg` / ONNX `u2netp`), persists transparent PNG and metadata, and serves previews.
- **MAX_QUALITY_LOCAL Profile Invariant**: Executes 100% locally with 0 external paid API calls across script planning, Piper TTS, Whisper captions, Motion Canvas frames, and FFmpeg mastering.

#### 1. Output A: Stock Cinematic Arabic Short
- **Job ID / Video ID**: `cmt5zzyki000807ue8m1bfyyw`
- **Duration**: `15.06s` (requested `15s`)
- **Resolution**: `1080x1920` (9:16 portrait)
- **Voice**: Piper `ar_JO-kareem-medium` (Egyptian Arabic)
- **Captions**: ArabicCaptionEngine V2 / Cairo typography
- **Technical Score**: `100/100`
- **Delivery**: Video Stream HTTP `200`, Preview Range HTTP `206`, Thumbnail HTTP `200`, Download HTTP `200`.

#### 2. Output B: Real Product Ad Short
- **Job ID / Video ID**: `cmt62zp2k000f07qo5eyi7chj`
- **Duration**: `15.06s` (requested `15s`)
- **Resolution**: `1080x1920` (9:16 portrait)
- **Production Mode**: `PRODUCT_AD`
- **Product Asset**: `prod_cmt62zp24000d07qo72f58e5a` (luxury smartwatch transparent PNG with drop shadow)
- **Voice**: Piper `ar_JO-kareem-medium` (Egyptian Arabic)
- **Composition**: ProductAdComposition with dynamic headline, offer, price badge, and WhatsApp CTA overlay.
- **Technical Score**: `100/100`
- **Delivery**: Video Stream HTTP `200`, Preview Range HTTP `206`, Thumbnail HTTP `200`, Download HTTP `200`.

#### 3. Output C: Real Motion Graphics Short
- **Job ID / Video ID**: `cmt62zp4e000i07qo7qut9yv8`
- **Duration**: `15.06s` (requested `15s`)
- **Resolution**: `1080x1920` (9:16 portrait)
- **Production Mode**: `MOTION_GRAPHICS`
- **Motion Scenes**: 3 distinct programmatic motion graphic clips rendered via Motion Canvas (kinetic typography, feature list, CTA card).
- **Voice**: Piper `ar_JO-kareem-medium` (Egyptian Arabic)
- **Typography**: Cairo Arabic font with RTL alignment.
- **Technical Score**: `100/100`
- **Delivery**: Video Stream HTTP `200`, Preview Range HTTP `206`, Thumbnail HTTP `200`, Download HTTP `200`.

#### 4. Output D: Real Animated Explainer Short
- **Job ID / Video ID**: `cmt62zp5o000l07qo8uigb5nh`
- **Duration**: `15.06s` (requested `15s`)
- **Resolution**: `1080x1920` (9:16 portrait)
- **Production Mode**: `ANIMATED_EXPLAINER`
- **Motion Scenes**: 3 diagrammatic explainer scenes rendered via Motion Canvas (animated diagram, steps workflow, CTA).
- **Voice**: Piper `ar_JO-kareem-medium` (Egyptian Arabic)
- **Captions**: Arabic educational style with Cairo typography.
- **Technical Score**: `100/100`
- **Delivery**: Video Stream HTTP `200`, Preview Range HTTP `206`, Thumbnail HTTP `200`, Download HTTP `200`.

### Tests, Build, Docker
- **Tests**: `pnpm vitest run` passed: `34` files, `240` tests (0 failures).
- **Added Coverage**: CapabilityManager packs, hardware detection, MediaUploadService, QualityEngine safe paths, MotionEngine scene generation, ProductAdComposition, and live render lifecycle.
- **Build**: `pnpm build` passed with 0 TypeScript or Vite build errors (built in ~2.9s).
- **Docker**: `abud-shorts-app`, `abud-shorts-render-worker`, `abud-shorts-n8n`, and `abud-shorts-postgres` all healthy.

### Defects Resolved
- **P0**: `0` unresolved.
- **P1**: `0` unresolved.
- **P2 Resolved**: Product Ad end-to-end rendering with transparent PNG compositing fully implemented and verified with real output.
- **P2 Resolved**: Motion Graphics and Animated Explainer programmatic scene rendering via Motion Canvas fully implemented and verified with real outputs.
- **P2 Resolved**: Quality runtime packs (PySceneDetect, rembg, librosa, Motion Canvas) integrated with safe fallbacks and runtime discovery.
- **P3 Resolved**: Docker Python executable resolution across environments (`.venv-quality`, `/opt/piper/bin/python`, `/usr/bin/python3`) hardened.

### Client Delivery State
- **V2.1 Client Delivery**: Stable and immutable GA release at `v2.1.0`.
- **V2.2 Development State**: Phase 2 (Quality Runtime Packs & Real Outputs Closure) is 100% complete and fully verified across all 4 production modes.


---

## V2.2 — FINAL ARABIC VOICE POLICY: ELEVENLABS ONLY

**Date**: 2026-08-23
**Release status**: V2.2 NOT RELEASED. `v2.1.0` remains the stable immutable release and is untouched.
**Git**: no commit and no tag created by this work; all changes are uncommitted in the working tree.

### 1. Interrupted Work Recovery

A previous coding agent was cancelled mid-execution. The local working tree was treated as the
source of truth: nothing was reset, restored, cleaned, or overwritten from GitHub.

**Files found modified (41 tracked, 24 untracked) at recovery time.** The voice-related ones were:

| File | State found | Action |
| --- | --- | --- |
| `src/server/v2/voice-providers/registry.ts` | Arabic→ElevenLabs policy written, error text non-canonical, ElevenLabs voice ID hardcoded | **Repaired** |
| `src/server/v2/voice-providers/elevenlabsVoiceProvider.ts` | Provider written, but shipped a hardcoded voice catalogue including a fabricated "Tariq (Arabic Natural)" entry and an invented per-character price | **Repaired** |
| `src/server/v2/voice-providers/types.ts` | Preset and settings types added | **Preserved and extended** |
| `src/server/v2/voice-providers/arabicSpeechPreprocessor.ts` | Four text forms declared but all four returned the same string; Piper-era Arabic letter flattening still applied | **Repaired** |
| `src/server/v2/capabilities/capabilityManager.ts` | `checkArabicProductionReadiness` added but never called; CORE pack still advertised Piper Arabic | **Repaired** |
| `src/server/v2/routes.ts` | Canonicalization helper resolved Arabic to **Piper**, contradicting the policy | **Repaired** |
| `src/short-creator/ShortCreator.test.ts` | Polling loop added without raising the 5s test timeout, so the suite failed | **Repaired** |
| `src/server/v2/voiceProviders.test.ts` | Tests asserted "Arabic routes to Piper" | **Replaced** |
| `src/server/v2/provider-vault/*` | Encrypted vault complete and correct | **Preserved** |

**Preserved**: Provider Credentials Vault (AES-256-GCM), capability packs, Motion/Quality engines,
Product Ad and Motion Graphics pipelines, ArabicCaptionEngine V2, Edge-TTS provider (disabled),
Google Cloud TTS provider, publishing infrastructure, revision/checkpoint system.

**Removed**: the fabricated ElevenLabs voice catalogue and the invented ElevenLabs dollar cost.
No Chatterbox, Arabic GPU voice pack, or additional local Arabic TTS code was found in the tree —
those directions were never started, so there was nothing to clean up.

### 2. Arabic Voice Policy

| Item | Decision |
| --- | --- |
| Arabic / Egyptian Arabic / MSA production | **ElevenLabs only** (`eleven_multilingual_v2`, `language_code = ar`) |
| Piper | **Legacy / historical only.** Removed from the image, from Arabic routing, and from readiness. Old jobs and metadata remain readable. |
| Edge-TTS | Present but disabled and experimental. Never a production Arabic route. |
| Google Cloud TTS | Integration left intact for manual use. Not part of the Arabic path. |
| Kokoro | Unchanged. Still the local/free English route. |
| Chatterbox / Voice GPU TTS pack / new local Arabic models | **Abandoned. Not implemented.** |

When ElevenLabs is not configured, Arabic jobs are refused **before execution** with HTTP 409 and
the message *"Arabic narration requires ElevenLabs. Configure ElevenLabs in Providers."* plus a
Configure ElevenLabs action. There is no silent fallback to Piper, Kokoro, Edge-TTS, or Google.

### 3. ElevenLabs Implementation

- Model: `eleven_multilingual_v2`; `language_code: "ar"` sent for Arabic.
- Voice discovery is **live only** — `GET /v1/voices` normalized into a canonical
  `{ id, name, category, labels, accent, language, dialect, previewUrl }` shape. Dialect, gender
  and Arabic language are asserted only when ElevenLabs actually returns that metadata.
- No voice ID is hardcoded. An unset voice is resolved from the customer's own account at
  generation time; a historical `ar_JO-kareem-medium` value is dropped rather than forwarded.
- Presets (Natural, Energetic Ad, Professional, Storytelling, Calm) map only to documented
  settings: `stability`, `similarity_boost`, `style`, `use_speaker_boost`. Values are clamped.
- Persisted per job: provider, `modelId`, `voiceId`, `languageCode`, and voice settings.
- Single-speaker guarantee: the first scene pins the resolved voice ID and every later scene and
  every narration-fitting retry reuses it.
- Credentials come from the encrypted `ProviderCredentialsVault`. Both the app and the render
  worker resolve the key themselves from the vault, so no plaintext key crosses the internal
  network and no `.env` editing is required. Only masked hints are ever returned.

### 4. Voice Lab

`Providers → ElevenLabs → Voice Lab`, with Browse Voices alongside it.

- Endpoints: `GET /api/v2/voice-lab/config`, `POST /api/v2/voice-lab/preview`,
  `GET|PUT /api/v2/voice-lab/default-voice`.
- Fields: Text, Language (Arabic/English), Target dialect (Egyptian/MSA), Voice, Preset.
- Actions: Generate Preview, Play, Regenerate, Set as default Arabic voice.
- Short samples only (600 character cap). No video is rendered from the Voice Lab.
- The Egyptian reference script is preloaded and reused unchanged across voices so comparisons
  stay like-for-like.
- The engine never labels a voice Best, Perfect, Human, or Egyptian. Selection is the user's, and
  the chosen default is persisted in `app_settings` marked `selectedBy: "human"`.

### 5. Arabic Text Pipeline

Four distinct forms are now produced instead of one string reused four times:

| Form | Contents |
| --- | --- |
| `sourceText` | Exactly what was written |
| `captionText` | Original wording and spelling, whitespace-normalized, for on-screen captions |
| `spokenNarration` | Egyptian wording preserved; only tashkeel and Eastern digits normalized |
| `ttsNormalizedText` | The above plus pronunciation dictionary and number/date/currency expansion — this is what ElevenLabs receives |

The Piper-era letter flattening (إأآ→ا, ى→ي, ؤ→و, ئ→ي) was **removed**: it degraded orthography
that ElevenLabs handles correctly. Egyptian words survive verbatim — إنت، مش، لسه، دلوقتي، عندك،
معاك، علشان. Mixed English (AI, API, SaaS, ChatGPT, WhatsApp, product, customer) is spelled out for
pronunciation in the TTS form while captions keep the Latin spelling. Numbers keep their meaning:
2026 → سنة الفين ستة وعشرين، 1500 جنيه → الف وخمسمية جنيه، 30% → تلاتين في المية، 10:30 → عشرة ونص.

### 6. Duration, Captions, Mastering

- Duration fitting uses the **measured** FFmpeg duration of the generated speech. Over-long
  narration is rewritten/shortened first; any residual tempo correction stays under 1.08×, so
  ElevenLabs audio is never aggressively time-stretched.
- Whisper small remains the caption timing engine. It was not removed.
- `AudioMasteringService` (loudness normalization, compression, limiter, true-peak, music ducking)
  is unchanged.

### 7. Cost UX

Arabic ElevenLabs production no longer displays `$0` external API cost. It reports
**"ElevenLabs · Cloud / Usage Based"**. No dollar figure is invented, because ElevenLabs bills
against a subscription character allowance that the engine cannot price reliably. Local/English
production still reports a genuine $0.

### 8. Readiness Model

- Overall system readiness stays **healthy** without ElevenLabs; English and local production
  remain fully available.
- `GET /api/v2/system/arabic-readiness` reports Arabic production separately and returns
  `NOT READY — ELEVENLABS NOT CONFIGURED` when no credential exists.
- Arabic capability now depends on ElevenLabs being configured (and, for "Live Verified", on a
  real API round trip) — never on local Piper model health.

### 9. Package Footprint

The V2.2 image no longer ships the Piper Arabic TTS runtime. The Python venv was renamed
`/opt/piper` → `/opt/pyruntime` and now installs only `pillow`.

| Measure | Before | After |
| --- | --- | --- |
| `abud-shorts-engine:v2` image | 5.90 GB | **5.65 GB** (−250 MB) |
| Arabic voice model provisioning on a fresh install | 63.2 MB download required | **not required** |

Estimated fresh-install reduction: **~313 MB**. No developer data or historical media was deleted;
the existing `data-dev/models/piper/ar_JO-kareem-medium.onnx` file was left in place.

### 10. Tests, Build, Docker

- **Tests**: `pnpm vitest run` — **35 files, 269 tests, 0 failures** (baseline at recovery was
  5 failures across 2 files).
- **New/updated coverage**: `src/server/v2/arabicVoicePolicy.test.ts` (new, 13 tests) plus
  rewrites in `voiceProviders.test.ts`, `costEstimator.test.ts`, and
  `productionContract.test.ts` — Arabic/Egyptian/MSA → ElevenLabs, no Piper production fallback,
  unconfigured ElevenLabs blocks the job at creation time, historical Piper metadata stays
  readable, voice discovery normalization, preset→settings mapping, `language_code: ar`,
  same voice across scenes, Arabic duration fitting, vault credential masking, Arabic readiness,
  and the cost label. No test was weakened to make it pass.
- **Build**: `pnpm build` — clean (TypeScript + Vite). Server and UI both typecheck.
- **Docker**: image rebuilt; `abud-shorts-app`, `abud-shorts-render-worker`, `abud-shorts-n8n`,
  and `abud-shorts-postgres` all healthy. No soak or stress testing was run.

### 11. ElevenLabs Credential State

| Item | State |
| --- | --- |
| Configured | **NO** — `provider_credentials_vault` contains 0 rows and `ELEVENLABS_API_KEY` is empty |
| Live Verified | **NO** |
| Voices discovered | **0** — discovery requires a key; nothing was fabricated |
| Previews generated | **0** — no ElevenLabs quota was spent |

No full production video was generated during this work.

### 12. Remaining Blocker

**Human Arabic voice selection.** The next steps belong to the product owner:

1. Providers → ElevenLabs → Configure → enter the API key → Test Connection.
2. Voice Lab → audition voices with the Egyptian reference script.
3. Select the preferred voice → Set as default Arabic voice.
4. Produce one final Arabic video for acceptance.

Until step 1 is done, Arabic production correctly reports NOT READY and Arabic jobs are refused
with an actionable message.
