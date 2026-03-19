"""
Celery application and configuration.

Broker  : Redis  (REDIS_URL env var, defaults to redis://redis:6379/0)
Backend : Redis  (same URL — stores task state + result payloads)

Design decisions:
- task_acks_late=True      : task is acknowledged only after it completes, so a
                             worker crash does not silently drop the job.
- worker_prefetch_multiplier=1 : each worker process holds at most one task at a
                             time; critical for large GeoJSON payloads that consume
                             hundreds of MB of memory while OR-Tools is running.
- task_track_started=True  : exposes the STARTED state so the polling endpoint can
                             distinguish "waiting in queue" from "actively solving".
- result_expires=3600      : results are kept in Redis for 1 hour, long enough for
                             any reasonable polling loop; prevents unbounded memory growth.
- task_time_limit=600      : hard 10-minute ceiling per task.  OR-Tools already has
                             a 10-second internal limit; this catches runaway graph
                             builds on pathologically large inputs.
- task_soft_time_limit=540 : fires SoftTimeLimitExceeded 60 s before the hard kill
                             so tasks can return a clean error message.
"""
from __future__ import annotations

import os

from celery import Celery

# ---------------------------------------------------------------------------
# Connection URL
# ---------------------------------------------------------------------------

REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

celery_app = Celery(
    "rmpca_optimizer",
    broker=REDIS_URL,
    backend=REDIS_URL,
    # Explicit include so autodiscovery is not required and import order is clear.
    include=[
        "app.tasks.vrp_task",
        "app.tasks.optimize_task",
    ],
)

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Reliability
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    # Observability
    task_track_started=True,
    # Results
    result_expires=3600,
    # Time limits (seconds)
    task_time_limit=600,
    task_soft_time_limit=540,
    # Broker connection robustness: retry on startup, back off on transient errors
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": 660,  # Must be >= task_time_limit
    },
)
