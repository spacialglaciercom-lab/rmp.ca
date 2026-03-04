"""
Moonshine Voice sidecar — lightweight FastAPI service for server-side
speech-to-text transcription.  Called by the Node.js tRPC backend as a
drop-in replacement for the cloud Whisper API.

Uses moonshine-voice 0.0.x API: get_model_for_language(), Transcriber(stream).

Run:
    uvicorn main:app --host 0.0.0.0 --port 8090

Environment:
    MOONSHINE_LANGUAGE  — language code for model (default: en)
"""

from __future__ import annotations

import base64
import logging
import os
import subprocess
import tempfile
import time
from typing import Iterator, Optional, Tuple

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("moonshine-sidecar")

# ---------------------------------------------------------------------------
# Moonshine Voice SDK (0.0.x)
# ---------------------------------------------------------------------------

try:
    from moonshine_voice import (
        Transcriber,
        TranscriptEventListener,
        get_model_for_language,
        load_wav_file,
    )
except ImportError:
    logger.error(
        "moonshine-voice package not installed. Run: pip install moonshine-voice"
    )
    raise

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

LANGUAGE = os.environ.get("MOONSHINE_LANGUAGE", "en")
transcriber: Optional[Transcriber] = None


def load_model():
    """Load the Moonshine model on startup (0.0.x: get_model_for_language)."""
    global transcriber
    logger.info("Loading Moonshine model for language: %s ...", LANGUAGE)
    start = time.monotonic()
    model_path, model_arch = get_model_for_language(LANGUAGE)
    transcriber = Transcriber(model_path=model_path, model_arch=model_arch)
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


def _ensure_wav(file_path: str, ext: str) -> str:
    """Convert to WAV with ffmpeg if not already WAV (load_wav_file expects WAV)."""
    if ext == "wav":
        return file_path
    wav_path = file_path + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-acodec", "pcm_s16le", "-ar", "16000", wav_path],
            check=True,
            capture_output=True,
        )
        return wav_path
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Could not convert audio to WAV (ffmpeg): {e}",
        )


def _audio_chunk_generator(
    wav_file_path: str, chunk_duration: float = 0.1
) -> Iterator[Tuple[list, int]]:
    """Yield (audio_chunk, sample_rate) from a WAV file for streaming into Transcriber."""
    audio_data, sample_rate = load_wav_file(wav_file_path)
    chunk_size = int(chunk_duration * sample_rate)
    for i in range(0, len(audio_data), chunk_size):
        chunk = audio_data[i : i + chunk_size]
        yield (chunk, sample_rate)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(req: TranscribeRequest):
    """Transcribe base64-encoded audio using 0.0.x stream API."""
    if transcriber is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {exc}")

    ext = _mime_to_ext(req.mime_type)
    tmp_path = None
    wav_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        wav_path = _ensure_wav(tmp_path, ext)
        if wav_path != tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            tmp_path = None

        start = time.monotonic()
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

        stream = transcriber.create_stream(update_interval=0.5)
        stream.add_listener(Collector())
        stream.start()
        try:
            for chunk, sample_rate in _audio_chunk_generator(wav_path):
                stream.add_audio(chunk, sample_rate)
        finally:
            stream.stop()
            stream.close()

        elapsed = time.monotonic() - start
        full_text = " ".join(line["text"] for line in lines).strip()
        duration = sum(line["duration"] for line in lines) or 0.0
        logger.info(
            "Transcribed in %.2fs (text length %d)",
            elapsed,
            len(full_text),
        )

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
        if not segments and full_text:
            segments.append(Segment(id=0, start=0.0, end=duration, text=full_text))

        return TranscribeResponse(
            task="transcribe",
            language=req.language or "en",
            duration=duration,
            text=full_text,
            segments=segments,
        )
    finally:
        for p in (tmp_path, wav_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass


@app.get("/health")
async def health():
    """Health check for load balancers / readiness probes."""
    return {
        "status": "ok",
        "language": LANGUAGE,
        "model_loaded": transcriber is not None,
    }
