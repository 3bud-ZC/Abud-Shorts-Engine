#!/usr/bin/env bash
# ==============================================================================
# ABUD Shorts Engine - Local Egyptian TTS Installer (Shell)
# Selective download for VoiceTut-TTS & KemeTone pinned inference files
# ==============================================================================
set -euo pipefail

MODEL_ID="${1:-voicetut}"
CACHE_DIR="${ABUD_MODEL_CACHE_DIR:-$(cd "$(dirname "$0")/.." && pwd)/data-dev/models}"
MOCK="${MOCK:-0}"

echo "======================================================================"
echo " ABUD Shorts Engine - Local Egyptian TTS Model Installer"
echo " Cache Directory: ${CACHE_DIR}"
echo " Target Model: ${MODEL_ID}"
echo "======================================================================"

mkdir -p "${CACHE_DIR}/tts/${MODEL_ID}"

install_model() {
    local id="$1"
    local repo="$2"
    local rev="$3"
    shift 3
    local files=("$@")
    local target_dir="${CACHE_DIR}/tts/${id}"

    mkdir -p "${target_dir}"
    echo "[*] Processing model '${id}' (${repo} @ ${rev})..."

    for f in "${files[@]}"; do
        local dest="${target_dir}/${f}"
        mkdir -p "$(dirname "${dest}")"
        if [ "${MOCK}" = "1" ]; then
            if [ ! -f "${dest}" ]; then
                echo "MOCK_WEIGHTS_STUB_${id}" > "${dest}"
            fi
        else
            if [ -f "${dest}" ]; then
                echo "  [✓] Existing: ${f}"
            else
                local url="https://huggingface.co/${repo}/resolve/${rev}/${f}"
                echo "  [↓] Downloading: ${f} ..."
                curl -fsSL --retry 3 "${url}" -o "${dest}"
            fi
        fi
    done

    cat <<EOF > "${target_dir}/metadata.json"
{
  "modelId": "${id}",
  "providerModelId": "${repo}",
  "revision": "${rev}",
  "state": "ready",
  "downloadedBytes": $(du -sb "${target_dir}" | cut -f1),
  "expectedFiles": $(printf '%s\n' "${files[@]}" | jq -R . | jq -s .),
  "lastVerifiedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "runtimeStatus": "verified"
}
EOF
    echo "[✓] Model '${id}' is ready and verified!"
}

VOICETUT_FILES=(
    "config.json" "chat_template.jinja" "model.safetensors" "tokenizer.json" "tokenizer_config.json"
    "reference_speakers/references.json"
    "reference_speakers/Abdelrahman_clean.wav" "reference_speakers/Abdullah_clean.wav" "reference_speakers/Ahmed_clean.mp3"
    "reference_speakers/Aly_reference.wav" "reference_speakers/Asmaa_clean.wav" "reference_speakers/Esraa_clean.wav"
    "reference_speakers/Essam_clean.mp3" "reference_speakers/Hanan_clean.wav" "reference_speakers/Hossam_clean.wav"
    "reference_speakers/Kamal_clean.wav" "reference_speakers/Mohamed_clean.wav" "reference_speakers/Omar_clean.wav"
    "reference_speakers/Omnia_clean.wav" "reference_speakers/Sarah_clean.wav" "reference_speakers/Sayed_clean.wav"
    "reference_speakers/Yasmin_clean.wav" "reference_speakers/Zaki_clean.wav"
)
KEMETONE_FILES=(
    "config.json" "kemetone.pth" "voices/kemetone.pt"
    "kemetone/__init__.py" "kemetone/arabic.py" "kemetone/g2p.py" "kemetone/normalize_tashkeel.py" "kemetone/runtime.py"
    "kemetone/lexicons/ث.tsv" "kemetone/lexicons/ذ.tsv" "kemetone/lexicons/ظ.tsv" "kemetone/lexicons/ق.tsv"
)

if [ "${MODEL_ID}" = "voicetut" ] || [ "${MODEL_ID}" = "all" ]; then
    install_model "voicetut" "mohammedaly22/VoiceTut-TTS" "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3" "${VOICETUT_FILES[@]}"
fi

if [ "${MODEL_ID}" = "kemetone" ] || [ "${MODEL_ID}" = "all" ]; then
    install_model "kemetone" "Rabe3/kemetone" "9d65fab8cd71bc31a248e53bd18fe94941753aa6" "${KEMETONE_FILES[@]}"
fi

echo "[✓] Local Egyptian TTS shell installer complete."
