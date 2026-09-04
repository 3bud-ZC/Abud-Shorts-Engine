"""FastAPI Application for Local Egyptian TTS Service."""
import time
from typing import Optional
from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from app.audio import audio_to_base64_data_uri, calculate_duration
from app.config import INTERNAL_SERVICE_TOKEN
from app.hardware import detect_hardware
from app.models.manager import ModelManager
from app.schemas import (
    CapabilitiesResponse,
    HealthResponse,
    ModelsResponse,
    SynthesizeRequest,
    SynthesizeResponse,
    VoicesResponse,
)

app = FastAPI(
    title="ABUD Shorts Engine - Local Egyptian TTS Service",
    version="2.4.0",
    description="Internal high-performance Egyptian Arabic TTS service supporting VoiceTut and KemeTone.",
)

async def verify_internal_token(x_internal_token: Optional[str] = Header(None)):
    """Enforces x-internal-token authentication if INTERNAL_SERVICE_TOKEN is configured."""
    expected = INTERNAL_SERVICE_TOKEN.strip()
    if not expected:
        return
    if not x_internal_token or x_internal_token.strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal service token (x-internal-token).",
        )

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check and hardware status. Publicly reachable within the Docker network."""
    hw = detect_hardware()
    manager = ModelManager.get_instance()
    models = manager.list_models()
    ready_models = [m.id for m in models if m.state == "ready"]

    return HealthResponse(
        ok=True,
        status="healthy",
        hardware=hw,
        models_ready=ready_models,
    )

@app.get("/capabilities", response_model=CapabilitiesResponse, dependencies=[Depends(verify_internal_token)])
async def capabilities():
    """Returns runtime capabilities, active compute device, and supported models."""
    hw = detect_hardware()
    return CapabilitiesResponse(
        hardware=hw,
        supported_models=["voicetut", "kemetone"],
    )

@app.get("/models", response_model=ModelsResponse, dependencies=[Depends(verify_internal_token)])
async def list_models():
    """Lists local models, download states, and disk cache sizes."""
    manager = ModelManager.get_instance()
    return ModelsResponse(models=manager.list_models())

@app.get("/voices", response_model=VoicesResponse, dependencies=[Depends(verify_internal_token)])
async def list_voices(model: str = Query("voicetut", description="Model ID ('voicetut' or 'kemetone')")):
    """Lists built-in speaker catalogue for a specific model."""
    manager = ModelManager.get_instance()
    try:
        voices = manager.get_voices(model)
        return VoicesResponse(model=model, voices=voices)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/synthesize", response_model=SynthesizeResponse, dependencies=[Depends(verify_internal_token)])
async def synthesize(request: SynthesizeRequest):
    """Synthesizes Egyptian Arabic speech using the requested local model under mutex concurrency=1."""
    manager = ModelManager.get_instance()
    try:
        provider = manager.get_provider(request.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not provider.is_ready():
        raise HTTPException(
            status_code=409,
            detail=f"Model '{request.model}' is not installed. Download inference files before synthesis.",
        )

    t0 = time.time()
    # Concurrency gate: exactly 1 synthesis at a time
    async with manager.lock:
        try:
            audio_array, sample_rate = provider.synthesize(
                text=request.text,
                speaker_id=request.speakerId or "Mohamed",
                speed=request.speed,
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Synthesis failed: {str(e)}",
            )

    gen_ms = int((time.time() - t0) * 1000)
    duration = calculate_duration(audio_array, sample_rate)
    data_uri = audio_to_base64_data_uri(audio_array, sample_rate)

    return SynthesizeResponse(
        audioBase64=data_uri,
        sampleRate=sample_rate,
        durationSeconds=duration,
        generationMs=gen_ms,
        speakerId=request.speakerId or "Mohamed",
        model=request.model,
    )
