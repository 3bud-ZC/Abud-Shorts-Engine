#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine V2 - Upgrade entry point (Linux / macOS)
# ==============================================================================
# Kept so existing documentation and habits keep working. The real updater is
# scripts/host/abud-update.sh, which is also what `abud-shorts update` runs:
# one code path, one set of safety checks, one rollback.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ABUD_HOME="${ABUD_HOME:-/opt/abud-shorts}"

for candidate in \
  "$SCRIPT_DIR/scripts/host/abud-update.sh" \
  "$ABUD_HOME/current/scripts/host/abud-update.sh"
do
  if [ -x "$candidate" ] || [ -f "$candidate" ]; then
    exec bash "$candidate" "$@"
  fi
done

echo "Error: the ABUD Shorts updater was not found." >&2
echo "On an installed system, run: sudo abud-shorts update" >&2
exit 1
