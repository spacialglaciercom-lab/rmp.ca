#!/usr/bin/env python3
"""
CLI tool for Route Optimization Comparison.
Demonstrates the power of structured CLI tools for rapid testing and enhancing algorithms.

Usage:
    python3 compare_routes.py compare path/to/file.geojson
"""
import argparse
import sys
import json
from pathlib import Path

# Add backend directory to sys.path so we can import 'app'
backend_dir = Path(__file__).resolve().parent
sys.path.append(str(backend_dir))

from app.optimize import optimize_route, OptimizeRequest, TurnPenalties
from app.geojson_ops import GeoJSONFeatureCollection

def load_geojson(path: str) -> GeoJSONFeatureCollection:
    with open(path, "r") as f:
        data = json.load(f)
    return GeoJSONFeatureCollection(**data)

def format_cell(val, width=15):
    """Simple cell formatting for table."""
    s = str(val)
    if isinstance(val, float):
        s = f"{val:.2f}"
    return s.ljust(width)

def run_comparison(file_path: str):
    print(f"Loading '{file_path}'...")
    try:
        geojson = load_geojson(file_path)
    except Exception as e:
        print(f"Error loading GeoJSON: {e}")
        return

    # Define scenarios
    scenarios = [
        {
            "name": "Baseline (None)",
            "penalties": None
        },
        {
            "name": "Strict (High Penalty)",
            "penalties": TurnPenalties(left_turn=50.0, u_turn=100.0, right_turn=10.0)
        }
    ]
    
    results = []

    print("\nRunning Optimization Scenarios...\n")
    
    for scenario in scenarios:
        req = OptimizeRequest(
            geojson=geojson,
            turn_penalties=scenario["penalties"],
            clean_before_optimize=True
        )
        
        try:
            # Direct python function call - no HTTP overhead!
            # Great for debugging logic without spinning up Uvicorn.
            res = optimize_route(req)
            stats = res.stats
            results.append({
                "scenario": scenario["name"],
                "dist": stats.total_distance_km,
                "deadhead": stats.deadhead_distance_km,
                "L-turns": stats.left_turns,
                "R-turns": stats.right_turns,
                "U-turns": stats.u_turns,
                "efficiency": stats.efficiency
            })
        except Exception as e:
            print(f"Scenario '{scenario['name']}' failed: {e}")

    # Print Summary Table
    headers = ["Scenario", "Dist (km)", "Deadhead", "L-Turns", "R-Turns", "U-Turns", "Efficiency"]
    widths = [20, 12, 12, 10, 10, 10, 12]
    
    # Header
    row_fmt = "".join(f"{{:<{w}}}" for w in widths)
    print(row_fmt.format(*headers))
    print("-" * sum(widths))
    
    # Rows
    for r in results:
        print(row_fmt.format(
            r["scenario"],
            f"{r['dist']:.3f}",
            f"{r['deadhead']:.3f}",
            r["L-turns"],
            r["R-turns"],
            r["U-turns"],
            f"{r['efficiency']:.2%}"
        ))
    print("\nComparison Complete.\n")

def main():
    parser = argparse.ArgumentParser(description="Route Optimization CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    compare_parser = subparsers.add_parser("compare", help="Compare optimization settings on a file")
    compare_parser.add_argument("file", help="Path to GeoJSON file")

    gen_parser = subparsers.add_parser("generate", help="Generate a test grid GeoJSON")
    
    args = parser.parse_args()
    
    if args.command == "compare":
        run_comparison(args.file)
    elif args.command == "generate":
        # Create a synthetic grid for testing
        print("Generating test grid 'test_grid.geojson'...")
        features = []
        # 3x3 Grid of 1km segments
        # Horizontals
        for y in range(3):
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString", 
                    "coordinates": [[0.0, y * 0.01], [0.03, y * 0.01]]
                },
                "properties": {"highway": "residential", "name": f"H-St-{y}"}
            })
        # Verticals
        for x in range(4): # 0, 0.01, 0.02, 0.03
             features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString", 
                    "coordinates": [[x * 0.01, -0.01], [x * 0.01, 0.03]]
                },
                "properties": {"highway": "residential", "name": f"V-Ave-{x}"}
            })
            
        fc = {"type": "FeatureCollection", "features": features}
        with open("test_grid.geojson", "w") as f:
            json.dump(fc, f, indent=2)
        print("Done. Run: python3 compare_routes.py compare test_grid.geojson")
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
