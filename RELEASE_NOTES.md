# ABUD Shorts Engine v2.4.0-rc.1

**Product:** ABUD Shorts Engine
**Release Version:** `2.4.0-rc.1`
**Release Channel:** development / local release candidate
**Database Schema:** `2.13.0` (unchanged from v2.3.1)
**Previous Stable:** `2.3.1`

This is a local release-candidate package for V2.4. It is not a public stable
release and must not be installed from the public latest channel until an
administrator explicitly approves the release.

---

## What's New

### Professional Video Engine

- Auto Professional now prioritizes real, relevant stock footage for normal
  business and educational shorts.
- The fast FFmpeg render path is used when a stock-heavy production qualifies,
  with Motion rendering kept for intentional graphic and animated explainer
  videos.
- Final-media QA checks coverage, black frames, text-only fallback, duration,
  audio continuity, captions and professional readiness before a video is
  accepted.

### Smarter Creative Planning

- Prompt Compiler turns user prompts into safer production specs with clearer
  facts, scene intent and customer-friendly decisions.
- Content safety keeps claims grounded and prevents invented contact channels.
- CTA handling preserves provenance, so customer-supplied contact details stay
  explicit and generated videos do not invent phone numbers, websites or social
  handles.

### Providers and Voice

- Free Only, Smart Budget and Best Available routing make provider selection
  more predictable.
- Paid video providers are gated: credentials alone do not authorize a paid
  generation.
- Kokoro remains the local/free English voice path.
- Arabic production voice uses the customer's persisted ElevenLabs default. The
  engine no longer falls back to the first listed voice.
- The Provider Vault stores configured provider credentials encrypted and shows
  only safe status and masked hints in the interface.

### Publishing

- Publishing now has a clearer provider lifecycle: implemented, configured,
  authenticated, healthy and live verified are reported separately.
- Manual publishing credentials are encrypted.
- OAuth setup shows browser-friendly callback URLs.
- Upload-Post, YouTube processing states, retry, idempotency, scheduler
  persistence, partial failure handling and safe Server-Sent Events have all
  been hardened.
- This candidate does not perform real external social publication during QA.

### Security and Operations

- Protected APIs require admin session or scoped API token access.
- Video preview/download routes support authenticated browser playback and byte
  ranges.
- Diagnostics, provider responses and logs are designed to avoid plaintext
  secrets, session tokens and raw OAuth values.
- Updates continue to use the host updater: checksum verification, pre-update
  backup, image switch, health checks and rollback metadata.

---

## Upgrade

Existing v2.3.1 installations should upgrade through the normal ABUD Shorts
updater once V2.4 is approved and published. Customers should not need Git,
source code, manual SQL or hand-edited Docker Compose files.

The database schema remains `2.13.0`. No new migration is required beyond the
schema already carried by v2.3.1, and the V2.4 changes are designed to preserve
existing videos, jobs, media, brands, settings, Provider Vault rows and
publication history.

v2.3.1 remains the current public stable release until an explicit release
approval is given.
