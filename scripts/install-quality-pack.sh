#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine - Quality Runtime Pack Installer (Shell)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-"${SCRIPT_DIR}/../.venv-quality"}"

echo "======================================================================"
echo " ABUD Shorts Engine - Quality Runtime Pack (CPU) Setup"
echo "======================================================================"

if ! command -v python3 &>/dev/null; then
    echo "Error: python3 is required on PATH but was not found." >&2
    exit 1
fi

echo "[✓] Python detected: $(python3 --version)"

if [ ! -d "${TARGET_DIR}" ]; then
    echo "[*] Creating isolated virtual environment at ${TARGET_DIR} ..."
    python3 -m venv "${TARGET_DIR}"
else
    echo "[✓] Virtual environment exists at ${TARGET_DIR}"
fi

VENV_PYTHON="${TARGET_DIR}/bin/python"

echo "[*] Installing Quality Runtime Pack dependencies..."
"${VENV_PYTHON}" -m pip install --quiet --upgrade pip
"${VENV_PYTHON}" -m pip install --quiet \
    "scenedetect==0.7.1" \
    "rembg==2.0.81" \
    "onnxruntime==1.29.0" \
    "librosa==0.11.0" \
    "soundfile==0.14.0" \
    "edge-tts==7.2.8" \
    "pillow" \
    "fastapi" \
    "uvicorn" \
    "opencv-python"

echo "[*] Running verification sanity checks..."
"${VENV_PYTHON}" -c "
import scenedetect
import rembg
import librosa
import edge_tts
print('Quality Pack verified successfully.')
"

echo "======================================================================"
echo " Quality Runtime Pack is ready for production."
echo "======================================================================"
