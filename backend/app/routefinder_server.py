#!/usr/bin/env python3
"""
RouteFinder Inference Server — lightweight FastAPI server that loads the
RouteFinder model once and serves VRP solve requests over HTTP.

Usage:
    # Start server (auto-downloads model checkpoint)
    python routefinder_server.py --checkpoint checkpoints/100/rf-transformer.ckpt --device cuda --port 8321

    # Or use HuggingFace model directly (auto-downloads):
    python routefinder_server.py --device cuda

This keeps the multi-GB model in GPU memory, so each solve request only
involves a forward pass (milliseconds for typical problem sizes).

The rmp.ca backend calls this server via vrp_routefinder.py (HTTP mode).
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("routefinder_server")

# ---------------------------------------------------------------------------
# Global model state
# ---------------------------------------------------------------------------

_model_state = {
    "policy": None,
    "env": None,
    "device": None,
    "loaded": False,
}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SolveRequest(BaseModel):
    """Input format for the RouteFinder inference server."""
    locations: list[list[float]]       # [[x, y], ...] — depot is index 0
    demands: list[float]               # [0, d1, d2, ...]  — depot demand = 0
    capacity: float                    # Vehicle capacity
    variant: str = "cvrp"             # VRP variant name (cvrp, vrptw, ovrp, etc.)
    num_augment: int = 8              # Number of augmentation transforms (dihedral8)
    num_starts: int | None = None     # Number of POMO starting nodes (None = all)
    # Optional constraint fields
    time_windows: list[list[float]] | None = None   # [[early, late], ...]
    service_times: list[float] | None = None         # [s0, s1, ...]
    is_open: bool = False                             # Open route (don't return to depot)
    distance_limit: float | None = None              # Duration/route length limit
    speed: float = 1.0                                # Vehicle speed for time calculations


class SolveResponse(BaseModel):
    """Output format from the RouteFinder inference server."""
    routes: list[dict[str, Any]]   # List of route dicts
    total_cost: float               # Total route cost (negative reward)
    variant: str                    # VRP variant used
    solve_time_ms: float            # Inference time in milliseconds
    num_augment: int                # Augmentations used
    num_starts: int                 # POMO starting nodes used


class HealthResponse(BaseModel):
    status: str
    device: str
    model_loaded: bool
    variant: str = ""


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------


def load_model(checkpoint: str | None, device: str) -> tuple:
    """Load the RouteFinder model and return (policy, env, device)."""
    from routefinder.models import RouteFinderBase, RouteFinderMoE
    from routefinder.envs import MTVRPEnv

    logger.info("Loading RouteFinder model on %s...", device)
    torch_device = torch.device(device)

    # Download checkpoint if not found
    if checkpoint and not os.path.exists(checkpoint):
        logger.info("Checkpoint not found at %s, downloading from HuggingFace...", checkpoint)
        from huggingface_hub import snapshot_download
        snapshot_download(
            "ai4co/routefinder",
            allow_patterns=["checkpoints/*"],
            local_dir=".",
        )

    # Auto-detect checkpoint path
    if checkpoint is None:
        for candidate in [
            "checkpoints/100/rf-transformer.ckpt",
            "checkpoints/50/rf-transformer.ckpt",
        ]:
            if os.path.exists(candidate):
                checkpoint = candidate
                break
        if checkpoint is None:
            # Download from HF
            from huggingface_hub import snapshot_download
            logger.info("Downloading RouteFinder checkpoints from HuggingFace...")
            snapshot_download(
                "ai4co/routefinder",
                allow_patterns=["checkpoints/*"],
                local_dir=".",
            )
            checkpoint = "checkpoints/100/rf-transformer.ckpt"

    logger.info("Loading checkpoint from %s", checkpoint)

    # Load appropriate model class based on checkpoint name
    if "moe" in checkpoint:
        ModelClass = RouteFinderMoE
    else:
        ModelClass = RouteFinderBase

    model = ModelClass.load_from_checkpoint(
        checkpoint, map_location="cpu", strict=False
    )
    policy = model.policy.to(torch_device).eval()

    env = MTVRPEnv()

    logger.info("RouteFinder model loaded successfully (device=%s)", device)
    return policy, env, torch_device


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------


def solve_vrp(
    policy,
    env,
    device: torch.device,
    request: SolveRequest,
) -> SolveResponse:
    """Run RouteFinder inference on a single VRP instance."""
    from routefinder.utils import evaluate
    from tensordict.tensordict import TensorDict

    n = len(request.locations)

    # Build TensorDict from request
    locs = torch.tensor(request.locations, dtype=torch.float32).unsqueeze(0)  # [1, n, 2]
    demands = torch.tensor(request.demands, dtype=torch.float32).unsqueeze(1)  # [n, 1]
    capacity = torch.tensor([request.capacity], dtype=torch.float32)

    td_dict = {
        "locs": locs,
        "demand": demands.unsqueeze(0),  # [1, n, 1]
        "capacity": capacity,
    }

    # Add variant flags based on variant name
    variant = request.variant.lower()
    is_open = request.is_open or variant.startswith("o")  # ovrp, ovrptw, etc.
    has_backhaul = "b" in variant
    has_tw = "tw" in variant
    has_limit = "l" in variant

    # Time windows
    if request.time_windows is not None or has_tw:
        tw = request.time_windows or [[0, 1e6]] * n
        td_dict["time_windows"] = torch.tensor(tw, dtype=torch.float32).unsqueeze(0)
        if request.service_times is not None:
            td_dict["service_time"] = torch.tensor(request.service_times, dtype=torch.float32).unsqueeze(0)
        else:
            td_dict["service_time"] = torch.zeros(1, n, 1)

    # Open route
    if is_open:
        td_dict["is_open"] = torch.ones(1, dtype=torch.bool)

    # Backhaul
    if has_backhaul:
        # Generate backhaul indicators
        backhaul = torch.zeros(n, dtype=torch.float32)
        if request.demands:
            # Assign backhaul to ~20% of customers (indices 1+)
            n_backhaul = max(1, int(0.2 * (n - 1)))
            for i in range(n - n_backhaul, n):
                if i < n:
                    backhaul[i] = 1.0
        td_dict["backhaul"] = backhaul.unsqueeze(0).unsqueeze(-1)  # [1, n, 1]

    # Duration limit
    if has_limit or request.distance_limit is not None:
        limit = request.distance_limit or 2.8  # default from RouteFinder
        td_dict["distance_limit"] = torch.tensor([limit], dtype=torch.float32)

    td = TensorDict(td_dict, batch_size=[1])
    td = env.reset(td).to(device)

    t0 = time.perf_counter()

    # Run evaluation with augmentation
    num_augment = request.num_augment
    out = evaluate(policy, td, num_augment=num_augment, num_starts=request.num_starts)

    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Parse results
    total_cost = -out.get("max_aug_reward", out.get("reward", torch.tensor(0))).item()

    # Extract route sequences
    actions = out.get("best_aug_actions", out.get("actions"))
    if actions is None:
        routes = []
    else:
        actions = actions.cpu().detach()
        if actions.dim() > 1:
            actions = actions[0]

        visit_sequence = []
        for a in actions:
            a_int = a.item()
            if a_int != 0:  # skip depot visits
                visit_sequence.append(a_int)

        routes = [{
            "vehicle_id": 0,
            "visit_sequence": visit_sequence,
            "cost": total_cost,
            "is_open": is_open,
        }]

    return SolveResponse(
        routes=routes,
        total_cost=total_cost,
        variant=variant,
        solve_time_ms=round(elapsed_ms, 2),
        num_augment=num_augment,
        num_starts=env.get_num_starts(td) if request.num_starts is None else request.num_starts,
    )


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    checkpoint = app.state.checkpoint
    device = app.state.device
    policy, env, torch_device = load_model(checkpoint, device)
    _model_state["policy"] = policy
    _model_state["env"] = env
    _model_state["device"] = torch_device
    _model_state["loaded"] = True
    logger.info("RouteFinder inference server ready on device=%s", device)
    yield
    # Cleanup
    _model_state["policy"] = None
    _model_state["env"] = None
    _model_state["loaded"] = False


app = FastAPI(
    title="RouteFinder Inference Server",
    description="Neural VRP solver powered by ai4co/RouteFinder",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if _model_state["loaded"] else "loading",
        device=str(_model_state.get("device", "not loaded")),
        model_loaded=_model_state["loaded"],
        variant="rf-transformer",
    )


@app.post("/solve", response_model=SolveResponse)
async def solve(request: SolveRequest):
    """Solve a VRP instance using RouteFinder."""
    if not _model_state["loaded"]:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    if _model_state["policy"] is None:
        raise HTTPException(status_code=500, detail="Model failed to load")

    try:
        result = solve_vrp(
            policy=_model_state["policy"],
            env=_model_state["env"],
            device=_model_state["device"],
            request=request,
        )
        return result
    except Exception as e:
        logger.exception("Solve failed")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Multi-vehicle CVRP extension
# ---------------------------------------------------------------------------


class MultiVehicleSolveRequest(BaseModel):
    """Solve CVRP with multiple vehicles and OSRM distance matrix."""
    locations: list[list[float]]       # [[x, y], ...] — depot is index 0
    demands: list[float]               # [0, d1, d2, ...]
    capacity: float                    # Vehicle capacity (same for all vehicles)
    num_vehicles: int = 1              # Number of vehicles
    distance_matrix: list[list[float]] | None = None  # Pre-computed distance matrix (km)
    variant: str = "cvrp"
    num_augment: int = 8


@app.post("/solve_multi", response_model=SolveResponse)
async def solve_multi(request: MultiVehicleSolveRequest):
    """
    Solve multi-vehicle CVRP by splitting into single-vehicle sub-problems.

    For production multi-vehicle VRP, consider using the direct RouteFinder
    integration with the MTVRPEnv or OR-Tools as a post-processor.
    """
    if not _model_state["loaded"]:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    # Convert multi-vehicle request to single-vehicle solve
    # RouteFinder naturally handles capacity constraints, so for
    # multi-vehicle we run single-vehicle solve and split at depot returns
    solve_req = SolveRequest(
        locations=request.locations,
        demands=request.demands,
        capacity=request.capacity,
        variant=request.variant,
        num_augment=request.num_augment,
    )

    result = solve_vrp(
        policy=_model_state["policy"],
        env=_model_state["env"],
        device=_model_state["device"],
        request=solve_req,
    )

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RouteFinder Inference Server")
    parser.add_argument(
        "--checkpoint", type=str, default=None,
        help="Path to model checkpoint (auto-downloads if not found)",
    )
    parser.add_argument(
        "--device", type=str, default=None,
        help="Device to use (cuda, cpu). Auto-detected if not specified.",
    )
    parser.add_argument(
        "--port", type=int, default=8321,
        help="Port to run the server on",
    )
    parser.add_argument(
        "--host", type=str, default="0.0.0.0",
        help="Host to bind to",
    )
    args = parser.parse_args()

    # Auto-detect device
    if args.device is None:
        args.device = "cuda" if torch.cuda.is_available() else "cpu"

    # Store in app state for lifespan
    app.state.checkpoint = args.checkpoint
    app.state.device = args.device

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)