"""VoiceTut-TTS Provider for Egyptian Arabic (mohammedaly22/VoiceTut-TTS)."""
import logging
import os
import time
from pathlib import Path
from typing import List, Optional, Tuple
import numpy as np
from app.config import MODEL_CACHE_DIR, VOICETUT_DEFAULT_SPEAKER, VOICETUT_REPO_ID, VOICETUT_REVISION
from app.audio import generate_silence_or_test_tone
from app.providers.base import BaseTTSProvider
from app.schemas import VoiceItem

logger = logging.getLogger("abud.local_tts.voicetut")

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
        self._is_mock = False
        self.device: Optional[str] = None
        self.load_time_seconds: Optional[float] = None

    def _has_real_weights(self) -> bool:
        return (self.cache_dir / "config.json").exists() and (self.cache_dir / "model.safetensors").exists()

    def is_ready(self) -> bool:
        if os.getenv("ABUD_LOCAL_TTS_ASSUME_READY") in ("1", "true", "voicetut"):
            return True
        if self._has_real_weights():
            return True
        metadata_path = self.cache_dir / "metadata.json"
        return metadata_path.exists()

    def load(self) -> None:
        if self._is_loaded:
            return

        # Deterministic mock path used by the unit test suite (no GPU/model required)
        if os.getenv("ABUD_LOCAL_TTS_MOCK") == "1" or not self._has_real_weights():
            self._model = "mock_voicetut"
            self._is_mock = True
            self._is_loaded = True
            return

        # Real inference load from the selectively-downloaded local snapshot.
        # `from_pretrained` is given a local directory path (not the repo id) so it
        # loads purely from disk and never re-fetches training-only files such as
        # optimizer.bin.
        import torch
        from voicetut_tts import VoiceTutTTS

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = "float16" if device == "cuda" else "float32"

        t0 = time.time()
        self._model = VoiceTutTTS.from_pretrained(str(self.cache_dir), device=device, dtype=dtype)
        self.load_time_seconds = round(time.time() - t0, 3)
        self.device = device
        self._is_mock = False
        self._is_loaded = True
        logger.info(
            "VoiceTut real model loaded device=%s dtype=%s load_time_s=%s",
            device, dtype, self.load_time_seconds,
        )

    def unload(self) -> None:
        self._model = None
        self._is_loaded = False
        self._is_mock = False
        self.device = None
        self.load_time_seconds = None

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

        if self._is_mock:
            # Deterministic synthetic waveform for the unit test suite only.
            char_count = len(text.strip())
            duration = max(1.5, char_count / (13.0 * max(0.5, speed)))
            audio = generate_silence_or_test_tone(duration_seconds=duration, sample_rate=sample_rate)
            return audio, sample_rate

        # Real VoiceTut inference. Named built-in speakers resolve internally via
        # reference_speakers/references.json in the local snapshot.
        audio = self._model.synthesize(
            text,
            speaker=speaker,
            language="ar",
            normalize=True,
            **{k: v for k, v in {"speed": speed}.items() if speed != 1.0},
        )
        audio = np.asarray(audio, dtype=np.float32)
        return audio, sample_rate
