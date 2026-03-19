"""
Routing cost plugins: modular cost modifiers for directed edge weights.

Plugins can add elevation/fuel, traffic, weather, or turn penalties without
cluttering the core graph-building logic. Used by geojson_ops and optimize.
"""
from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Any

try:
    import rasterio
except ImportError:
    rasterio = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Bearing and turn angle helpers (geo math)
# ---------------------------------------------------------------------------


def calculate_bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """
    Forward azimuth from (lon1, lat1) to (lon2, lat2) in degrees.
    Returns 0–360 (0 = North, 90 = East, 180 = South, 270 = West).
    """
    dlon = math.radians(lon2 - lon1)
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    x = math.sin(dlon) * math.cos(lat2_r)
    y = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def get_turn_angle(bearing_in: float, bearing_out: float) -> float:
    """
    Change in heading from bearing_in to bearing_out, in degrees.
    Range: -180 to 180.
    Positive = right turn, negative = left turn.
    """
    diff = (bearing_out - bearing_in + 360) % 360
    return diff if diff <= 180 else diff - 360


# ---------------------------------------------------------------------------
# Helpers used by FuelAwarePlugin (exposed for tests and reuse)
# ---------------------------------------------------------------------------


def sample_elevation_from_dem(
    nodes_2d: list[tuple[float, float]], dem_path: str
) -> list[float | None]:
    """
    Sample elevation in meters for each (lon, lat) from a GeoTIFF DEM.
    Returns one elevation per node; None for no-data or out-of-extent.
    DEM must be WGS84 (EPSG:4326).
    """
    if rasterio is None:
        raise ImportError(
            "rasterio is required for elevation sampling; install with pip install rasterio"
        )
    with rasterio.open(dem_path) as dataset:
        if dataset.crs is None or dataset.crs.to_epsg() != 4326:
            raise ValueError(
                "DEM must be WGS84 (EPSG:4326); Overture data is strictly WGS84. "
                f"Got CRS: {dataset.crs}"
            )
        nodata = dataset.nodata
        out: list[float | None] = []
        for arr in dataset.sample(nodes_2d):
            val = float(arr[0]) if arr.size > 0 else None
            if val is not None and nodata is not None and val == nodata:
                val = None
            out.append(val)
        return out


def grade_percent(elev_a_m: float, elev_b_m: float, distance_m: float) -> float:
    """
    Grade percentage from A to B: ((elev_B - elev_A) / distance_m) * 100.
    Returns 0.0 if distance_m < 1.0 to avoid extreme spikes from tiny segments.
    """
    if distance_m < 1.0:
        return 0.0
    return ((elev_b_m - elev_a_m) / distance_m) * 100.0


def fuel_multiplier(grade_pct: float, min_multiplier: float = 0.5) -> float:
    """
    0% grade -> 1.0. Uphill: mult = 1.0 + (grade_pct * 0.1). Downhill: mult = 1.0 + (grade_pct * 0.04).
    Clamped from below by min_multiplier.
    """
    if grade_pct >= 0:
        mult = 1.0 + (grade_pct * 0.1)
    else:
        mult = 1.0 + (grade_pct * 0.04)
    return max(min_multiplier, mult)


# ---------------------------------------------------------------------------
# Plugin interface
# ---------------------------------------------------------------------------


class RoutingCostPlugin(ABC):
    """Abstract base for plugins that modify edge cost (e.g. fuel, traffic, weather)."""

    @abstractmethod
    def pre_process_nodes(
        self, coords_list: list[tuple[float, float]]
    ) -> dict[int, dict[str, Any]]:
        """
        Fetch bulk data for all nodes (e.g. sample DEM).
        Returns a dict mapping node index -> node-specific data (e.g. {'elevation': 120}).
        """
        ...

    @abstractmethod
    def calculate_multiplier(
        self,
        coords_u: tuple[float, float],
        coords_v: tuple[float, float],
        data_u: dict[str, Any],
        data_v: dict[str, Any],
        distance_m: float,
    ) -> float:
        """
        Return the cost multiplier for the directed edge U -> V.
        Base cost is multiplied by this (e.g. 1.0 = no change, 1.5 = 50% more cost).
        """
        ...

    def calculate_transition_multiplier(
        self,
        coords_t: tuple[float, float],
        coords_u: tuple[float, float],
        coords_v: tuple[float, float],
    ) -> float:
        """
        Cost multiplier for transitioning from edge (T -> U) to edge (U -> V).
        Default: 1.0 (no turn penalty). Override for turn-dependent costs.
        When U is the start node (no previous T), the solver uses 1.0.
        """
        return 1.0


# ---------------------------------------------------------------------------
# Fuel-aware plugin
# ---------------------------------------------------------------------------


class FuelAwarePlugin(RoutingCostPlugin):
    """Plugin that applies fuel cost from DEM elevation and road grade."""

    def __init__(self, dem_path: str, min_multiplier: float = 0.5) -> None:
        self.dem_path = dem_path
        self.min_multiplier = min_multiplier

    def pre_process_nodes(
        self, coords_list: list[tuple[float, float]]
    ) -> dict[int, dict[str, Any]]:
        elevations = sample_elevation_from_dem(coords_list, self.dem_path)
        return {
            i: {
                "elevation": (
                    elevations[i] if i < len(elevations) and elevations[i] is not None
                    else 0.0
                )
            }
            for i in range(len(coords_list))
        }

    def calculate_multiplier(
        self,
        coords_u: tuple[float, float],
        coords_v: tuple[float, float],
        data_u: dict[str, Any],
        data_v: dict[str, Any],
        distance_m: float,
    ) -> float:
        z_u = data_u.get("elevation", 0.0)
        z_v = data_v.get("elevation", 0.0)
        g = grade_percent(z_u, z_v, distance_m)
        return fuel_multiplier(g, min_multiplier=self.min_multiplier)


# ---------------------------------------------------------------------------
# Turn penalty plugin (UPS-style: penalize left turns and U-turns)
# ---------------------------------------------------------------------------


class TurnPenaltyPlugin(RoutingCostPlugin):
    """
    Plugin that applies multiplicative penalties for left turns and U-turns,
    similar to UPS routing. Uses transition cost (T -> U -> V) so path-dependent.
    """

    def __init__(
        self,
        straight_mult: float = 1.0,
        right_mult: float = 1.0,
        left_mult: float = 1.4,
        u_turn_mult: float = 3.0,
        straight_deg: float = 45.0,
    ) -> None:
        self.straight_mult = straight_mult
        self.right_mult = right_mult
        self.left_mult = left_mult
        self.u_turn_mult = u_turn_mult
        self.straight_deg = straight_deg  # ± degrees for "straight" (e.g. -45 to 45)

    def pre_process_nodes(
        self, coords_list: list[tuple[float, float]]
    ) -> dict[int, dict[str, Any]]:
        """No per-node data required for turn penalties."""
        return {i: {} for i in range(len(coords_list))}

    def calculate_multiplier(
        self,
        coords_u: tuple[float, float],
        coords_v: tuple[float, float],
        data_u: dict[str, Any],
        data_v: dict[str, Any],
        distance_m: float,
    ) -> float:
        """Edge cost is unchanged; turn cost is applied via transition multiplier."""
        return 1.0

    def calculate_transition_multiplier(
        self,
        coords_t: tuple[float, float],
        coords_u: tuple[float, float],
        coords_v: tuple[float, float],
    ) -> float:
        bearing_in = calculate_bearing(coords_t[0], coords_t[1], coords_u[0], coords_u[1])
        bearing_out = calculate_bearing(coords_u[0], coords_u[1], coords_v[0], coords_v[1])
        angle = get_turn_angle(bearing_in, bearing_out)

        if -self.straight_deg <= angle <= self.straight_deg:
            return self.straight_mult   # straight: 1.0
        if 45 <= angle <= 135:
            return self.right_mult      # right turn: 1.0
        if -135 <= angle <= -45:
            return self.left_mult       # left turn: 1.4
        return self.u_turn_mult         # U-turn (<-135 or >135): 3.0
