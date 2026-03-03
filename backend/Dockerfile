# Zones Partition API — deploy to Cloud Run (replaces placeholder).
# Build: docker build -t gcr.io/PROJECT_ID/trashroute-backend ./backend
# Run: uvicorn listens on $PORT (Cloud Run sets 8080).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/

ENV PORT=8080
EXPOSE 8080

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
