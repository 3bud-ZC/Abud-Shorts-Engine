# Release Notes - ABUD Shorts Engine V2.2.0

**Release Version:** `2.2.0`
**Release Channel:** stable
**Release Date:** 2026-08-25
**Database Schema:** `2.12.0`

ABUD Shorts Engine V2.2.0 is the client-ready V2 release: it keeps the
local-first video engine from V2.1 and adds the polished product shell,
approved Arabic voice routing, creative engine improvements, publishing
connectors, installer operations and online update system needed for customer
handoff.

## Highlights

- No-code dashboard, setup wizard, media library, brand profiles, templates,
  backup/restore, diagnostics, integrations and update center.
- Approved Arabic narration route: ElevenLabs / Mamdoh / Energetic Ad /
  `eleven_multilingual_v2`, with local Kokoro retained for English.
- Creative planning, motion graphics, beat-aware editing, Arabic caption
  shaping, smart cropping and differentiated business templates.
- Direct publishing implementations for YouTube, TikTok, Meta and Telegram,
  with OAuth, token refresh, pre-flight checks, error taxonomy and safe
  publication state handling.
- Customer delivery package for Windows and Linux/VPS with host-side update,
  backup, diagnostics, restart and rollback commands.
- Online updates consume a trusted release manifest and immutable GHCR image
  digest; the normal web app never receives Docker host control.

## Operator Commands

Linux/VPS:

```bash
sudo abud-shorts status
sudo abud-shorts update --check
sudo abud-shorts update
sudo abud-shorts backup
sudo abud-shorts diagnostics
sudo abud-shorts restart
sudo abud-shorts rollback
```

Windows installations use the **ABUD Shorts** Start Menu shortcuts, or the
`START-ABUD-SHORTS.bat` / `UPDATE-ABUD-SHORTS.bat` / `BACKUP-ABUD-SHORTS.bat` /
`DIAGNOSTICS-ABUD-SHORTS.bat` files in the install folder, for Status, Update,
Backup and Diagnostics. Installing is a double-click of
`INSTALL-ABUD-SHORTS.bat` after Docker Desktop is running.

## Data Safety

Updates preserve PostgreSQL data, videos, uploaded media, brands, settings,
Provider Vault records, OAuth/social accounts, publication history, backups and
n8n state. Normal update and rollback paths do not remove Docker volumes and do
not run destructive prune operations.

## External Providers

External AI and publishing providers require customer-owned credentials. This
release implements and verifies provider contracts in code and tests, but does
not claim live publication to YouTube, TikTok, Instagram, Facebook or Telegram
without a configured customer account.

## Upgrade Notes

V2.2.0 can be installed from the client package or applied online through the
host updater after the published release manifest is available. Existing V2.1
customer data is kept outside release directories.
