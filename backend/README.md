# Zones Partition API (Spectral Clustering)

FastAPI service that exposes:

- **`POST /api/zones/partition`** — partition a graph (edges + node_count) into truck zones.
- **`POST /api/zones/partition-from-geojson`** — build graph from road GeoJSON (FeatureCollection of LineStrings), then partition. Used by the Extract tab after "Extract & Process".

Balance is by total edge length × complexity factor per zone. **If the app shows "Zone partitioning failed" with 404, redeploy this backend** so the optimizer has the `partition-from-geojson` endpoint.

## Run locally

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

- Health: `GET http://localhost:8000/health`
- Partition: `POST http://localhost:8000/api/zones/partition` with JSON body:

```json
{
  "edges": [
    { "u": 0, "v": 1, "length": 1.0 },
    { "u": 1, "v": 2, "length": 1.0 }
  ],
  "node_count": 3,
  "truck_count": 2,
  "balance_metric": "time"
}
```

## Deploy to Google Run

If you see **404** on `/health` and the Cloud Run log shows a container like **"placeholder-1"**, the service is running a placeholder image, not this FastAPI app. Deploy this backend so `/health` and `/api/zones/partition` work.

1. **Build and push** (replace `PROJECT_ID` and `REGION` with your Google Cloud project and region, e.g. `northamerica-northeast1`):

   ```bash
   cd backend
   docker build -t gcr.io/PROJECT_ID/trashroute-backend .
   docker push gcr.io/PROJECT_ID/trashroute-backend
   ```

   Or with Google Cloud Build:

   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/trashroute-backend ./backend
   ```

2. **Deploy to Cloud Run** (same service URL so the app keeps using it):

   ```bash
   gcloud run deploy trashroute-mobile --image gcr.io/PROJECT_ID/trashroute-backend --region REGION --platform managed --allow-unauthenticated --set-env-vars PORT=8080
   ```

3. Set `EXPO_PUBLIC_OPTIMIZER_URL` (or your app's optimizer URL) to the Run service URL so the mobile app uses this API.

**Note:** This API does **not** expose `/ws/extract` (Overture extract WebSocket). The app uses that for map extraction; if you need it on the same host, you'll need to add a WebSocket endpoint here or run a separate extract service and point the app to it via `EXPO_PUBLIC_OVERTURE_WS_BASE`.
