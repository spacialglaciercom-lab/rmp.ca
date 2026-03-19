"""
Route analytics: compute detailed metrics for a street-level path.

Reuses the same bearing/turn helpers and plugin contracts that the graph
solver uses, so the numbers are internally consistent with optimized routes.
"""
from __future__ import annotations

from typing import Any

from .geojson_ops import _haversine_m
from .routing_plugins import RoutingCostPlugin, calculate_bearing, get_turn_angle

# Turn-angle thresholds (degrees) – mirror TurnPenaltyPlugin defaults.
_STRAIGHT_DEG = 45.0   # |angle| <= 45  → straight
_TURN_DEG     = 135.0  # 45 < |angle| <= 135 → left/right; beyond → U-turn


def calculate_route_metrics(
    path_coords: list[tuple[float, float] | tuple[float, float, float]],
    plugins: list[RoutingCostPlugin],
) -> dict[str, Any]:
    """
    Analyse a street-level path and return a detailed analytics dictionary.

    Args:
        path_coords:
            Ordered coordinates as ``(lon, lat)`` or ``(lon, lat, z)`` tuples
            (GeoJSON / longitude-first convention).  At least two points are
            required; shorter paths return zeroed metrics.
        plugins:
            Active ``RoutingCostPlugin`` instances (e.g. ``FuelAwarePlugin``,
            ``TurnPenaltyPlugin``).  Pass an empty list when no plugins are
            active; adjusted_cost_m will equal physical_distance_m in that case.

    Returns:
        A dict with keys:
        - ``physical_distance_m``  – sum of haversine segment lengths (m).
        - ``adjusted_cost_m``      – distance weighted by edge *and* transition
                                     multipliers from every active plugin (m).
        - ``elevation_gain_m``     – cumulative positive elevation change (m),
                                     populated only when Z values are present.
        - ``turns``                – ``{"left": int, "right": int,
                                       "u_turn": int, "straight": int}``
                                     using the same ±45 / ±135 ° thresholds as
                                     ``TurnPenaltyPlugin``.
    """
    empty: dict[str, Any] = {
        "physical_distance_m": 0.0,
        "adjusted_cost_m": 0.0,
        "elevation_gain_m": 0.0,
        "turns": {"left": 0, "right": 0, "u_turn": 0, "straight": 0},
    }
    if len(path_coords) < 2:
        return empty

    # 2-D coords (lon, lat) for plugin pre-processing (e.g. bulk DEM sampling).
    coords_2d: list[tuple[float, float]] = [(c[0], c[1]) for c in path_coords]

    # Bulk-fetch per-node data from every plugin (one DEM read per plugin, not per edge).
    node_data: list[dict[str, Any]] = [{} for _ in path_coords]
    for plugin in plugins:
        bulk = plugin.pre_process_nodes(coords_2d)
        for idx, d in bulk.items():
            node_data[idx].update(d)

    has_z = len(path_coords[0]) >= 3

    physical_distance_m = 0.0
    adjusted_cost_m = 0.0
    elevation_gain_m = 0.0
    turns: dict[str, int] = {"left": 0, "right": 0, "u_turn": 0, "straight": 0}

    for i in range(len(path_coords) - 1):
        c_curr = path_coords[i]
        c_next = path_coords[i + 1]
        lon0, lat0 = c_curr[0], c_curr[1]
        lon1, lat1 = c_next[0], c_next[1]

        # ── Physical distance ────────────────────────────────────────────────
        dist_m = _haversine_m(lon0, lat0, lon1, lat1)
        physical_distance_m += dist_m

        # ── Elevation gain from Z values ────────────────────────────────────
        if has_z:
            dz = float(c_next[2]) - float(c_curr[2])
            if dz > 0:
                elevation_gain_m += dz

        # ── Edge cost multipliers (distance-based, e.g. fuel/grade) ─────────
        edge_mult = 1.0
        for plugin in plugins:
            edge_mult *= plugin.calculate_multiplier(
                (lon0, lat0), (lon1, lat1),
                node_data[i], node_data[i + 1],
                dist_m,
            )

        # ── Transition multipliers (path-dependent, e.g. turn penalty) ──────
        # When i == 0 there is no incoming edge, so we use the neutral 1.0.
        transition_mult = 1.0
        if i > 0:
            c_prev = path_coords[i - 1]
            for plugin in plugins:
                transition_mult *= plugin.calculate_transition_multiplier(
                    (c_prev[0], c_prev[1]),
                    (lon0, lat0),
                    (lon1, lat1),
                )

        adjusted_cost_m += dist_m * edge_mult * transition_mult

        # ── Turn classification (requires a previous segment) ────────────────
        if i > 0:
            c_prev = path_coords[i - 1]
            bearing_in  = calculate_bearing(c_prev[0], c_prev[1], lon0, lat0)
            bearing_out = calculate_bearing(lon0, lat0, lon1, lat1)
            angle = get_turn_angle(bearing_in, bearing_out)

            if -_STRAIGHT_DEG <= angle <= _STRAIGHT_DEG:
                turns["straight"] += 1
            elif _STRAIGHT_DEG < angle <= _TURN_DEG:
                turns["right"] += 1
            elif -_TURN_DEG <= angle < -_STRAIGHT_DEG:
                turns["left"] += 1
            else:
                turns["u_turn"] += 1

    return {
        "physical_distance_m": round(physical_distance_m, 2),
        "adjusted_cost_m":     round(adjusted_cost_m, 2),
        "elevation_gain_m":    round(elevation_gain_m, 2),
        "turns": turns,
    }
