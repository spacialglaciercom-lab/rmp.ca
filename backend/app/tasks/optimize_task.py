"""
Celery task: Chinese Postman route optimizer.

Separation of concerns
----------------------
- This module owns the *task boundary* only: deserialise, call, serialise.
- All graph-build / CPP-solve logic lives in app.optimize._run_optimize.
- All routing/HTTP logic lives in app.optimize.router.

Error taxonomy
--------------
ValueError       Structurally invalid payload or unroutable GeoJSON (no
                 LineStrings, graph < 2 nodes, etc.).
                 Status endpoint → HTTP 400.

RuntimeError     Graph build or CPP solve failed unexpectedly, or the
                 soft time limit fired.
                 Status endpoint → HTTP 500.
"""
from __future__ import annotations

import logging
from typing import Any

from celery import Task
from celery.exceptions import SoftTimeLimitExceeded

from ..celery_app import celery_app
from ..optimize import OptimizeRequest, OptimizeResponse, _run_optimize

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Base task class
# ---------------------------------------------------------------------------

class _OptimizeTaskBase(Task):
    abstract = True

    def on_failure(
        self,
        exc: Exception,
        task_id: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        einfo: object,
    ) -> None:
        log.error(
            "Optimize task failed",
            extra={"task_id": task_id, "error": str(exc)},
            exc_info=False,
        )


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    base=_OptimizeTaskBase,
    name="rmpca.tasks.optimize_route",
    max_retries=0,
    throws=(ValueError,),
)
def optimize_route_task(self: Task, req_dict: dict[str, Any]) -> dict[str, Any]:
    """Execute Chinese Postman route optimisation in a Celery worker process.

    Args:
        req_dict: JSON-serialisable dict matching OptimizeRequest schema.

    Returns:
        JSON-serialisable dict matching OptimizeResponse.

    Raises:
        ValueError: unroutable input (no valid road features, graph too small,
            or Pydantic validation failure).
        RuntimeError: graph build or CPP solve failed, or time limit exceeded.
    """
    # ── 1. Deserialise ───────────────────────────────────────────────────────
    try:
        req = OptimizeRequest.model_validate(req_dict)
    except Exception as exc:
        raise ValueError(f"Invalid optimize request payload: {exc}") from exc

    # ── 2. Run optimisation ──────────────────────────────────────────────────
    try:
        result: OptimizeResponse = _run_optimize(req)
    except SoftTimeLimitExceeded:
        raise RuntimeError(
            "Route optimisation exceeded the worker time limit. "
            "The GeoJSON network may be too large. "
            "Try reducing the area or filtering road classes."
        ) from None
    except ValueError:
        # Re-raise as-is: unroutable data is a client error (400).
        raise
    except MemoryError:
        raise RuntimeError(
            "Worker ran out of memory processing the GeoJSON payload. "
            f"Input has {len(req.geojson.features)} features."
        ) from None
    except Exception as exc:
        log.exception(
            "Optimize task %s raised an unexpected error", self.request.id
        )
        raise RuntimeError(f"Optimisation error: {exc}") from exc

    # ── 3. Serialise ─────────────────────────────────────────────────────────
    return result.model_dump()
