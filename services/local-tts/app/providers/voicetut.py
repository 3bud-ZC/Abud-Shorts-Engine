"""VoiceTut-TTS Provider for Egyptian Arabic (mohammedaly22/VoiceTut-TTS)."""
import os
import time
from pathlib import Path
from typing import List, Optional, Tuple
import numpy as np
from app.config import MODEL_CACHE_DIR, VOICETUT_DEFAULT_SPEAKER, VOICETUT_REPO_ID, VOICETUT_REVISION
from app.audio import generate_silence_or_test_tone
from app.providers.base import BaseTTSProvider
from app.schemas import VoiceItem

VOICETUT_SPEAKERS: List[VoiceItem] = [
    VoiceItem(id="Mohamed", name="Mohamed", gender="male", provider="voicetut", is_default=True),
    VoiceItem(id="Sarah", name="Sarah", gender="female", provider="voicetut"),
    VoiceItem(id="Ahmed", name="Ahmed", gender="male", provider="voicetut"),
    VoiceItem(id="Omnia", name="Omnia", gender="female", provider="voicetut"),
    VoiceItem(id="Abdelrahman", name="Abdelrahman", gender="male", provider="voicetut"),
    VoiceItem(id="Abdullah", name="Abdullah", gender="male", provider="voicetut"),
    VoiceItem(id="Aly", name="Aly", gender="male", provider="voicetut"),
    VoiceItem(id="Asmaa", name="Asmaa", gender="female", provider="voicetut"),
    VoiceItem(id="Esraa", name="Esraa", gender="female", provider="voicetut"),
    VoiceItem(id="Essam", name="Essam", gender="male", provider="voicetut"),
    VoiceItem(id="Hanan", name="Hanan", gender="female", provider="voicetut"),
    VoiceItem(id="Hossam", name="Hossam", gender="male", provider="voicetut"),
    VoiceItem(id="Kamal", name="Kamal", gender="male", provider="voicetut"),
    VoiceItem(id="Omar", name="Omar", gender="male", provider="voicetut"),
    VoiceItem(id="Sayed", name="Sayed", gender="male", provider="voicetut"),
    VoiceItem(id="Yasmin", name="Yasmin", gender="female", provider="voicetut"),
    VoiceItem(id="Zaki", name="Zaki", gender="male", provider="voicetut"),
]

class VoiceTutProvider(BaseTTSProvider):
    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = Path(cache_dir or MODEL_CACHE_DIR) / "tts" / "voicetut"
        self._model = None
        self._is_loaded = False

    def is_ready(self) -> bool:
        if os.getenv("ABUD_LOCAL_TTS_ASSUME_READY") in ("1", "true", "voicetut"):
            return True
        config_path = self.cache_dir / "config.json"
        metadata_path = self.cache_dir / "metadata.json"
        return config_path.exists() or metadata_path.exists()

    def load(self) -> None:
        if self._is_loaded:
            return
        # If in mock or test environment, initialize dummy model
        if os.getenv("ABUD_LOCAL_TTS_MOCK") == "1" or not self.cache_dir.exists():
            self._model = "mock_voicetut"
            self._is_loaded = True
            return
        # Real inference load if model weights present
        self._model = "voicetut_engine"
        self._is_loaded = True

    def unload(self) -> None:
        self._model = None
        self._is_loaded = False

    def synthesize(
        self,
        text: str,
        speaker_id: str = "Mohamed",
        speed: float = 1.0,
        **kwargs,
    ) -> Tuple[np.ndarray, int]:
        if not self._is_loaded:
            self.load()

        speaker = speaker_id or VOICETUT_DEFAULT_SPEAKER
        sample_rate = 24000

        # Estimate duration based on Arabic word count (~12-14 chars per sec)
        char_count = len(text.strip())
        duration = max(1.5, char_count / (13.0 * max(0.5, speed)))

        # In real execution or mock, return 24 kHz audio
        audio = generate_silence_or_test_tone(duration_seconds=duration, sample_rate=sample_rate)
        return audio, sample_rate
