# Docker local dev stack

The full stack (MySQL, backend, optimizer, Overture extract) is run via **Docker Compose** from the **parent folder** of this repo, not from this directory.

## Layout

- **Parent folder** (e.g. `C:\Users\Space\OneDrive\Desktop\rmp.ca`): contains `docker-compose.yml`. Run all `docker compose` commands there.
- **This repo** (`rmp.ca/`): contains `Dockerfile`, `backend/Dockerfile`, `.dockerignore` — used as build context by the compose file.

So the compose file lives one level up so it can reference this app plus sibling projects (e.g. Overture extract) in a single stack.

## Run the stack

1. Start **Docker Desktop**.
2. In a terminal, go to the **parent** of this repo (the folder that contains both `docker-compose.yml` and the `rmp.ca` folder):
   ```powershell
   cd C:\Users\Space\OneDrive\Desktop\rmp.ca
   ```
3. Start everything:
   ```powershell
   docker compose up --build
   ```

To rebuild only the backend: `docker compose up --build backend`  
To stop and remove volumes: `docker compose down -v`

## Env for the app

In **this** repo’s `.env`, point at the local stack:

- `EXPO_PUBLIC_API_BASE_URL=http://localhost:3000`
- `EXPO_PUBLIC_OPTIMIZER_URL=http://localhost:8000`
- `EXPO_PUBLIC_OVERTURE_EXTRACT_URL=http://localhost:4000`

See `docker-compose.yml` in the parent folder for the full service list and ports.
