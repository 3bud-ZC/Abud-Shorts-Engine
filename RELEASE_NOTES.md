# ABUD Shorts Engine v2.3.1

**Product:** ABUD Shorts Engine
**Release Version:** `2.3.1`
**Release Channel:** stable
**Database Schema:** `2.13.0` (unchanged from v2.3.0)
**Previous Stable:** `2.3.0`

v2.3.1 is a patch release. It fixes production rendering and duration issues
found on v2.3.0 and completes the Arabic localization of the Production Details
screen. There are no new features and no interface changes beyond the fixed
labels.

---

## What's Fixed

### Auto Video Rendering

- Auto productions now correctly fall back to the built-in Motion engine when
  stock footage providers are unavailable. Previously an Auto production whose
  creative plan had already selected a Motion treatment could still try to fetch
  stock footage and fail during media generation.
- On installations with no stock provider configured, an Auto production that
  reaches the Motion path now completes locally instead of stopping with a
  "Video render failed" error.

### Duration Accuracy

- Longer videos with short narration now keep the requested duration. A Motion
  scene deliberately continues its animation and music for the scene's planned
  length instead of ending as soon as the narration finishes.
- 30-second productions no longer collapse to roughly half their requested
  length. Speech is never sped up beyond its existing limits or clipped, and the
  held time is not counted as dead air.

Verification examples from this release (single runs, not a guarantee for every
video):

| Requested | Produced | Technical validation |
| --- | --- | --- |
| 30 seconds | 30.06 seconds | passed (score 100) |
| 12 seconds | 12.05 seconds | passed (score 100) |

### Better Error Messages

- When a render fails, the customer now sees a clearer, safer category (for
  example: rendering service needs another attempt, generated media could not be
  composed, a generated asset could not be read, or the system was low on
  resources) instead of a single generic message.
- The detailed technical reason is still recorded for support and is not shown
  on the normal customer screen.

### Arabic Interface

- The Production Details / Job Details screen is now fully localized in Arabic,
  including the execution progress labels, the production specification labels
  and the render-error heading.

---

## Upgrade

Existing v2.3.0 installations upgrade in place with the normal ABUD Shorts
updater. The update takes a pre-upgrade backup, verifies the download and rolls
back automatically if anything fails.

The database schema stays at `2.13.0`. **No database migration is required for
v2.3.1.** Existing productions, videos, media, settings and account data are
untouched.

v2.3.0 remains available and unchanged.
