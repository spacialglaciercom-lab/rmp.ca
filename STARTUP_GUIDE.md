# RMP.CA Startup Guide

## Quick Start with Docker

### Backend + Extractor (Basic Setup)
```bash
cd /home/drone/rmp.ca
docker compose up
```

### Full Stack (Backend + Extractor + Optimizer)
```bash
cd /home/drone/rmp.ca
docker compose -f docker-compose.yml -f docker-compose.optimizer.yml --profile optimizer up
```

## Individual Components

### Backend (Python)
```bash
cd /home/drone/rmp.ca/backend
docker build -t rmp-optimizer .
docker run -p 8000:8000 rmp-optimizer
```

### Extractor (Node.js)
```bash
cd /home/drone/rmp.ca/extract
docker build -t rmp-extract .
docker run -p 4000:4000 rmp-extract
```

### Optimizer (Python)
```bash
cd /home/drone/rmp.ca/backend
docker build -t rmp-optimizer .
docker run -p 8000:8000 rmp-optimizer
```

## Important Files

### Backend Files
- `/home/drone/rmp.ca/backend/app/main.py`
- `/home/drone/rmp.ca/backend/app/optimize.py`
- `/home/drone/rmp.ca/backend/app/vrp.py`
- `/home/drone/rmp.ca/backend/app/vrp_osrm.py`
- `/home/drone/rmp.ca/backend/app/tasks/optimize_task.py`
- `/home/drone/rmp.ca/backend/app/tasks/vrp_task.py`

### Optimizer Files
- `/home/drone/rmp.ca/lib/offline-optimizer-v2/routeOptimizerSimple.ts`
- `/home/drone/rmp.ca/lib/route-optimizer-v2/routeOptimizer.ts`
- `/home/drone/rmp.ca/lib/vrp-solvers/ortools.ts`
- `/home/drone/rmp.ca/lib/vrp-solvers/clarke-wright.ts`
- `/home/drone/rmp.ca/lib/vrp-solvers/two-opt.ts`

### Test Files
- `/home/drone/rmp.ca/backend/test_optimize.py`
- `/home/drone/rmp.ca/backend/tests/test_optimize.py`
- `/home/drone/rmp.ca/backend/tests/test_vrp.py`

## Docker Configuration

- Main compose file: `/home/drone/rmp.ca/docker-compose.yml`
- Optimizer profile: `/home/drone/rmp.ca/docker-compose.optimizer.yml`
- Nginx configuration: `/home/drone/rmp.ca/nginx/optimizer.conf`

## Environment Variables

The `.env` file in the root directory contains configuration for:
- API base URLs
- Optimizer and extractor URLs
- Node.js heap size
- Local development settings

## Notes

1. The Docker setup automatically handles all Python and Node.js dependencies
2. For local development without Docker, you'll need to install:
   - Python 3.12+
   - Node.js 18+
   - All packages listed in `backend/requirements.txt`
3. The optimizer profile includes Redis and Celery for background task processing
4. Port mappings:
   - Backend: 3000
   - Extractor: 4000
   - Optimizer: 8000 (via nginx)
