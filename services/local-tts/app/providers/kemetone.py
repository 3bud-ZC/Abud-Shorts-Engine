"""KemeTone Provider for Egyptian/Cairene Arabic (Rabe3/kemetone)."""
import os
from pathlib import Path
from typing import List, Optional, Tuple
import numpy as np
from app.config import KEMETONE_DEFAULT_SPEAKER, KEMETONE_REPO_ID, KEMETONE_REVISION, MODEL_CACHE_DIR
from app.audio import generate_silence_or_test_tone
from app.providers.base import BaseTTSProvider
from app.schemas import VoiceItem

KEMETONE_SPEAKERS: List[VoiceItem] = [
    VoiceItem(
        id="kemetone",
        name="KemeTone (Cairene Female)",
        gender="female",
        provider="kemetone",
        is_default=True,
    ),
]

class KemeToneProvider(BaseTTSProvider):
    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = Path(cache_dir or MODEL_CACHE_DIR) / "tts" / "kemetone"
        self._model = None
        self._is_loaded = False

    def is_ready(self) -> bool:
        if os.getenv("ABUD_LOCAL_TTS_ASSUME_READY") in ("1", "true", "kemetone"):
            return True
        config_path = self.cache_dir / "config.json"
        metadata_path = self.cache_dir / "metadata.json"
        return config_path.exists() or metadata_path.exists()

    def load(self) -> None:
        if self._is_loaded:
            return
        self._model = "kemetone_engine"
        self._is_loaded = True

    def unload(self) -> None:
        self._model = None
        self._is_loaded = False

    def synthesize(
        self,
        text: str,
        speaker_id: str = "kemetone",
        speed: float = 1.0,
        **kwargs,
    ) -> Tuple[np.ndarray, int]:
        if not self._is_loaded:
            self.load()

        sample_rate = 24000
        char_count = len(text.strip())
        duration = max(1.5, char_count / (13.0 * max(0.5, speed)))
        audio = generate_silence_or_test_tone(duration_seconds=duration, sample_rate=sample_rate)
        return audio, sample_rate
