# Deploy backend on Google Cloud Run so Vercel can talk to it

This guide deploys:

1. **Python optimizer** (FastAPI) → Cloud Run service `rmp-optimizer`
2. **Node API** (Express, proxies to optimizer) → Cloud Run service `trashroute-mobile` (or your chosen name)

Then you set **Vercel** `EXPO_PUBLIC_API_BASE_URL` to the Node API’s Cloud Run URL so the frontend at `https://rmp-ca.vercel.app` calls Google instead of Railway.

---

## Do I need to deploy other instances (optimizer & extract)?

**Yes, if you want those features to work.**

The **Node API** (rmp-ca) does not run the optimizer or extract logic itself. It **proxies** requests to other services:

| Feature                                                      | What the Node API does                                                               | Do you need another service?                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Optimizer** (route optimization, zones, GeoJSON)           | Proxies `/api/optimize`, `/api/geojson/*`, `/api/zones/*` to `OPTIMIZER_BACKEND_URL` | **Yes.** Deploy the **Python FastAPI** app (`backend/`) as a separate Cloud Run service, then set `OPTIMIZER_BACKEND_URL` on the Node service to that URL. Without it, those endpoints return **503** “Optimizer backend not configured”.                      |
| **Extract** (Overture polygon → roads/GeoJSON via WebSocket) | Proxies `wss://.../ws/extract` to `EXTRACT_WS_UPSTREAM`                              | **Yes**, if you use the Extract tab. Deploy an **Overture extract** service (separate repo/service), then set `EXTRACT_WS_UPSTREAM` on the Node service. If unset, the Node server still tries the old Railway default (likely dead), so extraction will fail. |

**Summary:**

- **Only Node (rmp-ca) deployed:** Health, `/api/config`, tRPC, etc. work. Optimizer endpoints → 503. Extract tab → connection errors.
- **Node + Python optimizer:** Set `OPTIMIZER_BACKEND_URL` on the Node service. Route optimization and zones work.
- **Node + optimizer + extract:** Also set `EXTRACT_WS_UPSTREAM` on the Node service. Extract tab works.

---

## Single container vs multiple services

**Single container (all-in-one)** can be simpler: one image, one Cloud Run service, one URL, no `OPTIMIZER_BACKEND_URL` to set. Node and Python run in the same container; the Node server proxies optimizer requests to `http://127.0.0.1:8000` inside the container.

|                | Single container                                                                                  | Multiple services                                                     |
| -------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Deploy**     | One image, one `gcloud run deploy`                                                                | Build and deploy Node + optimizer (and optionally extract) separately |
| **Config**     | No `OPTIMIZER_BACKEND_URL`                                                                        | Set `OPTIMIZER_BACKEND_URL` on the Node service to the optimizer URL  |
| **Scaling**    | Node and optimizer scale together                                                                 | Scale optimizer and Node independently                                |
| **Image size** | Larger (Node + Python)                                                                            | Smaller per image                                                     |
| **Extract**    | Optional: use in-repo extract (`extract/`) or a deployed extract service; set `EXTRACT_WS_UPSTREAM` on Node | Same                                                                  |

**When to use a single container:** You want route optimization (and zones/GeoJSON) with minimal setup and one URL. Use `Dockerfile.all-in-one` and deploy one Cloud Run service.

**When to use multiple services:** You want to scale or update the optimizer independently, or you prefer smaller images and clearer separation.

---

### Deploy with the all-in-one container

From the **repo root**:

```bash
# Build the combined image (Node + Python optimizer)
docker build -f Dockerfile.all-in-one -t gcr.io/YOUR_PROJECT_ID/rmp-ca:latest .

# Push
docker push gcr.io/YOUR_PROJECT_ID/rmp-ca:latest

# Deploy (one service; no OPTIMIZER_BACKEND_URL needed)
gcloud run deploy rmp-ca \
  --image gcr.io/YOUR_PROJECT_ID/rmp-ca:latest \
  --region europe-west1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

Then set **Vercel** `EXPO_PUBLIC_API_BASE_URL` to the service URL (e.g. `https://rmp-ca-286569721223.europe-west1.run.app`). Optimizer endpoints work because the Node process proxies to the Python process inside the same container.

**Extract tab:** The all-in-one image does **not** include the Overture extract service. To use the Extract tab you still need to run that service somewhere and set `EXTRACT_WS_UPSTREAM` when deploying the Node/optimizer service (or in the all-in-one container env if you add it to the image later).

---

## Prerequisites

- [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) installed and logged in
- A GCP project with **Cloud Run** and **Container Registry** (or Artifact Registry) enabled

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com containerregistry.googleapis.com
```

---

## 1. Deploy the Python optimizer to Cloud Run

From the **repo root**:

```bash
# Build the optimizer image (backend/Dockerfile uses PORT=8080; Cloud Run sets PORT automatically)
docker build -t gcr.io/YOUR_PROJECT_ID/rmp-optimizer:latest ./backend

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT_ID/rmp-optimizer:latest

# Deploy to Cloud Run (allow unauthenticated so the Node API can call it)
gcloud run deploy rmp-optimizer \
  --image gcr.io/YOUR_PROJECT_ID/rmp-optimizer:latest \
  --region northamerica-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

Note the **Service URL** from the deploy output, e.g.:

`https://rmp-optimizer-XXXXXXXX-XX.a.run.app`

Set it as an env var for the next step:

```bash
OPTIMIZER_URL="https://rmp-optimizer-XXXXXXXX-XX.a.run.app"
```

---

## 2. Deploy the Node API to Cloud Run

The Node server (root `Dockerfile`) serves `/api/config`, `/api/optimize` (proxied to the Python backend), `/ws/extract`, etc. Cloud Run sets `PORT` (e.g. 8080); the server already reads `process.env.PORT`.

```bash
# Build the Node API image
docker build -t gcr.io/YOUR_PROJECT_ID/trashroute-api:latest .

# Push
docker push gcr.io/YOUR_PROJECT_ID/trashroute-api:latest

# Deploy with the optimizer URL so /api/optimize is proxied to Cloud Run
gcloud run deploy trashroute-mobile \
  --image gcr.io/YOUR_PROJECT_ID/trashroute-api:latest \
  --region northamerica-northeast1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "OPTIMIZER_BACKEND_URL=${OPTIMIZER_URL}"
```

If you also deploy an Overture extract service later, add:

```bash
  --set-env-vars "OPTIMIZER_BACKEND_URL=${OPTIMIZER_URL},EXTRACT_WS_UPSTREAM=https://your-extract-service.run.app"
```

Note the **Service URL** of the Node API, e.g.:

`https://trashroute-mobile-XXXXXXXX-XX.a.run.app`

---

## 3. Point Vercel at the Node API

1. Open [Vercel Dashboard](https://vercel.com/dashboard) → your project (**rmp-ca** or the one that hosts `rmp-ca.vercel.app`).
2. **Settings** → **Environment Variables**.
3. Add:
   - **Name:** `EXPO_PUBLIC_API_BASE_URL`
   - **Value:** `https://trashroute-mobile-XXXXXXXX-XX.a.run.app` (your Node Cloud Run URL, no trailing slash)
   - **Environment:** Production (and Preview if you want).
4. **Redeploy** the frontend (Deployments → … → Redeploy) so the new env is baked in.

The web app will then call your Cloud Run Node API; the Node API will proxy optimizer requests to the Python Cloud Run service.

---

## 4. CORS

The Node server sends `Access-Control-Allow-Origin: <request origin>` when the browser sends an `Origin` header, so `https://rmp-ca.vercel.app` is allowed automatically. No extra CORS config is required on Cloud Run for the Node service.

---

## 5. Optional: Cloud Build (CI/CD)

To deploy the **Node API** on every push to `main` using the existing `cloudbuild.yaml`, add env vars to the deploy step so the deployed service gets `OPTIMIZER_BACKEND_URL`.

**Option A – Substitution (recommended)**  
In **Cloud Console** → **Cloud Build** → **Triggers** → your trigger → **Substitution variables**, add:

- `_OPTIMIZER_BACKEND_URL` = `https://rmp-optimizer-XXXXXXXX-XX.a.run.app`

Then in `cloudbuild.yaml` the deploy step can pass:

```yaml
- "--set-env-vars"
- "OPTIMIZER_BACKEND_URL=${_OPTIMIZER_BACKEND_URL}"
```

**Option B – Secret**  
Store the optimizer URL in Secret Manager and use `--set-secrets` in the deploy step (see [Cloud Run env from secrets](https://cloud.google.com/run/docs/configuring/services/secrets)).

Example `cloudbuild.yaml` snippet for the deploy step:

```yaml
- name: "gcr.io/google.com/cloudsdktool/cloud-sdk"
  entrypoint: gcloud
  args:
    - "run"
    - "deploy"
    - "trashroute-mobile"
    - "--image"
    - "gcr.io/${PROJECT_ID}/trashroute-api:${SHORT_SHA}"
    - "--region"
    - "${_REGION}"
    - "--platform"
    - "managed"
    - "--allow-unauthenticated"
    - "--port"
    - "8080"
    - "--set-env-vars"
    - "OPTIMIZER_BACKEND_URL=${_OPTIMIZER_BACKEND_URL}"
```

---

## 6. 403 Forbidden when calling the Cloud Run URL

If the frontend or `curl` gets **403 Forbidden** when calling your Cloud Run service, the service is likely requiring authentication. Allow unauthenticated invocations so the browser (and Vercel) can call it:

```bash
gcloud run services add-iam-policy-binding rmp-ca \
  --region=europe-west1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Use your **service name** and **region** (e.g. `trashroute-mobile` and `northamerica-northeast1` if different). After this, unauthenticated requests to the service URL will succeed.

---

## 7. Optional: Deploy Python optimizer via Cloud Build

Create `backend/cloudbuild.yaml` (or add a second trigger in the repo) to build and deploy the optimizer:

```yaml
steps:
  - name: "gcr.io/cloud-builders/docker"
    args:
      - "build"
      - "-t"
      - "gcr.io/${PROJECT_ID}/rmp-optimizer:${SHORT_SHA}"
      - "-t"
      - "gcr.io/${PROJECT_ID}/rmp-optimizer:latest"
      - "-f"
      - "backend/Dockerfile"
      - "backend"
  - name: "gcr.io/cloud-builders/docker"
    args: ["push", "gcr.io/${PROJECT_ID}/rmp-optimizer:${SHORT_SHA}"]
  - name: "gcr.io/cloud-builders/docker"
    args: ["push", "gcr.io/${PROJECT_ID}/rmp-optimizer:latest"]
  - name: "gcr.io/google.com/cloudsdktool/cloud-sdk"
    entrypoint: gcloud
    args:
      - "run"
      - "deploy"
      - "rmp-optimizer"
      - "--image"
      - "gcr.io/${PROJECT_ID}/rmp-optimizer:${SHORT_SHA}"
      - "--region"
      - "northamerica-northeast1"
      - "--platform"
      - "managed"
      - "--allow-unauthenticated"
      - "--port"
      - "8080"
images:
  - "gcr.io/${PROJECT_ID}/rmp-optimizer:${SHORT_SHA}"
  - "gcr.io/${PROJECT_ID}/rmp-optimizer:latest"
```

Trigger this from `backend/` or set the trigger config so the build context is `backend` and Dockerfile path is `backend/Dockerfile`.

---

## Summary

| Step | What                                                                    | URL / Env                                             |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | Deploy Python optimizer (Cloud Run)                                     | `OPTIMIZER_URL` = `https://rmp-optimizer-xxx.run.app` |
| 2    | Deploy Node API (Cloud Run) with `OPTIMIZER_BACKEND_URL=$OPTIMIZER_URL` | Node URL = `https://trashroute-mobile-xxx.run.app`    |
| 3    | Vercel env `EXPO_PUBLIC_API_BASE_URL` = Node URL, then redeploy         | Vercel frontend calls Cloud Run                       |

After that, **Vercel talks to Google Cloud Run** and the old Railway backend is no longer used.

---

## Your Cloud Run URLs

**Node API (rmp-ca, europe-west1):**

- **Service URL:** `https://rmp-ca-286569721223.europe-west1.run.app`
- **Vercel:** Set `EXPO_PUBLIC_API_BASE_URL` = `https://rmp-ca-286569721223.europe-west1.run.app` (no trailing slash), then redeploy.
- If you get **403**, run the `gcloud run services add-iam-policy-binding` command in section 6 with service name `rmp-ca` and region `europe-west1`.

**Optimizer (northamerica-northeast1):**

- **Service URL:** `https://optimizer-286569721223.northamerica-northeast1.run.app`
- **Use it:** Set `OPTIMIZER_BACKEND_URL` on the **Node API (rmp-ca)** so `/api/optimize` is proxied to this service.

**Overture extract (northamerica-northeast1):**

- **Service URL:** `https://webovertureextract2-286569721223.northamerica-northeast1.run.app`
- **Use it:** Set `EXTRACT_WS_UPSTREAM` on the **Node API (rmp-ca)** so `/ws/extract` is proxied to this service (Extract tab in the app).

To point rmp-ca at both optimizer and extract (one-time or after deploy):

```bash
gcloud run services update rmp-ca \
  --region=europe-west1 \
  --set-env-vars "OPTIMIZER_BACKEND_URL=https://optimizer-286569721223.northamerica-northeast1.run.app,EXTRACT_WS_UPSTREAM=https://webovertureextract2-286569721223.northamerica-northeast1.run.app"
```

If the optimizer or extract service still shows the “placeholder” page, the first successful build/deploy has not completed yet; check Cloud Run → that service → Build history / Logs. Once each is deployed, the URLs above will serve the real apps.
