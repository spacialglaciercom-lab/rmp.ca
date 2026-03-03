# Zones Partition API (Spectral Clustering)

FastAPI service that exposes `POST /api/zones/partition` to partition a graph into truck zones using spectral clustering (no GNN). Balance is by total edge length × complexity factor per zone.

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

Build and push a container that runs `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, then set `EXPO_PUBLIC_OPTIMIZER_URL` (or your app’s optimizer URL) to the Run service URL so the mobile app uses this API.
