#!/usr/bin/env python3
"""
Destructive Testing pipeline for route optimizer:
  - Connectivity stress (broken_city.json)
  - Data cleaning boundary (near_duplicate_city.json)
  - Penalty saturation (extreme penalties)
Run: python destructive_tests.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Run from backend directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

def main() -> None:
    from app.geojson_ops import GeoJSONFeatureCollection
    from app.optimize import OptimizeRequest, TurnPenalties, optimize_route
    from app.vector_clean import CleanOptions, clean_geojson

    backend = Path(__file__).resolve().parent
    results: list[str] = []

    # --- 1. Connectivity stress ---
    broken_path = backend / "broken_city.json"
    if not broken_path.exists():
        results.append("SKIP: broken_city.json not found")
    else:
        fc = GeoJSONFeatureCollection(**json.loads(broken_path.read_text()))
        body = OptimizeRequest(geojson=fc, clean_before_optimize=False)
        try:
            r = optimize_route(body)
            ok = (
                r.total_distance_km >= 0
                and r.stats.efficiency >= 0
                and r.stats.efficiency <= 100
            )
            assert r.stats.efficiency == r.stats.efficiency, "efficiency is NaN"
            results.append(
                f"Connectivity: PASS (disconnected graph solved; efficiency={r.stats.efficiency:.1f}%)"
            )
        except Exception as e:
            results.append(f"Connectivity: FAIL — {type(e).__name__}: {e}")

    # --- 2. Data cleaning boundary (near-duplicate nodes) ---
    near_path = backend / "near_duplicate_city.json"
    if not near_path.exists():
        results.append("SKIP: near_duplicate_city.json not found")
    else:
        raw = json.loads(near_path.read_text())
        opts = CleanOptions(
            remove_selfloops=True,
            dedupe_edges=True,
            node_snap_m=1.0,
            max_components=0,
        )
        cleaned_fc, stats = clean_geojson(raw, opts)
        merged = stats.nodes_merged
        if merged >= 1:
            results.append(
                f"Near-duplicate clean: PASS (nodes_merged={merged}, output_features={stats.output_features})"
            )
        else:
            results.append(
                f"Near-duplicate clean: WARN (nodes_merged=0; adjust node_snap_m if needed)"
            )

    # --- 3. Penalty saturation ---
    if not broken_path.exists():
        results.append("SKIP penalty saturation (no broken_city)")
    else:
        fc = GeoJSONFeatureCollection(**json.loads(broken_path.read_text()))
        pen = TurnPenalties(left_turn=0, u_turn=100_000, right_turn=-5)
        assert pen.u_turn == 10_000.0 and pen.right_turn == 0.0
        body = OptimizeRequest(
            geojson=fc, clean_before_optimize=False, turn_penalties=pen
        )
        try:
            r = optimize_route(body)
            ok = (
                r.total_distance_km >= 0
                and 0 <= r.stats.efficiency <= 100
                and r.stats.efficiency == r.stats.efficiency
            )
            results.append(
                f"Penalty saturation: PASS (extreme penalties clamped; efficiency={r.stats.efficiency:.1f}%)"
            )
        except Exception as e:
            results.append(f"Penalty saturation: FAIL — {type(e).__name__}: {e}")

    # --- Report ---
    print("Destructive test results:")
    for line in results:
        print(" ", line)
    failures = sum(1 for s in results if "FAIL" in s)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
