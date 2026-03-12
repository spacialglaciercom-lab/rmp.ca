# Docker local dev stack

The full stack (backend, optimizer, **Overture extract**) runs via **Docker Compose** from **this repo**. The extract service is included in the rmp.ca repo under `extract/`.

## Layout

- **This repo** (`rmp.ca/`): contains `docker-compose.yml`, `Dockerfile`, `backend/Dockerfile`, and **`extract/`** (Overture extract WebSocket + HTTP API). Run `docker compose` from this directory.

## Run the stack

1. Start **Docker Desktop**.
2. From this repo root:
   ```powershell
   cd c:\Users\Space\OneDrive\Desktop\rmp.ca\rmp.ca
   docker compose up --build
   ```
3. Services: **backend** (3000), **optimizer** (8000), **extract** (4000).

To rebuild only one: `docker compose up --build backend` or `--build extract`.  
To stop and remove volumes: `docker compose down -v`

## Env for the app

In **this** repo’s `.env`, point at the local stack:

- `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`
- `EXPO_PUBLIC_OPTIMIZER_URL=http://localhost:8000`
- `EXPO_PUBLIC_OVERTURE_EXTRACT_URL=http://localhost:4000`

The backend's `EXTRACT_WS_UPSTREAM` is set by compose to `http://extract:4000`. See `extract/README.md` for the extract API and how to run it standalone.
