"""
VRP solver plugin registry for the backend.

Register custom solvers with register_solver(); the /api/vrp/solve endpoint
dispatches by the request's solver id (default "ortools").
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from .vrp import VrpRequest, VrpResponse


class VrpSolverProtocol(Protocol):
    """Protocol for backend VRP solvers. Implement solve() and register with register_solver()."""

    def solve(self, req: "VrpRequest") -> "VrpResponse":
        """Solve the VRP; return routes, total_distance, total_duration, unassigned."""
        ...


_REGISTRY: dict[str, VrpSolverProtocol] = {}
_DEFAULT_SOLVER_ID = "ortools"


def register_solver(solver_id: str, solver: VrpSolverProtocol) -> None:
    """Register a VRP solver. Overwrites any existing solver with the same id."""
    _REGISTRY[solver_id] = solver


def get_solver(solver_id: str) -> VrpSolverProtocol | None:
    """Look up a solver by id. Returns None if not found."""
    return _REGISTRY.get(solver_id)


def get_default_solver_id() -> str:
    """Return the default solver id used when the client does not specify one."""
    return _DEFAULT_SOLVER_ID


def get_solver_ids() -> list[str]:
    """Return all registered solver ids (for discovery)."""
    return list(_REGISTRY.keys())
