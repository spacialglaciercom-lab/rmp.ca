# Moonshine Voice Sidecar

Lightweight FastAPI service for **server-side speech-to-text**. The Node.js backend calls this sidecar for AI chat voice input (and other STT) when `MOONSHINE_STT_ENABLED=true` and `MOONSHINE_SIDECAR_URL` are set.

- **Endpoint:** `POST /transcribe` — body: `{ "audio_base64": "...", "mime_type": "audio/m4a", "language": null }`
- **Health:** `GET /health`

---

## 1. Run locally (no Docker)

**Requirements:** Python 3.11+, ffmpeg (for some audio formats).

```bash
cd server/moonshine-sidecar
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8090
```

First run will download the Moonshine model (~60MB). Then:

- Sidecar: **http://localhost:8090**
- Health: http://localhost:8090/health

On your **Node backend**, set:

```env
MOONSHINE_SIDECAR_URL=http://localhost:8090
MOONSHINE_STT_ENABLED=true
```

---

## 2. Run with Docker (local)

```bash
cd server/moonshine-sidecar
docker build -t moonshine-sidecar .
docker run -p 8090:8090 moonshine-sidecar
```

Sidecar: **http://localhost:8090**. Use the same env vars on the Node server as above.

---

## 3. Deploy to Google Cloud Run

### Option A: Cloud Build (recommended)

From the **repository root** (so build context includes `server/moonshine-sidecar`):

```bash
gcloud builds submit --config server/moonshine-sidecar/cloudbuild.yaml server/moonshine-sidecar
```

Or from the sidecar directory:

```bash
cd server/moonshine-sidecar
gcloud builds submit --config cloudbuild.yaml .
```

Ensure:

- `gcloud` is logged in and the project is set: `gcloud config set project YOUR_PROJECT_ID`
- Cloud Build and Cloud Run APIs are enabled
- Container Registry (or Artifact Registry) is available for `gcr.io/$PROJECT_ID`

After deploy, Cloud Run will print the service URL, e.g.:

`https://moonshine-sidecar-xxxxx-northamerica-northeast1.run.app`

### Option B: Deploy from source (no Dockerfile build yourself)

```bash
cd server/moonshine-sidecar
gcloud run deploy moonshine-sidecar \
  --source . \
  --region northamerica-northeast1 \
  --memory 1Gi \
  --cpu 2 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 60 \
  --concurrency 10 \
  --allow-unauthenticated
```

Use the URL Cloud Run gives you as `MOONSHINE_SIDECAR_URL` (no trailing slash).

### Backend env (Railway / Node server)

Set on the **Node.js API server** (e.g. Railway):

```env
MOONSHINE_SIDECAR_URL=https://moonshine-sidecar-xxxxx-northamerica-northeast1.run.app
MOONSHINE_STT_ENABLED=true
```

The Node server will call `POST {MOONSHINE_SIDECAR_URL}/transcribe` for voice input.

---

## 4. Deploy as a separate Railway service (e.g. `moonshine_sidecar`)

You can run the sidecar as its own Railway service in the same project as your main backend.

1. **New service from repo**
   - In [Railway](https://railway.app): open your project → **New** → **GitHub Repo** (or **Empty Service** and connect repo later).
   - Choose the same repo as your main backend.

2. **Configure the new service**
   - **Settings** → **Build**:
     - **Root Directory:** set to `server/moonshine-sidecar` (so Railway uses this folder and its Dockerfile).
   - **Settings** → **Deploy**:
     - Railway will detect the **Dockerfile** and build it. No need to set a start command.
   - **Settings** → **Networking** → **Generate Domain** so the service gets a public URL like `https://moonshine-sidecar-production-xxxx.up.railway.app`.

3. **Environment (optional)**
   - In the sidecar service’s **Variables**, you can set:
     - `MOONSHINE_LANGUAGE=en` (optional; defaults to en)
   - Railway sets `PORT` automatically; the Dockerfile uses it, so no need to set it.

4. **Name the service**
   - **Settings** → **Service name:** e.g. `moonshine_sidecar`. The public URL will still be something like `https://moonshine-sidecar-production-xxxx.up.railway.app` (Railway may use the service name in the subdomain).

5. **Point the main backend at the sidecar**
   - On your **main backend** service in Railway, add variables:
     - `MOONSHINE_SIDECAR_URL` = the sidecar’s full URL (from **Generate Domain**), e.g. `https://moonshine-sidecar-production-xxxx.up.railway.app` (no trailing slash).
     - `MOONSHINE_STT_ENABLED=true`

After the sidecar finishes building and deploys, test:

```bash
curl -s https://YOUR_SIDECAR_URL/health
```

You should see `{"status":"ok","model":"small-streaming-en","model_loaded":true}`. Then the main backend can use it for voice transcription.

---

## Environment (sidecar)

| Variable            | Default                | Description                          |
|---------------------|------------------------|--------------------------------------|
| `PORT`              | `8090`                 | Port the app listens on (Cloud Run sets this). |
| `MOONSHINE_LANGUAGE`| `en`                   | Language code for model (e.g. en, es, zh). Model is downloaded via get_model_for_language(). |

---

## Backend (Node) summary

On the **API server** that runs the tRPC/voice routes:

1. **MOONSHINE_SIDECAR_URL** — Full base URL of the sidecar (e.g. `https://moonshine-sidecar-xxx.run.app` or `http://localhost:8090`). No trailing slash.
2. **MOONSHINE_STT_ENABLED** — Set to `true` to use the sidecar for STT; when `false` or unset, the server uses Whisper (or other fallback) only.

After deployment, test the sidecar:

```bash
curl -s https://YOUR_SIDECAR_URL/health
```

Then use the AI chat mic in the app; the backend will send audio to the sidecar and return transcribed text.
