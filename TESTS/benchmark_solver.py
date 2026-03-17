#!/usr/bin/env python3
"""
Scale & Speed benchmark for the CPP solver.
Measures: GeoJSON parsing, graph construction, CPP solving, route serialization.
Runs concurrency test and produces a final report.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

REQUESTS_AVAILABLE = False
try:
    import requests  # noqa: F401
    REQUESTS_AVAILABLE = True
except ImportError:
    pass

# Run from backend directory so app is importable
BACKEND = Path(__file__).resolve().parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _get_features_from_body(body):
    """Replicate optimize_route filtering (no clean) to get features list."""
    from app.optimize import (
        DEFAULT_ROAD_CLASSES,
        NON_VEHICLE_CLASSES,
        _get_road_class,
    )
    features = body.geojson.features
    allowed = set(body.road_classes) if body.road_classes else set(DEFAULT_ROAD_CLASSES)
    features = [
        f for f in features
        if _get_road_class(f) in allowed and _get_road_class(f) not in NON_VEHICLE_CLASSES
    ]
    features = [
        f for f in features
        if f.geometry.get("type") in ("LineString", "MultiLineString")
    ]
    return features


def run_phase_timings(path: Path) -> dict:
    """Time parse, filter, graph build, CPP solve; then full run to infer serialization."""
    from app.geojson_ops import GeoJSONFeatureCollection
    from app.optimize import (
        OptimizeRequest,
        _build_graph,
        _solve_cpp,
        optimize_route,
    )

    raw = json.loads(path.read_text())
    n_features = len(raw.get("features", []))

    # Phase 1: GeoJSON parsing (load + Pydantic)
    t0 = time.perf_counter()
    fc = GeoJSONFeatureCollection(**raw)
    body = OptimizeRequest(geojson=fc, clean_before_optimize=False)
    parse_time = time.perf_counter() - t0

    # Phase 2: Filter (road class + geometry type)
    t0 = time.perf_counter()
    features = _get_features_from_body(body)
    filter_time = time.perf_counter() - t0

    # Phase 3: Graph construction
    t0 = time.perf_counter()
    G = _build_graph(features, "ignore")
    graph_time = time.perf_counter() - t0

    # Phase 4: CPP solving
    t0 = time.perf_counter()
    route_nodes = _solve_cpp(G, turn_penalties=None)
    solve_time = time.perf_counter() - t0

    # Full pipeline (filter + graph + solve + serialization)
    t0 = time.perf_counter()
    optimize_route(body)
    full_time = time.perf_counter() - t0

    serialization_time = full_time - (filter_time + graph_time + solve_time)
    serialization_time = max(0.0, serialization_time)

    return {
        "segments": n_features,
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "parse_s": parse_time,
        "filter_s": filter_time,
        "graph_s": graph_time,
        "solve_s": solve_time,
        "serialization_s": serialization_time,
        "total_s": full_time,
    }


def run_benchmarks(datasets: list[tuple[str, Path]]) -> list[dict]:
    results = []
    for name, path in datasets:
        if not path.exists():
            print(f"Skip {name}: {path} not found")
            continue
        print(f"Benchmarking {name} ({path.name})...")
        try:
            r = run_phase_timings(path)
            r["name"] = name
            results.append(r)
        except Exception as e:
            print(f"  Error: {e}")
            results.append({
                "name": name,
                "segments": 0,
                "error": str(e),
                "parse_s": 0, "filter_s": 0, "graph_s": 0, "solve_s": 0,
                "serialization_s": 0, "total_s": 0,
            })
    return results


def print_table(results: list[dict]) -> None:
    """Print runtime scaling table."""
    if not results:
        return
    headers = ["Dataset", "Segments", "Parse (s)", "Graph (s)", "CPP Solve (s)", "Serialize (s)", "Total (s)"]
    col_widths = [10, 10, 10, 10, 12, 12, 10]
    header_fmt = "  ".join(f"{{:{w}}}" for w in col_widths)
    row_fmt = "  ".join(
        f"{{:{w}}}" if i < 2 else f"{{:{w}.4f}}"
        for i, (_, w) in enumerate(zip(headers, col_widths))
    )
    print("\n" + "=" * 80)
    print("RUNTIME SCALING (Scale & Speed Benchmark)")
    print("=" * 80)
    print(header_fmt.format(*headers))
    print("-" * 80)
    for r in results:
        if "error" in r:
            print(r["name"], r["error"])
            continue
        print(row_fmt.format(
            r["name"],
            r["segments"],
            r["parse_s"],
            r["graph_s"],
            r["solve_s"],
            r["serialization_s"],
            r["total_s"],
        ))
    print("=" * 80)


def concurrency_check(medium_path: Path, n_concurrent: int = 5) -> dict:
    """Simulate 5 concurrent HTTP requests to the solver (requires server + requests)."""
    if not REQUESTS_AVAILABLE:
        return {"ok": False, "error": "requests not installed (pip install requests)"}

    import requests
    base_url = "http://localhost:8000"
    health_url = f"{base_url}/health"
    optimize_url = f"{base_url}/api/optimize"

    try:
        r = requests.get(health_url, timeout=2)
        if r.status_code != 200:
            return {"ok": False, "error": f"Health check failed: {r.status_code}"}
    except requests.RequestException as e:
        return {"ok": False, "error": f"Server not reachable: {e}"}

    payload = json.loads(medium_path.read_text())
    body = {"geojson": payload, "clean_before_optimize": False}

    times: list[float] = []
    errors: list[str] = []

    def one_request() -> tuple[float | None, str | None]:
        t0 = time.perf_counter()
        try:
            resp = requests.post(optimize_url, json=body, timeout=60)
            elapsed = time.perf_counter() - t0
            if resp.status_code != 200:
                return elapsed, f"HTTP {resp.status_code}"
            return elapsed, None
        except Exception as e:
            return time.perf_counter() - t0, str(e)

    print(f"\nHTTP concurrency: {n_concurrent} requests (medium_city.json)...")
    with ThreadPoolExecutor(max_workers=n_concurrent) as ex:
        futures = [ex.submit(one_request) for _ in range(n_concurrent)]
        for f in as_completed(futures):
            elapsed, err = f.result()
            if err:
                errors.append(err)
            else:
                times.append(elapsed)

    return {
        "ok": len(errors) == 0,
        "n_requests": n_concurrent,
        "success_count": len(times),
        "error_count": len(errors),
        "errors": errors[:5],
        "times_s": times,
        "total_wall_s": max(times) if times else 0,
        "avg_s": sum(times) / len(times) if times else 0,
    }


def concurrency_check_inprocess(medium_path: Path, n_concurrent: int = 5) -> dict:
    """Simulate 5 concurrent in-process solver calls (no HTTP). Tests thread behavior."""
    from app.geojson_ops import GeoJSONFeatureCollection
    from app.optimize import OptimizeRequest, optimize_route

    raw = json.loads(medium_path.read_text())
    fc = GeoJSONFeatureCollection(**raw)
    body = OptimizeRequest(geojson=fc, clean_before_optimize=False)

    times: list[float] = []
    errors: list[str] = []

    def one_run() -> tuple[float | None, str | None]:
        t0 = time.perf_counter()
        try:
            optimize_route(body)
            return time.perf_counter() - t0, None
        except Exception as e:
            return time.perf_counter() - t0, str(e)

    with ThreadPoolExecutor(max_workers=n_concurrent) as ex:
        futures = [ex.submit(one_run) for _ in range(n_concurrent)]
        for f in as_completed(futures):
            elapsed, err = f.result()
            if err:
                errors.append(err)
            else:
                times.append(elapsed)

    return {
        "ok": len(errors) == 0,
        "n_requests": n_concurrent,
        "success_count": len(times),
        "error_count": len(errors),
        "errors": errors[:5],
        "times_s": times,
        "total_wall_s": max(times) if times else 0,
        "avg_s": sum(times) / len(times) if times else 0,
        "inprocess": True,
    }


def main() -> None:
    out_dir = BACKEND
    datasets = [
        ("small", out_dir / "small_city.json"),
        ("medium", out_dir / "medium_city.json"),
        ("large", out_dir / "large_city.json"),
    ]

    for _, p in datasets:
        if not p.exists():
            print(f"Missing {p}. Run: python generate_scale_datasets.py")
            return

    results = run_benchmarks(datasets)
    print_table(results)

    large_result = next((r for r in results if r.get("name") == "large" and "error" not in r), None)
    bottleneck_notes = []
    if large_result and large_result.get("total_s", 0) > 5.0:
        bottleneck_notes.append("large_city total time > 5s: analyze bottlenecks (see report).")
    if large_result:
        phases = [
            ("Graph construction", large_result["graph_s"]),
            ("CPP solving (matching + Eulerian)", large_result["solve_s"]),
            ("GeoJSON parsing", large_result["parse_s"]),
            ("Route serialization", large_result["serialization_s"]),
        ]
        phases.sort(key=lambda x: -x[1])
        bottleneck_notes.append("Phase order by time: " + ", ".join(f"{n}({t:.3f}s)" for n, t in phases))

    medium_path = out_dir / "medium_city.json"
    concurrency_result = concurrency_check_inprocess(medium_path, n_concurrent=5)
    print(f"\nConcurrency (in-process, 5 concurrent): {concurrency_result['success_count']}/{concurrency_result['n_requests']} succeeded.")
    print(f"  Wall time (max): {concurrency_result['total_wall_s']:.3f}s  Avg per run: {concurrency_result['avg_s']:.3f}s")
    if not concurrency_result.get("ok"):
        print("  Errors:", concurrency_result.get("errors", []))

    http_result = concurrency_check(medium_path, n_concurrent=5)
    if http_result.get("ok"):
        print(f"  HTTP (server): {http_result['success_count']}/{http_result['n_requests']} succeeded, wall {http_result['total_wall_s']:.3f}s")
    else:
        print("  HTTP check skipped:", http_result.get("error", http_result.get("errors", [])))
        print("  To run HTTP concurrency: start API (uvicorn app.main:app), pip install requests, then re-run.")

    report_path = out_dir / "BENCHMARK_REPORT.md"
    max_safe_segments = 0
    under_5 = [r for r in results if "error" not in r and r.get("total_s", 0) <= 5.0]
    if under_5:
        max_safe_segments = max(r["segments"] for r in under_5)
    else:
        valid = [r for r in results if "error" not in r]
        max_safe_segments = max((r["segments"] for r in valid), default=0)

    with open(report_path, "w") as f:
        f.write("# Scale & Speed Benchmark Report\n\n")
        f.write("## 1. Scale datasets\n")
        f.write("- `small_city.json` ~100 segments\n")
        f.write("- `medium_city.json` ~500 segments\n")
        f.write("- `large_city.json` ~1000 segments\n\n")
        f.write("## 2. Runtime scaling table\n")
        f.write("| Dataset | Segments | Parse (s) | Graph (s) | CPP Solve (s) | Serialize (s) | Total (s) |\n")
        f.write("|---------|----------|-----------|-----------|----------------|----------------|----------|\n")
        for r in results:
            if "error" in r:
                f.write(f"| {r['name']} | - | - | - | - | - | error |\n")
                continue
            f.write(f"| {r['name']} | {r['segments']} | {r['parse_s']:.4f} | {r['graph_s']:.4f} | {r['solve_s']:.4f} | {r['serialization_s']:.4f} | {r['total_s']:.4f} |\n")
        f.write("\n## 3. Bottlenecks\n")
        if large_result and large_result.get("total_s", 0) > 5:
            f.write("- **large_city total time exceeds 5s.**\n")
            f.write("- Likely culprits: NetworkX matching (all-pairs Dijkstra + min_weight_matching), ")
            f.write("or graph construction (O(n²) coordinate comparison for split nodes).\n")
            f.write("- **Suggested optimization:** Use spatial indexing (e.g. `scipy.spatial.cKDTree` or R-tree) ")
            f.write("to find segment intersections instead of comparing every coordinate pair; ")
            f.write("or simplify geometry (reduce vertices per segment) before building the graph.\n")
        else:
            f.write("- No dataset exceeded 5s in this run.\n")
        for line in bottleneck_notes:
            f.write(f"- {line}\n")
        f.write("\n## 4. Concurrency\n")
        f.write(f"- In-process: 5 concurrent solver runs (medium_city) — {concurrency_result['success_count']}/5 succeeded; ")
        f.write(f"wall time {concurrency_result['total_wall_s']:.3f}s, avg/run {concurrency_result['avg_s']:.3f}s.\n")
        if http_result.get("ok"):
            f.write(f"- HTTP (API server): 5 concurrent requests — {http_result['success_count']}/5 succeeded; ")
            f.write(f"wall {http_result['total_wall_s']:.3f}s.\n")
        else:
            f.write(f"- HTTP check: {http_result.get('error', http_result.get('errors', 'not run'))}\n")
        f.write("\n## 5. Max safe input size & recommendations\n")
        f.write(f"- **Max safe input size (estimate):** {max_safe_segments} segments (for < 5s total).\n")
        f.write("- **Recommendations:**\n")
        f.write("  - For larger cities: pre-aggregate or partition (e.g. by zone) and run solver per zone.\n")
        f.write("  - Enable `clean_before_optimize` only when input has duplicates/self-loops to avoid extra cost.\n")
        f.write("  - If scaling is non-linear, add spatial indexing in graph construction and consider approximate matching for very large odd-node sets.\n")

    print(f"\nReport written to {report_path}")


if __name__ == "__main__":
    main()
