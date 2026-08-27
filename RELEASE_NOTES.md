# Release Notes — ABUD Shorts Engine v2.3.0

**Product:** ABUD Shorts Engine
**Release Version:** `2.3.0`
**Release Channel:** stable
**Database Schema:** `2.13.0`
**Previous Stable:** `2.2.0`

ABUD Shorts Engine v2.3.0 is a major product upgrade. It keeps the local-first
video engine and the self-hosted, no-code operating model of v2.2.0, and
rebuilds the product experience around it: a prompt-first Create Video studio, a
reusable Media Library and Character Profiles, professional Brand Kits and
Templates, a redesigned Productions view and Video Library, a clearer Publishing
and Integrations experience, and a fully bilingual English/Arabic interface with
right-to-left support across every operator and customer screen.

Existing v2.2.0 installations upgrade in place through the same online updater,
with a pre-upgrade backup, verification and automatic rollback on failure. The
database change from schema 2.12.0 to 2.13.0 is additive only; existing
productions, videos, settings and account data are preserved.

---

## Highlights

- **Prompt-first production.** A description is enough to make a video. Every
  other control has a sensible default and only appears when you want it.
- **Reusable Media Library and Character Profiles.** Upload images, clips, logos,
  audio and references once; organise them into folders with tags; reuse them
  across productions.
- **Professional Brand Kits and Templates.** Colours, typography, logos,
  watermark, intro/outro and voice/caption defaults live in a Brand Kit.
  Templates capture a full studio setup, with variables, favourites and
  archiving.
- **Redesigned Productions and Video Library.** Server-side search, filtering and
  pagination; a customer-friendly status and progress model; a live production
  timeline; clear guidance when something needs attention.
- **Clearer Publishing and Integrations.** No-code provider setup with masked,
  write-only secrets and honest readiness states; scheduling, retry and
  connected-account management for the supported platforms.
- **Bilingual product.** English and Arabic are both first-class interface
  languages with full RTL layout. The interface language is independent of the
  language your videos are narrated in.
- **More accurate video output.** Duration accuracy, inter-scene audio
  continuity, modernised Motion Graphics, five professional caption styles and
  separate technical and creative quality scoring.
- **Safe in-place upgrade.** The v2.2.0 → v2.3.0 update path was rehearsed
  end-to-end in an isolated environment: version check, package and image
  verification, pre-upgrade backup, additive migration, health verification,
  rollback on a failed candidate, and full data preservation.

---

## Create Video

Create Video is now prompt-first. Type what you want and the engine resolves the
video type, visuals, narration, captions and providers automatically. Everything
else is optional:

- **Simpler by default, detailed when needed.** Duration, language, aspect
  ratio, resolution, quality, visual source, stock and AI providers, voice
  provider and caption style all carry defaults, so nothing but a prompt is
  required before you press Create. Advanced controls are available for
  operators who want to set them.
- **Video type.** An **Auto** type leads the list and lets the engine choose the
  treatment; specific types (Social / Reel, Product Ad, Motion Graphics,
  Animated Explainer, Educational, Cinematic Stock, Website Promo, Custom Media)
  are available with plain-language names.
- **Visual source policy.** Choose Auto, Stock, Uploaded Media, AI Generated or
  Mixed. Dependent controls (stock provider, AI visual provider, media
  selection) appear only when they apply, and an unconfigured provider is shown
  as needing setup rather than being silently selectable.
- **Brand, Template and Character selection.** Pick a Brand Kit, start from a
  built-in or custom Template, and attach a Character Profile. Media is selected
  from the Library in a multi-select grid, and the exact selected asset IDs are
  recorded on the production.
- **Reliable duration handling.** For a requested short (roughly 10–15 seconds),
  the finished video keeps the requested length: narration is never clipped or
  over-sped, a scene never overruns its share of the timeline, and a deliberate
  visual/music hold used to reach the requested duration is treated as editorial
  pacing rather than dead air. Where a small residual variance remains, Video
  Details reports the real duration and scores honestly.
- **Captions.** Captions are an explicit On/Off control. When on, choose from
  five professional styles — Clean, Karaoke, Bold Social, Minimal, Cinematic.
  When off, the setting is carried end to end for clean B-roll.
- **Save as Template.** Save the current studio configuration as a new custom
  Template directly from Create Video.
- **Pre-flight readiness.** A production that could not succeed — for example
  Stock-only with no stock provider, or Arabic narration without a configured
  ElevenLabs credential — is stopped before it starts, with the first blocking
  requirement and the action that resolves it.

---

## Video Quality & Rendering

- **Duration accuracy.** The narration budget was recalibrated to the shipped
  local voices, over-aggressive narration compaction was relaxed and moved to
  clause boundaries, and the scene visual duration now holds toward the resolved
  scene budget so a short does not collapse to the length of its spoken
  segments.
- **Audio continuity.** Spoken narration duration is measured from the mastered
  voice file and scenes wrap it tightly with bounded natural breathing pauses.
  An automated dead-air analyzer flags long silences, and a per-scene
  intentional-hold allowance means holding a scene to reach the requested
  duration is not penalised as dead air.
- **Motion Graphics.** Rudimentary spinning circles and percentage arcs were
  replaced with editorial metric cards, count-up animations, category badges and
  smooth progress bars. Stock queries rotate per scene so multi-scene scripts
  explore varied angles instead of repeating a search.
- **Caption rendering.** Five distinct styles, a safe bottom margin in vertical
  9:16 so captions clear the platform UI overlay, and consistent rendering
  across the composition and the burned-in subtitle path.
- **Arabic text rendering.** Arabic captions and on-screen text use bundled
  Arabic-first fonts with correct shaping and bidirectional handling; no font is
  fetched over the network at render time.
- **Technical and creative quality scoring.** Every finished video records a
  Technical Quality score (video/audio/container validity, duration variance)
  and a separate Creative Quality score and grade (audio continuity, visual
  diversity, media relevance, caption legibility, call-to-action presence).
  Video Details shows both separately; a legacy video that never recorded a
  metric shows "Not available for this older production" rather than a zero.
- **Production reliability.** Retry never overwrites the failed record and
  creates a genuine new attempt; cancel is available only for non-terminal
  states and cannot later be flipped back to Ready; stage-level checkpoint
  resume is unchanged.

**Verification evidence (not a guaranteed output score).** A zero-paid reference
production — English, local Kokoro voice, Motion Graphics, 9:16, no stock or
paid AI providers — was produced during release verification. It requested 12
seconds and rendered 12.05 seconds, with a technical score of 100 and a creative
score of 99 (grade A). This demonstrates the pipeline can reach the target on a
representative local production; it is not a promise that every video always
scores 100. Actual scores depend on the prompt, the chosen providers and the
source material.

---

## Media Library

A single Media Library holds reusable assets:

- **Images, video clips, logos, audio and references**, with per-asset metadata.
- **Folders and tags** for organisation, plus search and filtering by type,
  purpose, folder and tag.
- **Duplicate detection** on upload — a likely duplicate is surfaced, never
  auto-deleted.
- **Context-aware usability** — an asset the library holds but cannot use for a
  given purpose stays visible and is simply not selectable there.
- **Safe removal.** Delete is an archive, not a hard delete, and is
  dependency-aware: an asset a Brand or production still references is protected.
- **Customer-safe delivery.** Media responses expose preview URLs, sizes and
  counts only — never filesystem paths, checksums or background-removal
  internals.

---

## Character Profiles

Character Profiles let you reuse a recurring subject across productions:

- **Reusable profiles** with a name and description.
- **Multiple reference images**, with one marked as the **primary reference**.
- **Revision history** on every change, and an **immutable production snapshot**
  so a later profile edit never rewrites an existing production.
- **Honest provider readiness.** A production that needs a reference-capable
  visual provider is blocked until one is configured, and provider capability
  metadata stays truthful — the product does not imply a capability that is not
  actually available.

Character identity consistency depends on the configured visual provider and its
capabilities. The product does not claim perfect or guaranteed character
consistency.

---

## Brand Kits

A Brand Kit carries a brand's full identity and production defaults:

- **Colours** — primary, secondary, accent, background and text, each with
  provenance (customer-set, derived or default).
- **Typography** — heading, body and caption fonts from the bundled Arabic-first
  font set.
- **Logos** — chosen from the Media Library and validated on save.
- **Watermark** — asset, position, size, opacity and safe-zone handling.
- **Intro / outro** — logo reveal or brand title; call-to-action card, logo +
  website or logo + social.
- **Defaults** — call-to-action text, tone of voice, keywords and preferred /
  avoided phrases, and per-brand video defaults (language, duration, aspect
  ratio, quality, visual source, music mood, character profile).
- **Voice and caption defaults** that flow into the resolved production.
- **Revision-safe history.** Every create and update appends a revision entry,
  and each production freezes a Brand snapshot tagged with the brand revision,
  so editing a brand never changes an existing video.
- **Duplicate, set default, archive and restore** — archiving is dependency-aware
  and never a hard delete.

---

## Templates

- **Built-in and custom templates.** The built-in business templates now carry a
  category, variables and configuration defaults, and merge with your own custom
  templates in one list.
- **Full studio capture.** A custom template stores production mode, duration,
  aspect ratio, quality, visual source, media policy, caption style, brand,
  character profile, selected media and prompt guidance, plus up to twelve typed
  variables.
- **Duplicate, favourite, archive and restore.** Built-in templates are
  protected: edit or delete asks you to duplicate first; favouriting a built-in
  is remembered without changing the definition.
- **Save as Template / Use Template.** Save the current Create Video setup as a
  template, and start a new production from any template with its variables.
- **Filtering** by source (all / built-in / custom), category, favourites and
  archived.
- **Revision-safe history.** Each production freezes a Template snapshot with its
  revision, so editing a template never rewrites an earlier video.

---

## Productions

The Productions view tracks every video request from prompt to finished video:

- **Search, filter and pagination** are performed on the server. Filter by
  status group (Active / Ready / Needs attention / Cancelled), search text,
  language, brand, template, character profile, aspect ratio, creation mode and
  date range; page through results with a cursor rather than loading everything.
- **Customer status and progress.** A small, consistent status vocabulary —
  Queued, Preparing, Generating, Rendering, Ready, Needs attention, Cancelled —
  is shown the same way on the dashboard, the Productions list and Production
  Details. An unrecognised internal state is shown as "Needs attention", never
  as Ready.
- **Live timeline.** Production Details shows a progress story — request
  received, script prepared, narration generated, visuals prepared, captions
  prepared, rendering, quality check, ready — built from real progress evidence,
  never fabricated ahead of it.
- **Retry and cancel.** Retry creates a genuine new attempt linked to the
  original and never overwrites the failed record. Cancel is offered only for
  productions that are still running.
- **Failure guidance.** When a production needs attention, Production Details
  shows a plain-language message, a reference code, a Retry action and — when
  the cause is a configuration issue — a link to Integrations. The raw error,
  stack trace or provider payload is never shown.
- **Historical snapshots.** A past production shows the Brand, Template and
  Character snapshot it actually used, with its revision number, so it is never
  re-resolved against a newer profile.

---

## Video Library

- **Finished-video management** — separate from Productions. Cards show a
  thumbnail, a real title (never the raw filename), duration, aspect ratio,
  language, date and a technical-score badge.
- **Preview and download.** Authenticated media delivery with HTTP range
  support; downloads use a sanitised filename.
- **Quality information.** Technical Quality and Creative Quality are shown as
  separate scores, with the creative grade and diagnostics.
- **Revisions.** Revision Studio and version history are preserved; original
  outputs are never overwritten and historical revisions are not auto-deleted.
- **Publishing entry points.** Publish and Schedule actions on the Video Library
  and Video Details pass the exact selected video into the Publishing workflow.
- **Server-side search and filtering** by language, aspect ratio, brand and sort
  order (newest, oldest, longest, shortest), with cursor pagination.

---

## Publishing

Publishing distributes finished videos to your connected social channels:

- **Scheduling** — schedule a post for a later time; scheduled posts are saved
  safely and continue after the application restarts.
- **Retry** — failed publications can be retried per platform; a failure on one
  platform does not affect another.
- **Platform-specific preparation** — each destination gets the metadata and
  pre-flight checks it needs.
- **Connected-account management** — connect, test and disconnect accounts.
  Disconnect history is preserved.
- **Supported destinations** — YouTube, TikTok, Instagram, Facebook, Telegram,
  and Upload-Post (a single service that fans out to several platforms). YouTube,
  TikTok and Instagram/Facebook connect through the provider's own sign-in
  (OAuth); Telegram and Upload-Post use a token you paste once.

**External publishing requires your own accounts.** No social account is
connected out of the box, and no real social post was published as part of this
release's verification. To publish, you connect your own account for each
platform and complete that provider's setup. The normal interface never shows a
raw provider response, sign-in code, access or refresh token, or stored
credential.

---

## Integrations

Integrations is the no-code place to connect the services the engine can use:

- **No-code configuration.** Each provider card shows what it is for, what it
  costs, its current status and a Configure or Test action. Setup never requires
  editing a file or knowing an environment variable name.
- **Masked, write-only secrets.** A key is stored encrypted in the existing
  Provider Vault, masked after saving and never shown again.
- **Customer-friendly readiness.** Provider state uses a small, honest set of
  words (for example Not Configured, Ready to Connect, Connected, Needs
  Attention) rather than collapsing everything to "working" or "broken".
- **Local and free options work with no key:**
  - **Kokoro** — local English narration, always available.
  - **Built-in Creative Director** — writes the script and scene plan locally.
- **Optional cloud providers, configuration-dependent:**
  - **ElevenLabs** — used for the approved Arabic production voice when a
    credential is configured; also available for premium English voices.
  - **Pexels** — free stock footage, requires your own Pexels API key.
  - **AI visual providers** (for example Google Veo, fal.ai) — optional and
    depend on your own account and the provider's availability and quota.

---

## Arabic & English Interface

- **English and Arabic are both first-class interface languages.** Switching is
  a single setting.
- **Full right-to-left support.** Layout, navigation, forms, tables and status
  badges mirror correctly in Arabic; technical text (URLs, IDs, versions,
  checksums) stays left-to-right and is not reordered.
- **Every primary customer and operator surface is localised** — Dashboard,
  Create Video, Productions, Video Library, Media, Characters, Brands,
  Templates, Publishing, Integrations, Settings, Providers, System Health, Setup
  and Sign-in.
- **Interface language and narration language are independent.** An Arabic
  interface can produce English videos and an English interface can produce
  Arabic videos.
- **Western Arabic digits (0–9)** are used in both languages so IDs, versions
  and sizes read consistently.

---

## Installation & Updates

**Existing v2.2.0 installations upgrade in place** using the same online updater
that shipped with v2.2.0. The update process:

1. Checks that the published release is newer and valid.
2. Downloads the client package and verifies its checksum, and verifies the
   application image by its content digest.
3. Creates a pre-upgrade database and configuration backup.
4. Switches to the new version and applies the database migration
   (2.12.0 → 2.13.0).
5. Waits for the application and video engine to report healthy, and confirms
   the running version and schema.
6. On any failure, automatically rolls back to the previous version; the
   pre-upgrade backup is kept.

The v2.2.0 → v2.3.0 update path was rehearsed end-to-end in an isolated
environment separate from any live installation. The rehearsal exercised the
version check, package and image-digest verification, the pre-upgrade backup,
the additive migration, application and video-engine health checks, a
deliberately failed candidate with automatic rollback, and confirmed that
existing productions, videos, settings, brands and the administrator account
were preserved.

**Windows:** use the existing ABUD Shorts updater — the **ABUD Shorts → ABUD
Shorts - Update** Start Menu shortcut, or `UPDATE-ABUD-SHORTS.bat` in the
install folder.

**Linux / VPS:**

```bash
sudo abud-shorts update
```

The application container is never given control of Docker; updates are applied
by the host-side updater, and the web interface only reports update status.

The release process publishes an immutable application image referenced by its
content digest, together with a signed-off client package and update manifest.
An installation only sees v2.3.0 as an available update once that release has
been published on the stable channel.

---

## Data & Compatibility

- **Schema moves from 2.12.0 to 2.13.0.** The migration is additive and
  non-destructive: it adds new columns and tables and creates indexes, and it
  does not drop, truncate, retype or delete any existing data.
- **Your data is preserved.** In the isolated update rehearsal, existing
  productions, generated videos, video revisions, settings, brands, the
  administrator account and stored provider credentials were unchanged, and the
  content of existing video files was byte-for-byte identical after the upgrade.
- **Older records keep working.** A production created before v2.3 that has no
  Brand, Template or Character snapshot, and a video that never recorded a
  creative score, are shown correctly — with "Not available for this older
  production" where a newer field is genuinely absent — rather than as an error
  or a misleading zero.
- **A code rollback to v2.2 is safe.** The v2.3 additions are ignored by the
  older build.

---

## Security & Privacy

- **Secrets stay masked and write-only.** Provider keys are stored encrypted,
  masked after saving and never returned by the API.
- **No raw provider secrets in the normal interface** — no access or refresh
  tokens, sign-in codes, encrypted credentials or raw provider responses on a
  customer screen, and no environment-variable names in the setup workflow.
- **No filesystem-path leakage.** Media, production, video, settings and system
  responses expose sizes, counts and booleans — not container paths, checksums
  or internal storage details.
- **Authenticated media delivery.** Previews, thumbnails and downloads require a
  valid session; media access tokens travel on the request, never as visible
  text.
- **No generic command surface.** The web application exposes no route that runs
  host or shell commands, and is never given the Docker socket.
- **Safe updates.** Every update takes a pre-upgrade backup, verifies the
  package checksum and the image digest, verifies health and version after the
  switch, and rolls back automatically on failure.

---

## Requirements / Notes

- **Docker** (Docker Desktop on Windows, Docker Engine + Compose on Linux) is
  required for a self-hosted installation.
- **Optional integrations require your own credentials.** The engine runs fully
  without them using its local options.
- **External social publishing requires account and provider setup** for each
  platform you want to publish to.
- **Some AI visual providers depend on their own availability and quota** and may
  be unavailable independently of ABUD Shorts.
- **Arabic narration requires a configured ElevenLabs credential.** English
  production is unaffected and runs locally with Kokoro.

---

## Upgrade from v2.2.0

A backup is taken automatically before the update, and your data is preserved.
You do not need to reinstall over an existing installation, and you should not
do so unless support explicitly asks you to.

**Windows:** open the **ABUD Shorts** Start Menu folder and choose **ABUD Shorts
- Update** (or run `UPDATE-ABUD-SHORTS.bat` in the install folder). The updater
checks for the release, backs up, switches version, migrates, verifies health
and — if anything is wrong — returns to v2.2.0 automatically.

**Linux / VPS:**

```bash
sudo abud-shorts update
```

After the update, confirm the version and health from **Settings → Updates** and
**System Health**. Your previous version is kept for rollback, and the
pre-upgrade backup is retained.
