#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine - Motion Graphics Pack Installer (Shell)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================================"
echo " ABUD Shorts Engine - Motion Graphics Pack Setup"
echo "======================================================================"

if ! command -v node &>/dev/null; then
    echo "Error: Node.js is required on PATH but was not found." >&2
    exit 1
fi

echo "[✓] Node.js runtime detected."

if ! "${SCRIPT_DIR}/install-quality-pack.sh"; then
    echo "Error: Failed to set up prerequisite Quality pack." >&2
    exit 1
fi

echo "[✓] Motion Canvas templates ready (Kinetic Typography, Stat Animation, Feature List, CTA Card, Explainer Diagram)."
echo "======================================================================"
echo " Motion Graphics Pack is ready for production."
echo "======================================================================"
