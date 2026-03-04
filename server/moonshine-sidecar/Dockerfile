FROM python:3.11-slim

WORKDIR /app

# Install system deps for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the default model during build so cold starts are fast.
# The model files are baked into the image (~60MB compressed).
RUN python -c "from moonshine_voice import Transcriber, ModelArch; \
    Transcriber(model_name='small-streaming-en', model_arch=ModelArch.SMALL_STREAMING)"

COPY main.py .

# Cloud Run injects PORT env var; default to 8090 for local dev
ENV PORT=8090

EXPOSE 8090

# Cloud Run requires listening on $PORT. Use --workers 1 to save memory
# since each worker loads the full model into RAM.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1
