"""Abstract Base Provider for Local TTS Models."""
from abc import ABC, abstractmethod
from typing import Tuple
import numpy as np

class BaseTTSProvider(ABC):
    @abstractmethod
    def is_ready(self) -> bool:
        """Returns True if the model weights are downloaded and verified."""
        pass

    @abstractmethod
    def load(self) -> None:
        """Loads model into memory/device."""
        pass

    @abstractmethod
    def unload(self) -> None:
        """Unloads model to free memory."""
        pass

    @abstractmethod
    def synthesize(
        self,
        text: str,
        speaker_id: str = "Mohamed",
        speed: float = 1.0,
        **kwargs,
    ) -> Tuple[np.ndarray, int]:
        """Synthesizes text and returns (audio_array, sample_rate)."""
        pass
