"""
Celery task: VRP solver (OR-Tools).

Separation of concerns
----------------------
- This module owns the *task boundary* only: deserialise the payload,
  call the pure solver, serialise the result.
- All OR-Tools logic lives in app.vrp._solve_ortools — untouched.
- All routing/HTTP logic lives in app.vrp.router — untouched.

Error taxonomy
--------------
ValueError       Raised for structurally invalid request payloads
                 (Pydantic validation, 0 vehicles, etc.).  The status
                 endpoint surfaces these as HTTP 400.

RuntimeError     Raised when OR-Tools cannot produce a solution or the
                 soft time limit fires.  The status endpoint surfaces
                 these as HTTP 500.

Any other exc    Propagated as-is; Celery records FAILURE with a full
                 traceback in the result backend.
"""
from __future__ import annotations

import logging
from typing import Any

from celery import Task
from celery.exceptions import SoftTimeLimitExceeded

from ..celery_app import celery_app
from ..vrp import VrpRequest, VrpResponse, _solve_ortools

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Base task class — structured failure logging
# ---------------------------------------------------------------------------

class _VrpTaskBase(Task):
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
            "VRP task failed",
            extra={"task_id": task_id, "error": str(exc)},
            exc_info=False,
        )


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    base=_VrpTaskBase,
    name="rmpca.tasks.solve_vrp",
    # max_retries=0: VRP failures are deterministic; retrying the same payload
    # against the same solver produces the same outcome.
    max_retries=0,
    # Declare ValueError as an expected exception so Celery stores it as
    # FAILURE without logging a spurious ERROR-level traceback.
    throws=(ValueError,),
)
def solve_vrp_task(self: Task, req_dict: dict[str, Any]) -> dict[str, Any]:
    """Execute VRP solve in a Celery worker process.

    Args:
        req_dict: JSON-serialisable dict matching the VrpRequest schema.
            Passed by the FastAPI endpoint via ``.delay(req.model_dump())``.

    Returns:
        JSON-serialisable dict matching VrpResponse.  Stored in Redis by
        Celery's result backend; fetched via AsyncResult.get().

    Raises:
        ValueError: payload does not satisfy VrpRequest validation rules.
        RuntimeError: OR-Tools failed to produce any solution, or the
            worker-level soft time limit was exceeded.
    """
    # ── 1. Deserialise ───────────────────────────────────────────────────────
    try:
        req = VrpRequest.model_validate(req_dict)
    except Exception as exc:
        raise ValueError(f"Invalid VRP request payload: {exc}") from exc

    # ── 2. Guard: minimum viable input ───────────────────────────────────────
    if not req.vehicles:
        raise ValueError("VRP request contains no vehicles.")
    if not req.stops:
        # Degenerate but valid — return an empty solution immediately.
        return VrpResponse(
            routes=[], total_distance=0, total_duration=0, unassigned=[]
        ).model_dump()

    # ── 3. Solve ─────────────────────────────────────────────────────────────
    try:
        result: VrpResponse = _solve_ortools(req)
    except SoftTimeLimitExceeded:
        raise RuntimeError(
            "OR-Tools VRP solver exceeded the worker time limit. "
            "Reduce the number of stops or vehicles and retry."
        ) from None
    except MemoryError:
        raise RuntimeError(
            "Worker ran out of memory building the distance matrix. "
            f"Input has {len(req.stops)} stops × {len(req.vehicles)} vehicles."
        ) from None
    except Exception as exc:
        log.exception(
            "OR-Tools raised an unexpected error in task %s", self.request.id
        )
        raise RuntimeError(f"Solver error: {exc}") from exc

    # ── 4. Serialise ─────────────────────────────────────────────────────────
    return result.model_dump()
