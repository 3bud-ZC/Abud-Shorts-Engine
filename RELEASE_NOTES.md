# Release Notes — ABUD Shorts Engine V2.0.0

**Release Version:** `2.0.0`  
**Release Stage:** General Availability (GA)  
**Release Date:** 2026-08-23  

We are proud to announce the **General Availability (GA) release of ABUD Shorts Engine V2.0.0**. This major release establishes a production-grade, local-first vertical video creation, multi-platform scheduling, and social distribution platform.

---

## Key Capabilities & Features

### 1. Dual Creative Studio
- **Prompt Studio**: AI-assisted scene storyboarder and scriptwriter supporting Egyptian Arabic, Gulf Arabic, Modern Standard Arabic (MSA), and English.
- **Template Studio**: 6 high-conversion business templates (Product Ad, Restaurant Promo, Real Estate Showcase, Viral Hook, Educational Explainer, Event Promo) with custom brand injection.

### 2. 100% Free / Local Production Pipeline
- Complete end-to-end video creation without recurring cloud API fees.
- **Creative Director**: Local deterministic rule-based AI script and storyboard planner.
- **Visual Intelligence**: Semantic search integration with curated HD Pexels vertical video assets.
- **Voice Synthesis**: Embedded high-performance local Kokoro TTS engine (`q4` precision).
- **Subtitles & Captions**: Embedded Whisper.cpp (`tiny.en`) word-level subtitle synchronizer with RTL Arabic font support.
- **Rendering Engine**: Remotion composition engine and FFmpeg 4.4 audio/video encoder.

### 3. Optional Cloud AI Extensions
- **Google Gemini**: Dynamic script generation and Creative Director enhancements.
- **ElevenLabs**: Multilingual neural speech synthesis.
- **Google Veo & fal.ai**: Synthetic AI video clip generation.
*(Note: External AI providers require customer-provided credentials; unconfigured providers remain cleanly marked as "Not Configured / Not Live Verified" in the dashboard).*

### 4. Multi-Platform Publishing & Scheduling
- **Aggregated Distribution**: Upload-Post integration for one-click publishing to YouTube Shorts, Instagram Reels, TikTok, Facebook Reels, LinkedIn, X (Twitter), and Threads.
- **Direct Bot Integration**: Telegram bot direct channel distribution.
- **Direct Platform Connectors**: YouTube Data API v3, Meta Graph API, and TikTok OpenAPI.
- **Reliable Scheduler**: Atomic queue processing, automatic transient error retries (HTTP 429 backoff), dead-letter isolation, and real-time Server-Sent Events (SSE) publication stream.

### 5. Enterprise Security & Administration
- **Local Authentication**: PBKDF2 salted password hashing (100,000 rounds) with secure session management.
- **Zero Secret Exposure**: All API keys, tokens, and database credentials are redacted from logs, diagnostic exports, and UI payloads.
- **Container Isolation**: PostgreSQL, n8n, and render worker are restricted to private Docker bridge networking.
- **Security Headers**: Content Security Policy, X-Frame-Options, X-Content-Type-Options, and Strict-Transport-Security enforced.

### 6. Operations, Disaster Recovery & Upgrades
- **10-Step Setup Wizard**: Automated first-run verification and configuration.
- **Disaster Recovery**: Configurable backup engine (`config_only`, `config_db`, `full`) with SHA256 manifest verification and automated pre-restore snapshots.
- **One-Command Maintenance**: Safe `install`, `upgrade`, and `uninstall` scripts for Windows (PowerShell) and Linux/macOS (Bash).
- **System Telemetry**: Comprehensive diagnostic dashboard with storage breakdown and one-click diagnostic bundle export.

---

## Upgrade Information

To upgrade from earlier release candidates:
```powershell
.\upgrade.ps1
```
or on Linux/macOS:
```bash
./upgrade.sh
```

Existing database records, media assets, and configurations are preserved automatically.
