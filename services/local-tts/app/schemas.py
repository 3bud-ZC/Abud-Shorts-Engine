"""Pydantic schemas for Local Egyptian TTS Service."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class HardwareInfo(BaseModel):
    cpu_count: int = Field(..., description="Number of logical CPU cores")
    ram_total_mb: int = Field(..., description="Total system RAM in MiB")
    ram_free_mb: int = Field(..., description="Free physical RAM in MiB")
    cuda_available: bool = Field(..., description="Whether CUDA GPU acceleration is available")
    gpu_name: Optional[str] = Field(None, description="Name of the GPU if available")
    vram_total_mb: Optional[int] = Field(None, description="Total GPU VRAM in MiB")
    vram_free_mb: Optional[int] = Field(None, description="Free GPU VRAM in MiB")
    device: str = Field(..., description="Active compute device ('cuda' or 'cpu')")

class HealthResponse(BaseModel):
    ok: bool
    status: str
    version: str = "2.4.0"
    hardware: HardwareInfo
    models_ready: List[str]

class CapabilitiesResponse(BaseModel):
    service: str = "abud-shorts-local-tts"
    version: str = "2.4.0"
    hardware: HardwareInfo
    supported_models: List[str]
    default_sample_rate: int = 24000
    audio_format: str = "wav"
    concurrency_limit: int = 1

class ModelItem(BaseModel):
    id: str
    name: str
    repo_id: str
    revision: str
    state: str
    downloaded_bytes: int
    license: str
    speakers_count: int
    dialect: str
    sample_rate: int

class ModelsResponse(BaseModel):
    models: List[ModelItem]

class VoiceItem(BaseModel):
    id: str
    name: str
    gender: str
    provider: str
    language: str = "ar"
    dialect: str = "egyptian"
    preview_url: Optional[str] = None
    is_default: bool = False

class VoicesResponse(BaseModel):
    model: str
    voices: List[VoiceItem]

class SynthesizeRequest(BaseModel):
    model: str = Field("voicetut", description="Model ID: 'voicetut' or 'kemetone'")
    text: str = Field(..., min_length=1, description="Text to synthesize in Arabic/Egyptian")
    speakerId: Optional[str] = Field(None, description="Speaker ID / name")
    language: str = Field("ar", description="Language code")
    dialect: str = Field("egyptian", description="Dialect")
    speed: float = Field(1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    qualityPreset: Optional[str] = Field("standard", description="Quality preset")

class SynthesizeResponse(BaseModel):
    audioBase64: str = Field(..., description="Base64 data URI of the generated WAV audio")
    sampleRate: int
    durationSeconds: float
    generationMs: int
    speakerId: str
    model: str
    cached: bool = False
