"""
RouteFinder VRP Solver Plugin — integrates ai4co/RouteFinder neural solver
into the rmp.ca VRP pipeline.

Architecture:
  - RouteFinder model runs in a separate inference server process (routefinder_server.py)
    that keeps the model loaded in GPU/CPU memory for fast inference.
  - This plugin calls the inference server via HTTP, converting rmp.ca's VrpRequest
    format to RouteFinder's input format and converting RouteFinder's output back
    to VrpResponse.

Two modes:
  1. HTTP mode: calls the RouteFinder inference server at ROUTEFINDER_URL (default)
  2. Direct mode: loads the model in-process (for development / testing)

Fallback: If RouteFinder is unavailable, falls back to OR-Tools.
"""
from __future__ import annotations

import logging
import math
import os
import time
from typing import Any, List, Optional, Tuple

import httpx
from pydantic import BaseModel

from .vrp import (
    VrpLocation,
    VrpRequest,
    VrpResponse,
    VrpRoute,
    VrpRouteStep,
)
from .vrp_registry import get_solver

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROUTFINDER_URL = os.getenv("ROUTFINDER_URL", "http://localhost:8321")
ROUTFINDER_TIMEOUT = float(os.getenv("ROUTFINDER_TIMEOUT", "120"))  # seconds
ROUTFINDER_VARIANT = os.getenv("ROUTFINDER_VARIANT", "cvrp")
ROUTFINDER_NUM_AUGMENT = int(os.getenv("ROUTFINDER_NUM_AUGMENT", "8"))
ROUTFINDER_DEVICE = os.getenv("ROUTFINDER_DEVICE", "cpu")
ROUTFINDER_FALLBACK_SOLVER = os.getenv("ROUTFINDER_FALLBACK_SOLVER", "ortools")

# ---------------------------------------------------------------------------
# RouteFinder Solver
# ---------------------------------------------------------------------------


class RouteFinderSolver:
    """
    VRP solver backed by RouteFinder (ai4co/routefinder) neural model.

    Communicates with a RouteFinder inference server over HTTP.
    The inference server loads the model once and keeps it warm for fast
    batch inference, supporting 48 VRP variants out of the box.
    """

    def __init__(
        self,
        url: str = ROUTEFINDER_URL,
        timeout: float = ROUTEFINDER_TIMEOUT,
        variant: str = ROUTEFINDER_VARIANT,
        num_augment: int = ROUTEFINDER_NUM_AUGMENT,
        fallback_solver_id: str = ROUTEFINDER_FALLBACK_SOLVER,
    ):
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.variant = variant
        self.num_augment = num_augment
        self.fallback_solver_id = fallback_solver_id

    def solve(self, req: VrpRequest) -> VrpResponse:
        """Solve VRP via RouteFinder inference server, with OR-Tools fallback."""
        try:
            return self._solve_routefinder(req)
        except Exception as exc:
            logger.warning(
                "RouteFinder solver failed (%s), falling back to %s: %s",
                type(exc).__name__,
                self.fallback_solver_id,
                exc,
            )
            fallback = get_solver(self.fallback_solver_id)
            if fallback is not None:
                return fallback.solve(req)
            raise

    def _solve_routefinder(self, req: VrpRequest) -> VrpResponse:
        """Call the RouteFinder inference server."""
        # Convert VrpRequest → RouteFinder input format
        payload = self._build_payload(req)

        t0 = time.perf_counter()
        response = httpx.post(
            f"{self.url}/solve",
            json=payload,
            timeout=self.timeout,
        )
        elapsed_ms = (time.perf_counter() - t0) * 1000
        response.raise_for_status()
        result = response.json()
        logger.info(
            "RouteFinder solved %d stops in %.1f ms (variant=%s, cost=%.2f)",
            len(req.stops),
            elapsed_ms,
            result.get("variant", self.variant),
            result.get("total_cost", 0),
        )

        # Convert RouteFinder output → VrpResponse
        return self._parse_result(req, result)

    def _build_payload(self, req: VrpRequest) -> dict:
        """Convert VrpRequest to RouteFinder inference server format."""
        # Collect all locations: depot(s) + stops
        # First vehicle's start_location is the depot
        stops = req.stops
        vehicles = req.vehicles

        # Normalize stops into (lat, lon) + metadata
        depot_lat = vehicles[0].start_location.lat
        depot_lon = vehicles[0].start_location.lon

        # Build location list: [depot, stop_1, stop_2, ...]
        locations = [[depot_lon, depot_lat]]  # RouteFinder uses [lon, lat] = [x, y]
        demands = [0]  # depot demand = 0
        time_windows = None
        service_times = None

        for stop in stops:
            locations.append([stop.location.lon, stop.location.lat])
            demands.append(stop.demand[0] if stop.demand else 0)

        # Detect variant from request metadata
        variant = self._detect_variant(req)

        # Vehicle capacity
        capacity = vehicles[0].capacity[0] if vehicles[0].capacity else 100

        payload: dict[str, Any] = {
            "locations": locations,
            "demands": demands,
            "capacity": capacity,
            "variant": variant,
            "num_augment": self.num_augment,
        }

        # Time windows
        has_tw = any(s.time_window is not None for s in stops) or any(
            v.time_window is not None for v in vehicles
        )
        if has_tw:
            tws = []
            # Depot time window
            if vehicles[0].time_window:
                tws.append([vehicles[0].time_window[0], vehicles[0].time_window[1]])
            else:
                tws.append([0, float(req.use_time_windows) * 1e6])
            for stop in stops:
                if stop.time_window:
                    tws.append([stop.time_window[0], stop.time_window[1]])
                else:
                    tws.append([0, 1e6])
            payload["time_windows"] = tws
            payload["service_times"] = [
                stop.service_duration for stop in stops
            ] or None

        # Open route (vehicle doesn't return to depot)
        if vehicles[0].end_location and (
            vehicles[0].end_location.lat != depot_lat
            or vehicles[0].end_location.lon != depot_lon
        ):
            payload["is_open"] = True

        return payload

    def _detect_variant(self, req: VrpRequest) -> str:
        """Auto-detect the VRP variant from the request parameters."""
        has_tw = any(s.time_window is not None for s in req.stops) or req.use_time_windows
        has_open = any(
            v.end_location is not None
            and (
                v.end_location.lat != v.start_location.lat
                or v.end_location.lon != v.start_location.lon
            )
            for v in req.vehicles
        )

        # Start with base CVRP and add constraints
        variant_parts = ["cvrp"]
        if has_open and has_tw:
            variant_parts = ["ovrptw"]
        elif has_open:
            variant_parts = ["ovrp"]
        elif has_tw:
            variant_parts = ["vrptw"]

        return variant_parts[0] if variant_parts else "cvrp"

    def _parse_result(self, req: VrpRequest, result: dict) -> VrpResponse:
        """Convert RouteFinder inference server output to VrpResponse."""
        routes_data = result.get("routes", [])
        all_locs = self._collect_all_locs(req)
        response_routes: list[VrpRoute] = []
        total_distance = 0
        total_duration = 0

        for route_info in routes_data:
            vehicle_id = route_info.get("vehicle_id", 0)
            visit_sequence = route_info.get("visit_sequence", [])
            cost = route_info.get("cost", 0)

            steps: list[VrpRouteStep] = []
            route_dist = 0

            # Start step (depot)
            depot_idx = 0
            depot_loc = all_locs[depot_idx]
            steps.append(VrpRouteStep(
                type="start",
                location=VrpLocation(lat=depot_loc[0], lon=depot_loc[1]),
                arrival=0,
                duration=0,
            ))

            # Visit steps
            for i, stop_idx in enumerate(visit_sequence):
                if stop_idx == 0:
                    # Return to depot
                    continue
                loc = all_locs[stop_idx] if stop_idx < len(all_locs) else all_locs[0]
                stop = req.stops[stop_idx - 1] if stop_idx - 1 < len(req.stops) else None
                steps.append(VrpRouteStep(
                    type="job",
                    id=stop.id if stop else stop_idx,
                    location=VrpLocation(lat=loc[0], lon=loc[1]),
                    arrival=0,
                    duration=stop.service_duration if stop else 0,
                ))

            # End step
            end_loc = all_locs[0]  # Return to depot
            if route_info.get("is_open"):
                last_visit_idx = visit_sequence[-1] if visit_sequence else 0
                end_loc = all_locs[last_visit_idx] if last_visit_idx < len(all_locs) else all_locs[0]
            steps.append(VrpRouteStep(
                type="end",
                location=VrpLocation(lat=end_loc[0], lon=end_loc[1]),
                arrival=0,
                duration=0,
            ))

            route_dist = int(cost * 1000)  # RouteFinder cost → approximate meters

            response_routes.append(VrpRoute(
                vehicle_id=vehicle_id,
                steps=steps,
                total_distance=route_dist,
                total_duration=0,
                total_load=0,
            ))
            total_distance += route_dist

        # Find unassigned stops
        assigned_ids = set()
        for route_info in routes_data:
            for stop_idx in route_info.get("visit_sequence", []):
                if stop_idx > 0 and stop_idx - 1 < len(req.stops):
                    assigned_ids.add(req.stops[stop_idx - 1].id)

        unassigned = [s.id for s in req.stops if s.id not in assigned_ids]

        return VrpResponse(
            routes=response_routes,
            total_distance=total_distance,
            total_duration=total_duration,
            unassigned=unassigned,
        )

    def _collect_all_locs(self, req: VrpRequest) -> list[tuple[float, float]]:
        """Collect all locations as (lat, lon) tuples. Index 0 = depot."""
        locs = []
        # Depot (first vehicle's start)
        v = req.vehicles[0]
        locs.append((v.start_location.lat, v.start_location.lon))
        # Stops
        for s in req.stops:
            locs.append((s.location.lat, s.location.lon))
        return locs

    def health_check(self) -> dict:
        """Check if the RouteFinder inference server is healthy."""
        try:
            r = httpx.get(f"{self.url}/health", timeout=5.0)
            if r.status_code == 200:
                return r.json()
            return {"status": "error", "code": r.status_code}
        except Exception as e:
            return {"status": "unavailable", "error": str(e)}


# ---------------------------------------------------------------------------
# Direct (in-process) solver — loads model into the same process
# ---------------------------------------------------------------------------


class RouteFinderDirectSolver:
    """
    In-process RouteFinder solver. Loads the model directly into the
    current Python process. Use for development / testing only —
    the inference server is preferred for production to avoid loading
    GB-sized models on every request.
    """

    def __init__(
        self,
        checkpoint: str | None = None,
        device: str = ROUTEFINDER_DEVICE,
        variant: str = ROUTEFINDER_VARIANT,
        num_augment: int = ROUTEFINDER_NUM_AUGMENT,
        fallback_solver_id: str = ROUTEFINDER_FALLBACK_SOLVER,
    ):
        self.checkpoint = checkpoint or os.getenv(
            "ROUTFINDER_CHECKPOINT",
            "checkpoints/100/rf-transformer.ckpt",
        )
        self.device = device
        self.variant = variant
        self.num_augment = num_augment
        self.fallback_solver_id = fallback_solver_id
        self._model = None
        self._env = None
        self._policy = None

    def _lazy_load(self):
        """Lazily load model on first solve call."""
        if self._policy is not None:
            return

        try:
            import torch
            from routefinder.models import RouteFinderBase
            from routefinder.envs import MTVRPEnv

            logger.info("Loading RouteFinder model from %s on %s", self.checkpoint, self.device)
            device = torch.device(self.device)

            self._env = MTVRPEnv()
            model = RouteFinderBase.load_from_checkpoint(
                self.checkpoint, map_location="cpu", strict=False
            )
            self._policy = model.policy.to(device).eval()
            self._device = device

            # Download checkpoint if not found
            if not os.path.exists(self.checkpoint):
                logger.info("Checkpoint not found locally, downloading from HuggingFace...")
                from huggingface_hub import snapshot_download
                snapshot_download(
                    "ai4co/routefinder",
                    allow_patterns=["checkpoints/*"],
                    local_dir=".",
                )

            logger.info("RouteFinder model loaded successfully")

        except ImportError as e:
            logger.error(
                "RouteFinder dependencies not installed. "
                "Install with: pip install routefinder rl4co torch. Error: %s",
                e,
            )
            raise

    def solve(self, req: VrpRequest) -> VrpResponse:
        """Solve VRP using RouteFinder model directly in-process."""
        try:
            self._lazy_load()
            return self._solve_direct(req)
        except Exception as exc:
            logger.warning(
                "RouteFinder direct solver failed (%s), falling back to %s: %s",
                type(exc).__name__,
                self.fallback_solver_id,
                exc,
            )
            fallback = get_solver(self.fallback_solver_id)
            if fallback is not None:
                return fallback.solve(req)
            raise

    def _solve_direct(self, req: VrpRequest) -> VrpResponse:
        """In-process solve using RouteFinder."""
        import torch
        from routefinder.utils import evaluate

        # Convert VrpRequest → RouteFinder TensorDict
        td = self._request_to_td(req)

        # Run inference
        td = td.to(self._device)
        out = evaluate(self._policy if self._policy else self._model, td, num_augment=self.num_augment)

        # Parse actions → VrpResponse
        return self._parse_actions(req, td, out)

    def _request_to_td(self, req: VrpRequest):
        """Convert VrpRequest to RouteFinder TensorDict."""
        import torch
        from tensordict.tensordict import TensorDict
        from routefinder.envs import MTVRPEnv, MTVRPGenerator

        env = self._env or MTVRPEnv()

        # Collect locations: depot + stops (normalized [0,1] as RouteFinder expects)
        depot_lat = req.vehicles[0].start_location.lat
        depot_lon = req.vehicles[0].start_location.lon

        # Compute bounding box for normalization
        all_lats = [depot_lat] + [s.location.lat for s in req.stops]
        all_lons = [depot_lon] + [s.location.lon for s in req.stops]
        min_lat, max_lat = min(all_lats), max(all_lats)
        min_lon, max_lon = min(all_lons), max(all_lons)

        # Normalize to [0, 1] range (RouteFinder's expected input scale)
        lat_range = max_lat - min_lat if max_lat != min_lat else 1.0
        lon_range = max_lon - min_lon if max_lon != min_lon else 1.0

        # Build locs tensor: [1, num_nodes, 2] where locs[i] = [x, y]
        # RouteFinder format: depot is index 0, locs are [x, y] normalized
        n = len(req.stops) + 1  # depot + stops

        locs = torch.zeros(1, n, 2)
        locs[0, 0, 0] = (depot_lon - min_lon) / lon_range  # x
        locs[0, 0, 1] = (depot_lat - min_lat) / lat_range  # y
        for i, stop in enumerate(req.stops):
            locs[0, i + 1, 0] = (stop.location.lon - min_lon) / lon_range
            locs[0, i + 1, 1] = (stop.location.lat - min_lat) / lat_range

        # Demands
        demands = torch.zeros(1, n)
        for i, stop in enumerate(req.stops):
            demands[0, i + 1] = stop.demand[0] if stop.demand else 0

        # Capacity
        capacity = req.vehicles[0].capacity[0] if req.vehicles[0].capacity else 100

        # Detect variant flags
        variant = self._detect_variant(req)

        td = TensorDict({
            "locs": locs,
            "demand": demands[:, :, None],  # [batch, n, 1]
            "capacity": torch.tensor([capacity]),
            "action_mask": torch.ones(1, n, dtype=torch.bool),
        }, batch_size=[1])

        # Add variant-specific fields
        if variant in ("vrptw", "ovrptw", "vrpbltw", "ovrpbltw", "vrpltw", "ovrpltw"):
            # Time windows
            if "time_windows" not in td.keys():
                tw = torch.zeros(1, n, 2)
                tw[0, 0, 1] = 1e6  # depot window: [0, large]
                for i, stop in enumerate(req.stops):
                    if stop.time_window:
                        tw[0, i + 1, 0] = stop.time_window[0]
                        tw[0, i + 1, 1] = stop.time_window[1]
                    else:
                        tw[0, i + 1, 0] = 0
                        tw[0, i + 1, 1] = 1e6
                td.set("time_windows", tw)

        # Generate with the environment (creates all required fields)
        td = env.reset(td)

        return td

    def _detect_variant(self, req: VrpRequest) -> str:
        """Auto-detect the VRP variant from the request parameters."""
        has_tw = any(s.time_window is not None for s in req.stops) or req.use_time_windows
        has_open = any(
            v.end_location is not None
            and (
                v.end_location.lat != v.start_location.lat
                or v.end_location.lon != v.start_location.lon
            )
            for v in req.vehicles
        )

        if has_open and has_tw:
            return "ovrptw"
        elif has_open:
            return "ovrp"
        elif has_tw:
            return "vrptw"
        return "cvrp"

    def _parse_actions(self, req, td, out):
        """Parse RouteFinder actions into VrpResponse."""
        import torch

        actions = out.get("best_aug_actions", out.get("actions", None))
        if actions is None:
            logger.error("No actions in RouteFinder output")
            return VrpResponse(routes=[], total_distance=0, total_duration=0, unassigned=[s.id for s in req.stops])

        # actions shape: [batch, num_steps] — each entry is a node index (0=depot)
        actions = actions.cpu().detach()
        if actions.dim() > 1:
            actions = actions[0]  # Take first (and only) batch

        # Extract visit sequence (remove depot returns)
        visit_sequence = []
        for a in actions:
            a_int = a.item()
            if a_int != 0:  # 0 = depot
                visit_sequence.append(a_int)

        # Build route
        all_locs = self._collect_all_locs(req)
        depot_loc = all_locs[0]

        steps = []
        # Start at depot
        steps.append(VrpRouteStep(
            type="start",
            location=VrpLocation(lat=depot_loc[0], lon=depot_loc[1]),
            arrival=0,
            duration=0,
        ))

        # Visit stops
        total_load = 0
        for idx in visit_sequence:
            if idx - 1 < 0 or idx - 1 >= len(req.stops):
                continue
            stop = req.stops[idx - 1]
            loc = all_locs[idx] if idx < len(all_locs) else all_locs[0]
            total_load += stop.demand[0] if stop.demand else 0
            steps.append(VrpRouteStep(
                type="job",
                id=stop.id,
                location=VrpLocation(lat=loc[0], lon=loc[1]),
                arrival=0,
                duration=stop.service_duration,
            ))

        # End at depot
        steps.append(VrpRouteStep(
            type="end",
            location=VrpLocation(lat=depot_loc[0], lon=depot_loc[1]),
            arrival=0,
            duration=0,
        ))

        # Calculate total distance from RouteFinder cost
        total_cost = -out.get("max_aug_reward", out.get("reward", torch.tensor(0))).item()
        total_distance = int(total_cost * 1000)  # Approximate: cost → meters

        route = VrpRoute(
            vehicle_id=req.vehicles[0].id,
            steps=steps,
            total_distance=total_distance,
            total_duration=0,
            total_load=total_load,
        )

        # Find unassigned stops
        assigned_ids = set()
        for idx in visit_sequence:
            if 0 < idx <= len(req.stops):
                assigned_ids.add(req.stops[idx - 1].id)
        for idx in visit_sequence:
            if 0 < idx <= len(req.stops):
                assigned_ids.add(req.stops[idx - 1].id)
        unassigned = [s.id for s in req.stops if s.id not in assigned_ids]

        return VrpResponse(
            routes=[route],
            total_distance=total_distance,
            total_duration=0,
            unassigned=unassigned,
        )

    def _collect_all_locs(self, req: VrpRequest) -> list[tuple[float, float]]:
        """Collect all locations as (lat, lon) tuples. Index 0 = depot."""
        locs = []
        v = req.vehicles[0]
        locs.append((v.start_location.lat, v.start_location.lon))
        for s in req.stops:
            locs.append((s.location.lat, s.location.lon))
        return locs


# ---------------------------------------------------------------------------
# Convenience: auto-register RouteFinder solver
# ---------------------------------------------------------------------------


def register_routefinder_solver(
    mode: str = "http",
    **kwargs,
) -> None:
    """
    Register the RouteFinder solver in the VRP solver registry.

    Args:
        mode: "http" (calls inference server) or "direct" (loads model in-process)
        **kwargs: Additional arguments passed to the solver constructor.
    """
    from .vrp_registry import register_solver

    if mode == "http":
        solver = RouteFinderSolver(**kwargs)
    elif mode == "direct":
        solver = RouteFinderDirectSolver(**kwargs)
    else:
        raise ValueError(f"Unknown mode: {mode}. Use 'http' or 'direct'.")

    register_solver("routefinder", solver)
    logger.info("RouteFinder solver registered as '%s' (mode=%s)", "routefinder", mode)


# Auto-register if RouteFinder is available
_auto_register = os.getenv("ROUTFINDER_AUTO_REGISTER", "").lower() in ("1", "true", "yes")
if _auto_register:
    try:
        register_routefinder_solver(mode=os.getenv("ROUTFINDER_MODE", "http"))
    except Exception as e:
        logger.warning("Auto-registration of RouteFinder solver failed: %s", e)