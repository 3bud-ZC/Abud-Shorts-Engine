"""One-off real selective download of VoiceTut-TTS pinned inference files (Pass 9.8)."""
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

REPO_ID = "mohammedaly22/VoiceTut-TTS"
REVISION = "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3"

ALLOW_PATTERNS = [
    "config.json",
    "chat_template.jinja",
    "model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "reference_speakers/*",
]

target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent.parent / "data-dev" / "models" / "tts" / "voicetut"
target.mkdir(parents=True, exist_ok=True)

print(f"Downloading {REPO_ID}@{REVISION} -> {target}")
path = snapshot_download(
    repo_id=REPO_ID,
    revision=REVISION,
    local_dir=str(target),
    allow_patterns=ALLOW_PATTERNS,
)
print(f"Done: {path}")
