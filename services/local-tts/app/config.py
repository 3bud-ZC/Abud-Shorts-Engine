"""Configuration for Local Egyptian TTS Service."""
import os
from pathlib import Path

PORT = int(os.getenv("PORT", "8765"))
INTERNAL_SERVICE_TOKEN = os.getenv("INTERNAL_SERVICE_TOKEN", "")

# Persistent model cache root
DEFAULT_CACHE_DIR = (
    "/models"
    if os.getenv("DOCKER") == "true"
    else str(Path(__file__).resolve().parent.parent.parent.parent / "data-dev" / "models")
)
MODEL_CACHE_DIR = os.getenv("ABUD_MODEL_CACHE_DIR", DEFAULT_CACHE_DIR)

# HuggingFace pinned revisions
VOICETUT_REPO_ID = "mohammedaly22/VoiceTut-TTS"
VOICETUT_REVISION = "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3"
VOICETUT_DEFAULT_SPEAKER = os.getenv("VOICETUT_DEFAULT_SPEAKER", "Mohamed")

KEMETONE_REPO_ID = "Rabe3/kemetone"
KEMETONE_REVISION = "9d65fab8cd71bc31a248e53bd18fe94941753aa6"
KEMETONE_DEFAULT_SPEAKER = "kemetone"

# Concurrency & idle management
MAX_CONCURRENCY = 1
IDLE_UNLOAD_SECONDS = int(os.getenv("LOCAL_TTS_IDLE_UNLOAD_SECONDS", "600"))
DEFAULT_SAMPLE_RATE = 24000
