# Zones Partition API — deploy to Cloud Run (replaces placeholder).
# Build: docker build -t gcr.io/PROJECT_ID/trashroute-backend ./backend
# Run: uvicorn listens on $PORT (Cloud Run sets 8080).
#
# BASE_IMAGE can be overridden to use a registry mirror if Docker Hub is
# unreachable (e.g. behind a VPN):
#   docker build --build-arg BASE_IMAGE=public.ecr.aws/docker/library/python:3.12-slim .
# Default uses AWS ECR Public Gallery which avoids Docker Hub TLS issues on many VPNs.
ARG BASE_IMAGE=public.ecr.aws/docker/library/python:3.12-slim
FROM ${BASE_IMAGE}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/

ENV PORT=8080
EXPOSE 8080

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
