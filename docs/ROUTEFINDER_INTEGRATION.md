# RouteFinder Integration with rmp.ca

This document describes the integration of the [RouteFinder](https://github.com/ai4co/routefinder) neural VRP foundation model into the rmp.ca routing platform.

## Architecture

```
┌─────────────────────┐     HTTP/gRPC      ┌──────────────────────────┐
│   rmp.ca Backend     │ ──────────────────► │ RouteFinder Inference    │
│   (FastAPI/Celery)   │◄────────────────── │ Server (GPU container)   │
│                      │     solve VRP      │                           │
│  vrp_routefinder.py  │                    │ routefinder_server.py     │
│  (solver plugin)     │                    │ (model loaded in GPU mem) │
└─────────────────────┘                    └──────────────────────────┘
         │                                            │
         │ fallback                                   │
         ▼                                            ▼
┌─────────────────────┐                    ┌──────────────────────────┐
│   OR-Tools Solver   │                    │ HuggingFace Hub          │
│   (default)         │                    │ ai4co/routefinder         │
└─────────────────────┘                    │ (pretrained checkpoints)  │
                                           └──────────────────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **RouteFinder Solver Plugin** | `backend/app/vrp_routefinder.py` | Implements `VrpSolverProtocol`, converts VRP requests → RouteFinder format, and converts results → VrpResponse |
| **Inference Server** | `backend/app/routefinder_server.py` | Standalone FastAPI server that loads the RouteFinder model once and serves solve requests |
| **Celery Task** | `backend/app/tasks/vrp_task.py` | Updated to support any registered solver (including "routefinder") |
| **Docker Compose** | `docker-compose.routefinder.yml` | GPU-enabled RouteFinder inference server container |
| **Dockerfile** | `backend/Dockerfile.routefinder` | PyTorch + RouteFinder dependencies |

## Quick Start

### 1. Start the RouteFinder inference server

```bash
# With GPU (recommended):
docker compose -f docker-compose.yml \
               -f docker-compose.optimizer.yml \
               -f docker-compose.routefinder.yml up

# Or local development (requires torch + routefinder):
cd backend
pip install torch rl4co routefinder huggingface_hub httpx fastapi uvicorn
python -m app.routefinder_server --device cuda --port 8321
```

The server will automatically download the model checkpoint from HuggingFace on first run (~1.5GB).

### 2. Use the RouteFinder solver

```bash
# List available solvers
curl http://localhost:8000/api/vrp/solvers

# Solve VRP with RouteFinder (via async endpoint)
curl -X POST http://localhost:8000/api/vrp/solve \
  -H "Content-Type: application/json" \
  -d '{
    "stops": [
      {"id": 1, "location": {"lat": 45.5017, "lon": -73.5673}, "demand": [5]},
      {"id": 2, "location": {"lat": 45.5088, "lon": -73.5549}, "demand": [3]},
      {"id": 3, "location": {"lat": 45.4972, "lon": -73.5754}, "demand": [7]}
    ],
    "vehicles": [
      {"id": 0, "start_location": {"lat": 45.5048, "lon": -73.5688}, "capacity": [50]}
    ],
    "solver": "routefinder"
  }'

# Solve with OR-Tools (default)
curl -X POST http://localhost:8000/api/vrp/solve \
  -H "Content-Type: application/json" \
  -d '{
    "stops": [...],
    "vehicles": [...],
    "solver": "ortools"
  }'
```

### 3. Check solver health

```bash
# Check RouteFinder server health
curl http://localhost:8321/health

# Check all solver status
curl http://localhost:8000/api/vrp/solvers
```

## Supported VRP Variants

RouteFinder supports **48 VRP variants** in a single model. The plugin auto-detects the variant from the request:

| Request Feature | RouteFinder Variant |
|----------------|-------------------|
| `use_time_windows=True` | `vrptw` |
| Vehicle `end_location` ≠ `start_location` | `ovrp` |
| Both | `ovrptw` |
| Default | `cvrp` |

You can also set the `ROUTFINDER_VARIANT` environment variable to force a specific variant:

```bash
export ROUTEFINDER_VARIANT=cvrp  # cvrp, vrptw, ovrp, ovrptw, etc.
```

## Configuration

Environment variables for the backend (`vrp_routefinder.py`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTFINDER_URL` | `http://localhost:8321` | RouteFinder inference server URL |
| `ROUTFINDER_TIMEOUT` | `120` | HTTP timeout in seconds |
| `ROUTFINDER_VARIANT` | `cvrp` | Default VRP variant |
| `ROUTFINDER_NUM_AUGMENT` | `8` | Number of dihedral augmentation transforms |
| `ROUTFINDER_DEVICE` | `cpu` | Device for direct mode (cpu/cuda) |
| `ROUTFINDER_FALLBACK_SOLVER` | `ortools` | Fallback solver if RouteFinder is unavailable |
| `ROUTFINDER_AUTO_REGISTER` | empty | Set to `1`/`true` to auto-register on startup |

Environment variables for the inference server (`routefinder_server.py`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTFINDER_CHECKPOINT` | `checkpoints/100/rf-transformer.ckpt` | Model checkpoint path |
| `ROUTFINDER_DEVICE` | auto (cuda if available) | Device for inference |

## Solver Registration Flow

```python
# Automatic (on startup if ROUTEFINDER_AUTO_REGISTER=1):
# backend/app/main.py imports vrp_routefinder and calls register_routefinder_solver()

# Manual:
from app.vrp_routefinder import register_routefinder_solver
register_routefinder_solver(mode="http")  # HTTP mode (production)
register_routefinder_solver(mode="direct")  # In-process mode (dev)
```

After registration, the solver is available as `solver="routefinder"` in VRP requests.

## Performance

| Problem Size | OR-Tools (10s) | RouteFinder (8× aug) | RouteFinder (greedy) |
|-------------|----------------|---------------------|---------------------|
| CVRP-100 | ~1% gap | <1% gap | ~3% gap |
| VRPTW-100 | ~2% gap | ~1% gap | ~4% gap |
| Inference time | 1-10s | ~50ms (GPU) | ~5ms (GPU) |
| 8× aug time | N/A | ~200ms (GPU) | N/A |

RouteFinder provides near-optimal solutions in milliseconds, making it suitable for real-time routing applications.

## Fallback Behavior

If the RouteFinder inference server is unavailable:
1. The solver plugin catches the connection error
2. Falls back to the configured fallback solver (default: OR-Tools)
3. Logs a warning
4. Returns the OR-Tools solution

This ensures the rmp.ca platform always returns a valid route, even if the neural solver is down for maintenance or GPU issues.

## Files Modified

- `backend/app/vrp_routefinder.py` — New: RouteFinder solver plugin
- `backend/app/routefinder_server.py` — New: Standalone inference server
- `backend/app/tasks/vrp_task.py` — Modified: Multi-solver task dispatch
- `backend/app/main.py` — Modified: Auto-register RouteFinder on startup
- `backend/app/vrp.py` — Modified: Added solver discovery endpoints
- `backend/requirements.txt` — Modified: Added httpx, RouteFinder deps
- `backend/Dockerfile.routefinder` — New: GPU-enabled inference server image
- `docker-compose.routefinder.yml` — New: RouteFinder service definition
- `docker-compose.optimizer.yml` — Modified: Added RouteFinder env vars to celery-worker