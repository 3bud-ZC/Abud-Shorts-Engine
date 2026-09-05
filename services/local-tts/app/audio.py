"""Audio utilities: WAV encoding, duration measurement, base64 conversion."""
import base64
import io
import numpy as np
import scipy.io.wavfile as wavfile

def audio_to_wav_bytes(audio_data: np.ndarray, sample_rate: int = 24000) -> bytes:
    """Encodes a numpy audio array (float32 [-1.0, 1.0] or int16) into standard 16-bit PCM WAV bytes."""
    if audio_data.dtype == np.float32 or audio_data.dtype == np.float64:
        # Clip and convert to 16-bit signed PCM
        clipped = np.clip(audio_data, -1.0, 1.0)
        pcm_data = (clipped * 32767).astype(np.int16)
    elif audio_data.dtype == np.int16:
        pcm_data = audio_data
    else:
        pcm_data = audio_data.astype(np.int16)

    buffer = io.BytesIO()
    wavfile.write(buffer, sample_rate, pcm_data)
    return buffer.getvalue()

def audio_to_base64_data_uri(audio_data: np.ndarray, sample_rate: int = 24000) -> str:
    """Converts numpy audio array to data:audio/wav;base64,... URI."""
    wav_bytes = audio_to_wav_bytes(audio_data, sample_rate)
    encoded = base64.b64encode(wav_bytes).decode("ascii")
    return f"data:audio/wav;base64,{encoded}"

def calculate_duration(audio_data: np.ndarray, sample_rate: int = 24000) -> float:
    """Calculates duration in seconds."""
    samples = len(audio_data)
    return round(float(samples) / float(sample_rate), 3)

def generate_silence_or_test_tone(duration_seconds: float = 1.0, sample_rate: int = 24000) -> np.ndarray:
    """Generates a clean synthetic audio waveform for testing."""
    t = np.linspace(0, duration_seconds, int(sample_rate * duration_seconds), endpoint=False)
    # 440 Hz gentle sine wave
    return (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
