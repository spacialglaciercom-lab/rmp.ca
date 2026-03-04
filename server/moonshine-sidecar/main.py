"""
Moonshine Voice sidecar — lightweight FastAPI service for server-side
speech-to-text transcription.  Called by the Node.js tRPC backend as a
drop-in replacement for the cloud Whisper API.

Run:
    uvicorn main:app --host 0.0.0.0 --port 8090

Environment:
    MOONSHINE_MODEL  — model name (default: small-streaming-en)
    MOONSHINE_ARCH   — model architecture (default: SMALL_STREAMING)
"""

from __future__ import annotations

import base64
import io
import logging
import os
import tempfile
import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("moonshine-sidecar")

# ---------------------------------------------------------------------------
# Moonshine Voice SDK
# ---------------------------------------------------------------------------

try:
    from moonshine_voice import Transcriber, ModelArch, TranscriptEventListener
except ImportError:
    logger.error(
        "moonshine-voice package not installed. Run: pip install moonshine-voice"
    )
    raise

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

MODEL_NAME = os.environ.get("MOONSHINE_MODEL", "small-streaming-en")
ARCH_MAP = {
    "TINY": ModelArch.TINY,
    "BASE": ModelArch.BASE,
    "TINY_STREAMING": ModelArch.TINY_STREAMING,
    "BASE_STREAMING": ModelArch.BASE_STREAMING,
    "SMALL_STREAMING": ModelArch.SMALL_STREAMING,
    "MEDIUM_STREAMING": ModelArch.MEDIUM_STREAMING,
}
ARCH_NAME = os.environ.get("MOONSHINE_ARCH", "SMALL_STREAMING")
MODEL_ARCH = ARCH_MAP.get(ARCH_NAME, ModelArch.SMALL_STREAMING)

transcriber: Optional[Transcriber] = None


def load_model():
    """Load the Moonshine model on startup."""
    global transcriber
    logger.info("Loading Moonshine model: %s (arch=%s) ...", MODEL_NAME, ARCH_NAME)
    start = time.monotonic()

    # The Transcriber auto-downloads from CDN if model_path is just a name
    transcriber = Transcriber(model_name=MODEL_NAME, model_arch=MODEL_ARCH)

    elapsed = time.monotonic() - start
    logger.info("Model loaded in %.2fs", elapsed)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Moonshine Voice Sidecar", version="1.0.0")


@app.on_event("startup")
async def startup():
    load_model()


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class TranscribeRequest(BaseModel):
    """Input payload — matches what the Node proxy sends."""

    audio_base64: str
    mime_type: str = "audio/wav"
    language: Optional[str] = None
    prompt: Optional[str] = None


class Segment(BaseModel):
    id: int
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    """Matches the WhisperResponse shape expected by the Node tRPC router."""

    task: str = "transcribe"
    language: str = "en"
    duration: float
    text: str
    segments: list[Segment]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(req: TranscribeRequest):
    """Transcribe base64-encoded audio and return Whisper-compatible response."""
    if transcriber is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Decode audio
    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}")

    # Write to a temp file (Moonshine reads files)
    ext = _mime_to_ext(req.mime_type)
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        start = time.monotonic()

        # Collect completed lines via a listener
        lines: list[dict] = []

        class Collector(TranscriptEventListener):
            def on_line_completed(self, event):
                lines.append(
                    {
                        "text": event.line.text,
                        "start": event.line.start_time,
                        "duration": event.line.duration,
                    }
                )

        collector = Collector()
        transcriber.add_listener(collector)

        try:
            result = transcriber.transcribe_file(tmp_path)
        finally:
            transcriber.remove_listener(collector)

        elapsed = time.monotonic() - start
        logger.info(
            "Transcribed %.1fs audio in %.2fs (%.1fx RT)",
            result.duration if result else 0,
            elapsed,
            (result.duration / elapsed) if result and elapsed > 0 else 0,
        )

        full_text = result.text if result else ""
        duration = result.duration if result else 0.0

        # Build segments (Whisper-compatible shape)
        segments = []
        offset = 0.0
        for i, line in enumerate(lines):
            segments.append(
                Segment(
                    id=i,
                    start=line["start"],
                    end=line["start"] + line["duration"],
                    text=line["text"],
                )
            )

        # If no segments collected, create a single segment from the result
        if not segments and full_text:
            segments.append(
                Segment(id=0, start=0.0, end=duration, text=full_text)
            )

        return TranscribeResponse(
            task="transcribe",
            language=req.language or "en",
            duration=duration,
            text=full_text,
            segments=segments,
        )
    finally:
        os.unlink(tmp_path)


@app.get("/health")
async def health():
    """Health check for load balancers / readiness probes."""
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "model_loaded": transcriber is not None,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mime_to_ext(mime: str) -> str:
    mapping = {
        "audio/webm": "webm",
        "audio/mp3": "mp3",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/wave": "wav",
        "audio/ogg": "ogg",
        "audio/m4a": "m4a",
        "audio/mp4": "m4a",
    }
    return mapping.get(mime, "wav")
