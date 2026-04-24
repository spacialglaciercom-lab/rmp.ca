#!/usr/bin/env python3
"""
VRP Benchmark Script: Clarke-Wright Savings + 2-Opt vs. optimal (.sol) baseline.
Parses VRPLIB .vrp and standard .sol files, runs algorithms, reports metrics to console and CSV.
Uses only: math, time, os, pandas.
"""

from __future__ import annotations

import math
import os
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import pandas as pd

# Add path to include backend modules for GPX export
sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

try:
    from app.gpx_export import build_gpx, Waypoint, RouteSegment
    GPX_EXPORT_AVAILABLE = True
except ImportError:
    GPX_EXPORT_AVAILABLE = False
    print("Warning: GPX export modules not available. GPX export will be disabled.", file=sys.stderr)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class VRPProblem:
    """Parsed CVRP instance from a .vrp file."""

    dimension: int
    capacity: int
    coords: Dict[int, Tuple[float, float]]
    demands: Dict[int, float]
    depot: int = 1
    name: str = ""
    # Optional: time window (start_sec, end_sec) per node; seconds since midnight.
    time_windows: Optional[Dict[int, Tuple[int, int]]] = None
    # Optional: per-vehicle capacities (heterogeneous fleet). If None, all use capacity.
    vehicle_capacities: Optional[List[int]] = None
    # Optional: list of (node_a, node_b) that must be on the same route (stress test / route overlap).
    must_share_route: Optional[List[Tuple[int, int]]] = None


# ---------------------------------------------------------------------------
# 1. File parsers
# ---------------------------------------------------------------------------


def parse_vrp(filepath: str) -> VRPProblem:
    """
    Parse a VRPLIB-format .vrp file.
    Returns VRPProblem with dimension, capacity, coords, demands, depot.
    Raises on missing required fields or invalid content.
    """
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"VRP file not found: {filepath}")

    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        lines = [line.strip() for line in f.readlines()]

    dimension: Optional[int] = None
    capacity: Optional[int] = None
    coords: Dict[int, Tuple[float, float]] = {}
    demands: Dict[int, float] = {}
    depot: int = 1

    i = 0
    while i < len(lines):
        line = lines[i]
        if not line:
            i += 1
            continue

        # Key-value specifications (KEY : value)
        if ":" in line and not line.startswith("NODE_COORD") and not line.startswith("DEMAND_") and not line.startswith("DEPOT_"):
            key, _, value = line.partition(":")
            key = key.strip().upper()
            value = value.strip()
            if key == "DIMENSION":
                dimension = int(value)
            elif key == "CAPACITY":
                capacity = int(value)
            i += 1
            continue

        if line.startswith("NODE_COORD_SECTION"):
            i += 1
            while i < len(lines):
                line = lines[i]
                if not line:
                    i += 1
                    continue
                if line.startswith("DEMAND_SECTION") or line.startswith("DEPOT_SECTION") or line.upper() == "EOF":
                    break
                parts = line.split()
                if len(parts) >= 3:
                    try:
                        idx = int(parts[0])
                        x, y = float(parts[1]), float(parts[2])
                        coords[idx] = (x, y)
                    except ValueError:
                        pass
                i += 1
            continue

        if line.startswith("DEMAND_SECTION"):
            i += 1
            while i < len(lines):
                line = lines[i]
                if not line:
                    i += 1
                    continue
                if line.startswith("DEPOT_SECTION") or line.startswith("NODE_COORD") or line.upper() == "EOF":
                    break
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        idx = int(parts[0])
                        d = float(parts[1])
                        demands[idx] = d
                    except ValueError:
                        pass
                i += 1
            continue

        if line.startswith("DEPOT_SECTION"):
            i += 1
            depots: List[int] = []
            while i < len(lines):
                line = lines[i]
                if not line:
                    i += 1
                    continue
                if line.upper() == "EOF":
                    i += 1
                    break
                parts = line.split()
                for p in parts:
                    try:
                        v = int(p)
                        if v == -1:
                            break
                        depots.append(v)
                    except ValueError:
                        pass
                if any(int(x) == -1 for x in parts if x.lstrip("-").isdigit()):
                    break
                i += 1
            if depots:
                depot = depots[0]
            continue

        i += 1

    if dimension is None:
        raise ValueError(f"Missing DIMENSION in {filepath}")
    if capacity is None:
        raise ValueError(f"Missing CAPACITY in {filepath}")
    if len(coords) < dimension:
        raise ValueError(f"Expected {dimension} coordinates in NODE_COORD_SECTION, got {len(coords)} in {filepath}")
    if len(demands) < dimension:
        raise ValueError(f"Expected {dimension} demands in DEMAND_SECTION, got {len(demands)} in {filepath}")

    return VRPProblem(
        dimension=dimension,
        capacity=capacity,
        coords=coords,
        demands=demands,
        depot=depot,
        name=os.path.splitext(os.path.basename(filepath))[0],
    )


def parse_sol(filepath: str) -> Optional[float]:
    """
    Parse a standard .sol file and return the optimal cost (float).
    Looks for a line starting with 'Cost ' (case-insensitive). Returns None if not found.
    """
    if not os.path.isfile(filepath):
        return None
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line.upper().startswith("COST "):
                try:
                    return float(line[5:].strip())
                except ValueError:
                    pass
    return None


# ---------------------------------------------------------------------------
# 2. Distance helpers
# ---------------------------------------------------------------------------
#
# CVRPLIB EUC_2D: each edge distance must be rounded to the nearest integer
# *before* summing. Using raw floats can yield a total slightly below the
# proven optimal and produce a false "better than optimal" (negative) gap.
# We use route_distance (float) only for 2-Opt comparisons; all *reported*
# costs and gap calculations use route_distance_euc2d (integer sum).


def euclidean(a: int, b: int, coords: Dict[int, Tuple[float, float]]) -> float:
    """Euclidean distance between nodes a and b (float)."""
    x1, y1 = coords[a]
    x2, y2 = coords[b]
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def route_distance(
    route: List[int],
    coords: Dict[int, Tuple[float, float]],
    depot: int,
) -> float:
    """
    Total Euclidean distance for a single route (float).
    depot -> route[0] -> ... -> route[-1] -> depot.
    Used internally for 2-Opt comparisons.
    """
    if not route:
        return 0.0
    total = euclidean(depot, route[0], coords)
    for k in range(len(route) - 1):
        total += euclidean(route[k], route[k + 1], coords)
    total += euclidean(route[-1], depot, coords)
    return total


def route_distance_euc2d(
    route: List[int],
    coords: Dict[int, Tuple[float, float]],
    depot: int,
) -> int:
    """
    CVRPLIB EUC_2D compliant cost: round each edge to nearest integer, then sum.
    Use this for all reported costs and gap calculations so results are
    comparable to proven optimal values in .sol files.
    """
    if not route:
        return 0
    total = 0
    total += round(euclidean(depot, route[0], coords))
    for k in range(len(route) - 1):
        total += round(euclidean(route[k], route[k + 1], coords))
    total += round(euclidean(route[-1], depot, coords))
    return int(total)


# ---------------------------------------------------------------------------
# 3. Clarke-Wright Savings
# ---------------------------------------------------------------------------


def _capacity_for_route(route_idx: int, routes: List[List[int]], vehicle_capacities: List[int], demands: Dict[int, float]) -> float:
    """Smallest vehicle capacity that can serve this route's demand; or max if none fits."""
    total = sum(demands.get(n, 0) for n in routes[route_idx])
    for cap in sorted(vehicle_capacities):
        if cap >= total:
            return float(cap)
    return float(max(vehicle_capacities))


def clarke_wright_savings(problem: VRPProblem) -> List[List[int]]:
    """
    Generate an initial feasible set of routes using the Clarke-Wright Savings algorithm.
    Supports heterogeneous vehicle capacities and must_share_route (force pairs on same route).
    Returns a list of routes; each route is a list of customer node IDs (depot implicit).
    """
    coords = problem.coords
    demands = problem.demands
    depot = problem.depot
    vehicle_caps = problem.vehicle_capacities
    if vehicle_caps:
        capacity = max(vehicle_caps)
        caps_sorted = sorted(vehicle_caps, reverse=True)
    else:
        capacity = problem.capacity
        caps_sorted = [capacity]

    customers = [n for n in coords if n != depot]
    if not customers:
        return []

    def dist(a: int, b: int) -> float:
        return euclidean(a, b, coords)

    routes: List[List[int]] = [[c] for c in customers]
    route_for: Dict[int, int] = {c: i for i, c in enumerate(customers)}

    # Force must_share_route pairs onto the same route (route overlap stress test).
    if getattr(problem, "must_share_route", None):
        for (a, b) in problem.must_share_route:
            if a not in route_for or b not in route_for:
                continue
            ra, rb = route_for[a], route_for[b]
            if ra == rb:
                continue
            # Merge route containing b into route containing a (arbitrary order).
            combined = routes[ra] + routes[rb]
            routes[ra] = combined
            for n in routes[rb]:
                route_for[n] = ra
            routes[rb] = []

    def demand_of_route(route_idx: int) -> float:
        return sum(demands.get(n, 0) for n in routes[route_idx])

    def capacity_limit(route_idx: int) -> float:
        if vehicle_caps:
            return _capacity_for_route(route_idx, routes, vehicle_caps, demands)
        return float(capacity)

    def try_merge(ri: int, rj: int, i: int, j: int) -> bool:
        if ri == rj:
            return False
        if not routes[ri] or not routes[rj]:
            return False
        combined_demand = demand_of_route(ri) + demand_of_route(rj)
        if vehicle_caps:
            if combined_demand > max(vehicle_caps):
                return False
        else:
            if combined_demand > capacity:
                return False
        ai = routes[ri]
        aj = routes[rj]
        if ai[-1] == i and aj[0] == j:
            new_route = ai + aj
        elif ai[-1] == i and aj[-1] == j:
            new_route = ai + aj[::-1]
        elif ai[0] == i and aj[0] == j:
            new_route = ai[::-1] + aj
        elif ai[0] == i and aj[-1] == j:
            new_route = aj + ai
        else:
            return False
        routes[ri] = new_route
        for n in routes[rj]:
            route_for[n] = ri
        routes[rj] = []
        for n in new_route:
            route_for[n] = ri
        return True

    savings_list: List[Tuple[float, int, int]] = []
    for i in customers:
        for j in customers:
            if i >= j:
                continue
            s = dist(depot, i) + dist(depot, j) - dist(i, j)
            savings_list.append((s, i, j))
    savings_list.sort(key=lambda x: -x[0])

    for _s, i, j in savings_list:
        ri = route_for.get(i)
        rj = route_for.get(j)
        if ri is None or rj is None:
            continue
        if routes[ri] and routes[rj]:
            try_merge(ri, rj, i, j)

    return [r for r in routes if r]


# ---------------------------------------------------------------------------
# 4. 2-Opt local search
# ---------------------------------------------------------------------------


def two_opt(
    routes: List[List[int]],
    coords: Dict[int, Tuple[float, float]],
    depot: int,
) -> List[List[int]]:
    """
    Improve each route using 2-Opt: try reversing segment [i:j+1]; accept if total distance improves.
    Repeats until no improvement on that route.
    """
    result: List[List[int]] = []
    for route in routes:
        result.append(_two_opt_one(route, coords, depot))
    return result


def _two_opt_one(
    route: List[int],
    coords: Dict[int, Tuple[float, float]],
    depot: int,
) -> List[int]:
    if len(route) <= 2:
        return list(route)
    current = list(route)
    current_dist = route_distance(current, coords, depot)
    improved = True
    while improved:
        improved = False
        for i in range(len(current)):
            for j in range(i + 1, len(current)):
                candidate = current[:i] + current[i : j + 1][::-1] + current[j + 1 :]
                d = route_distance(candidate, coords, depot)
                if d < current_dist:
                    current = candidate
                    current_dist = d
                    improved = True
                    break
            if improved:
                break
    return current


# ---------------------------------------------------------------------------
# 4b. Solution validation (catches invalid solutions that can cause negative gaps)
# ---------------------------------------------------------------------------
#
# If a solver reports a cost *below* the proven optimal (negative gap), the
# solution is almost certainly invalid. Common causes: capacity violations
# (e.g. overloaded route after a move), dropped nodes (customer skipped),
# or distance rounding mismatch (we fix the latter by using route_distance_euc2d).


def validate_solution(
    problem: VRPProblem,
    routes: List[List[int]],
) -> Tuple[bool, str]:
    """
    Check that a solution is valid: every non-depot node served exactly once,
    and each route respects capacity. Returns (valid, message).
    """
    depot = problem.depot
    capacity = problem.capacity
    demands = problem.demands
    expected = {n for n in problem.coords if n != depot}
    served: List[int] = []
    for route in routes:
        route_demand = 0.0
        for n in route:
            served.append(n)
            route_demand += demands.get(n, 0)
        if route_demand > capacity:
            return False, f"Capacity violation: route demand {route_demand} > {capacity}"
    served_set = set(served)
    if served_set != expected:
        missing = expected - served_set
        extra = served_set - expected
        if missing:
            return False, f"Dropped nodes: {missing}"
        if extra:
            return False, f"Duplicate or invalid nodes: {extra}"
    return True, ""


# ---------------------------------------------------------------------------
# 5. Benchmark loop and reporting
# ---------------------------------------------------------------------------


def discover_vrp_sol_pairs(data_dir: str, require_sol: bool = False):
    """
    Recursively find all .vrp files under data_dir. For each, look for matching .sol (same basename).
    Yields (vrp_path, sol_path or None). If require_sol is True, only yield pairs that have .sol.
    """
    data_dir = os.path.abspath(data_dir)
    if not os.path.isdir(data_dir):
        return
    for root, _dirs, files in os.walk(data_dir):
        for f in files:
            if not f.lower().endswith(".vrp"):
                continue
            vrp_path = os.path.join(root, f)
            base = f[:-4]
            sol_path = os.path.join(root, base + ".sol")
            if not os.path.isfile(sol_path):
                sol_path = None
            if require_sol and sol_path is None:
                continue
            yield vrp_path, sol_path


def run_benchmark(
    data_dir: str,
    require_sol: bool = False,
    max_dimension: Optional[int] = None,
    export_gpx: bool = False,
    gpx_dir: str = "gpx_exports",
) -> pd.DataFrame:
    """
    Run benchmark on all .vrp (and optional .sol) pairs under data_dir.
    Returns a DataFrame with columns: Instance Name, Dimension, Optimal Cost, CW Cost, CW Gap %,
    CW Time, 2-Opt Cost, 2-Opt Gap %, Routes Count, Total Time.
    
    Args:
        data_dir: Directory containing .vrp files
        require_sol: If True, only process instances with .sol files
        max_dimension: If specified, skip instances with more nodes than this
        export_gpx: If True and GPX_EXPORT_AVAILABLE, export solutions to GPX files
        gpx_dir: Directory for GPX exports
    """
    rows: List[Dict] = []
    for vrp_path, sol_path in discover_vrp_sol_pairs(data_dir, require_sol=require_sol):
        instance_name = os.path.splitext(os.path.basename(vrp_path))[0]
        row = {
            "Instance Name": instance_name,
            "Dimension": None,
            "Optimal Cost": None,
            "CW Cost": None,
            "CW Gap %": None,
            "CW Time": None,
            "2-Opt Cost": None,
            "2-Opt Gap %": None,
            "Routes Count": None,
            "Total Time": None,
        }
        try:
            problem = parse_vrp(vrp_path)
            if max_dimension is not None and problem.dimension > max_dimension:
                continue
            optimal_cost = parse_sol(sol_path) if sol_path else None
            row["Optimal Cost"] = optimal_cost

            t0 = time.perf_counter()
            routes_cw = clarke_wright_savings(problem)
            t_cw = time.perf_counter() - t0
            # Report costs using EUC_2D (round each edge to nearest int then sum)
            cost_cw = sum(
                route_distance_euc2d(r, problem.coords, problem.depot) for r in routes_cw
            )
            row["CW Cost"] = cost_cw
            row["CW Time"] = t_cw

            t1 = time.perf_counter()
            routes_2opt = two_opt(routes_cw, problem.coords, problem.depot)
            t_2opt = time.perf_counter() - t1
            cost_2opt = sum(
                route_distance_euc2d(r, problem.coords, problem.depot) for r in routes_2opt
            )
            row["2-Opt Cost"] = cost_2opt
            row["2-Opt Gap %"] = None
            row["Routes Count"] = len(routes_2opt)
            row["Total Time"] = t_cw + t_2opt
            row["Dimension"] = problem.dimension

            if optimal_cost is not None and optimal_cost > 0:
                row["CW Gap %"] = 100.0 * (cost_cw - optimal_cost) / optimal_cost
                row["2-Opt Gap %"] = 100.0 * (cost_2opt - optimal_cost) / optimal_cost

            # Negative gap means "better than optimal" — proven optimal is correct, so solution is invalid
            for label, cost, gap in [
                ("CW", cost_cw, row["CW Gap %"]),
                ("2-Opt", cost_2opt, row["2-Opt Gap %"]),
            ]:
                if gap is not None and gap < 0:
                    valid, msg = validate_solution(
                        problem, routes_cw if label == "CW" else routes_2opt
                    )
                    print(
                        f"  [WARN] {instance_name} {label} reports gap {gap:.2f}% (cost {cost} < optimal {optimal_cost}). "
                        "Proven optimal is correct; this usually indicates an invalid solution.",
                        file=sys.stderr,
                    )
                    if not valid:
                        print(f"         Validation: {msg}", file=sys.stderr)
                    else:
                        print(
                            "         Validation passed (check distance rounding / implementation).",
                            file=sys.stderr,
                        )
            # Export to GPX if requested
            if export_gpx and GPX_EXPORT_AVAILABLE:
                try:
                    # Export CW solution
                    cw_gpx = export_solution_to_gpx(problem, routes_cw, instance_name, "CW")
                    if cw_gpx:
                        cw_filename = os.path.join(gpx_dir, f"{instance_name}_cw.gpx")
                        with open(cw_filename, "w") as f:
                            f.write(cw_gpx)
                        print(f"  Exported CW solution to: {cw_filename}")
                    
                    # Export 2-Opt solution
                    opt_gpx = export_solution_to_gpx(problem, routes_2opt, instance_name, "2-Opt")
                    if opt_gpx:
                        opt_filename = os.path.join(gpx_dir, f"{instance_name}_2opt.gpx")
                        with open(opt_filename, "w") as f:
                            f.write(opt_gpx)
                        print(f"  Exported 2-Opt solution to: {opt_filename}")
                except Exception as e:
                    print(f"  Warning: Failed to export {instance_name} to GPX: {e}", file=sys.stderr)
        
        except Exception as e:
            print(f"Error on {instance_name}: {e}", file=sys.stderr)
            for k in ["CW Cost", "CW Gap %", "CW Time", "2-Opt Cost", "2-Opt Gap %", "Total Time"]:
                if row[k] is None:
                    row[k] = float("nan")
        rows.append(row)

    df = pd.DataFrame(rows)
    return df

def cvrp_solution_to_gpx_segments(
    problem: VRPProblem,
    routes: List[List[int]],
) -> List[RouteSegment]:
    """
    Convert CVRP solution to RouteSegment list for GPX export.
    
    Args:
        problem: VRPProblem containing coordinates and depot information
        routes: List of routes, each route is a list of node IDs
        
    Returns:
        List of RouteSegment objects for GPX export
    """
    if not GPX_EXPORT_AVAILABLE:
        return []
        
    segments: List[RouteSegment] = []
    
    for i, route in enumerate(routes):
        if not route:
            continue
            
        # Create waypoints for each customer
        waypoints = []
        
        # Add depot as start waypoint
        depot_lat, depot_lon = problem.coords[problem.depot]
        waypoints.append(Waypoint(depot_lat, depot_lon, name="Depot Start"))
        
        # Add customer waypoints
        for node_id in route:
            lat, lon = problem.coords[node_id]
            waypoints.append(Waypoint(lat, lon, name=f"Customer {node_id}"))
            
        # Add depot as end waypoint
        waypoints.append(Waypoint(depot_lat, depot_lon, name="Depot End"))
        
        # Create track points (full route including start and end at depot)
        track = []
        
        # Start at depot
        track.append((depot_lat, depot_lon))
        
        # Add customer locations
        for node_id in route:
            lat, lon = problem.coords[node_id]
            track.append((lat, lon))
            
        # Return to depot
        track.append((depot_lat, depot_lon))
        
        # Create route name
        name = f"Vehicle {i+1}"
        segments.append(
            RouteSegment(
                track=track,
                waypoints=waypoints,
                name=name
            )
        )
    
    return segments

    df = pd.DataFrame(rows)
    return df


def export_solution_to_gpx(
    problem: VRPProblem,
    routes: List[List[int]],
    instance_name: str,
    solution_type: str,
) -> Optional[str]:
    """
    Export a CVRP solution to GPX format.
    
    Args:
        problem: VRPProblem containing coordinates and depot information
        routes: List of routes, each route is a list of node IDs
        instance_name: Name of the problem instance
        solution_type: Type of solution (e.g., "CW", "2-Opt")
        
    Returns:
        GPX XML string or None if export failed
    """
    if not GPX_EXPORT_AVAILABLE:
        return None
        
    try:
        segments = cvrp_solution_to_gpx_segments(problem, routes)
        if not segments:
            return None
            
        gpx_str = build_gpx(
            segments,
            creator=f"VRP Benchmark Script",
            waypoints_only_from_tracks=False
        )
        return gpx_str
    except Exception as e:
        print(f"Warning: Failed to export {instance_name} {solution_type} solution to GPX: {e}", file=sys.stderr)
        return None

def main() -> None:
    import argparse
    
    parser = argparse.ArgumentParser(description="VRP Benchmark Script: Clarke-Wright Savings + 2-Opt vs. optimal (.sol) baseline")
    parser.add_argument("data_dir", nargs="?", default="data", help="Directory containing .vrp files (default: data)")
    parser.add_argument("--gpx", action="store_true", help="Export solutions to GPX files")
    parser.add_argument("--gpx-dir", default="gpx_exports", help="Directory for GPX exports (default: gpx_exports)")
    
    args = parser.parse_args()
    
    data_dir = args.data_dir
    export_gpx = args.gpx
    gpx_dir = args.gpx_dir
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isdir(data_dir):
        data_dir = os.path.join(script_dir, data_dir)
    if not os.path.isdir(data_dir):
        print(f"Directory not found: {data_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Running benchmark on: {os.path.abspath(data_dir)}\n")
    
    # Create GPX directory if needed
    if export_gpx and GPX_EXPORT_AVAILABLE:
        if not os.path.exists(gpx_dir):
            os.makedirs(gpx_dir)
        print(f"\nExporting solutions to GPX files in: {gpx_dir}")
    
    df = run_benchmark(data_dir, require_sol=False, export_gpx=export_gpx, gpx_dir=gpx_dir)

    if df.empty:
        print("No instances processed.")
        return

    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", None)
    pd.set_option("display.float_format", lambda x: f"{x:.4g}" if pd.notna(x) else "N/A")
    print("Results:")
    print(df.to_string(index=False))

    # Export individual solutions to GPX if requested
    if export_gpx and GPX_EXPORT_AVAILABLE:
        print("\nGPX export completed. Files saved to:", gpx_dir)

    with_sol = df["Optimal Cost"].notna()
    if with_sol.any():
        print("\nSummary (instances with optimal):")
        print(f"  Count: {with_sol.sum()}")
        print(f"  Avg CW Gap %:    {df.loc[with_sol, 'CW Gap %'].mean():.2f}%")
        print(f"  Avg 2-Opt Gap %: {df.loc[with_sol, '2-Opt Gap %'].mean():.2f}%")
    print(f"  Avg CW Time:    {df['CW Time'].mean():.4f}s")
    print(f"  Avg Total Time: {df['Total Time'].mean():.4f}s")

    out_path = os.path.join(script_dir, "benchmark_results.csv")
    df.to_csv(out_path, index=False)
    print(f"\nExported to: {out_path}")

    # Export sample solutions to GPX if GPX export is available
    if GPX_EXPORT_AVAILABLE:
        print("\nGPX export functionality is available. Use --gpx flag to export solutions to GPX files.")


if __name__ == "__main__":
    main()
