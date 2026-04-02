#!/usr/bin/env python3
"""Backend CLI: generate, compare, clean, solve-vrp-test, stress-partition."""
from __future__ import annotations
import json
import time
from pathlib import Path
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer()
console = Console()

def _round_key(lon: float, lat: float, decimals: int = 6) -> tuple[float, float]:
    return (round(lon, decimals), round(lat, decimals))


def _grid_geojson(rows=4, cols=4, origin_lon=-73.57, origin_lat=45.50, cell_km=0.05):
    km_per_deg_lon = 111.0 * 0.7
    deg_per_km_lat = 1.0 / 111.0
    deg_per_km_lon = 1.0 / km_per_deg_lon
    dx, dy = cell_km * deg_per_km_lon, cell_km * deg_per_km_lat
    features = []
    for r in range(rows + 1):
        y = origin_lat + r * dy
        for c in range(cols):
            x0, x1 = origin_lon + c * dx, origin_lon + (c + 1) * dx
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[x0, y], [x1, y]]}, "properties": {"class": "residential"}})
    for c in range(cols + 1):
        x = origin_lon + c * dx
        for r in range(rows):
            y0, y1 = origin_lat + r * dy, origin_lat + (r + 1) * dy
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[x, y0], [x, y1]]}, "properties": {"class": "residential"}})
    return {"type": "FeatureCollection", "features": features}


@app.command()
def generate(
    output_json: str,
    rows: int = typer.Option(4, "--rows", "-r", help="Grid rows (horizontal streets)"),
    cols: int = typer.Option(4, "--cols", "-c", help="Grid cols (vertical streets)"),
):
    """Generate synthetic grid city GeoJSON. Segments = (rows+1)*cols + (cols+1)*rows."""
    out = Path(output_json)
    geojson = _grid_geojson(rows=rows, cols=cols)
    out.write_text(json.dumps(geojson, indent=2))
    n = len(geojson["features"])
    console.print(f"[green]Generated[/green] {n} segments -> {out}")

@app.command()
def compare(input_json: str, baseline_penalties: str = "0,0,0", high_penalties: str = "0.5,1.0,0.2"):
    from app.geojson_ops import GeoJSONFeatureCollection
    from app.optimize import OptimizeRequest, TurnPenalties, _run_optimize as optimize_route
    path = Path(input_json)
    if not path.exists():
        console.print(f"[red]File not found:[/red] {path}"); raise SystemExit(1)
    fc = GeoJSONFeatureCollection(**json.loads(path.read_text()))
    def parse(s):
        p = [float(x.strip()) for x in s.split(",")]; return TurnPenalties(left_turn=p[0], u_turn=p[1], right_turn=p[2])
    results = []
    for label, pen in [("Baseline", parse(baseline_penalties)), ("High Penalty", parse(high_penalties))]:
        body = OptimizeRequest(geojson=fc, turn_penalties=pen, clean_before_optimize=True)
        results.append((label, optimize_route(body)))
    table = Table(title="Optimization comparison")
    table.add_column("Metric", style="cyan")
    for label, _ in results: table.add_column(label, justify="right")
    for row_name, key in [("Total distance (km)", "total_distance_km"), ("Efficiency (%)", "efficiency"), ("Traversals", "total_traversals"), ("Deadhead (km)", "deadhead_distance_km")]:
        if key == "efficiency": vals = [f"{r.stats.efficiency:.2f}" for _, r in results]
        elif key == "total_distance_km": vals = [f"{r.total_distance_km:.4f}" for _, r in results]
        else: vals = [str(getattr(r.stats, key)) if hasattr(r.stats, key) else f"{getattr(r, key, 0):.4f}" for _, r in results]
        if key == "deadhead_distance_km": vals = [f"{r.stats.deadhead_distance_km:.4f}" for _, r in results]
        if key == "total_traversals": vals = [str(r.stats.total_traversals) for _, r in results]
        table.add_row(row_name, *vals)
    console.print(table)

@app.command()
def clean(input_json: str, output: str | None = typer.Option(None, "--output", "-o", help="Write cleaned GeoJSON to this file (for piping to compare)")):
    from app.vector_clean import CleanOptions, clean_geojson
    path = Path(input_json)
    if not path.exists():
        console.print(f"[red]File not found:[/red] {path}"); raise SystemExit(1)
    opts = CleanOptions(remove_selfloops=True, dedupe_edges=True, merge_parallel_edges=False, min_length_m=1.0, max_components=0)
    cleaned_fc, stats = clean_geojson(json.loads(path.read_text()), opts)
    console.print("[green]Clean stats:[/green]")
    console.print(f"  input_features: {stats.input_features}"); console.print(f"  output_features: {stats.output_features}")
    console.print(f"  duplicate_edges_removed: {stats.duplicate_edges_removed}"); console.print(f"  selfloops_removed: {stats.selfloops_removed}")
    if output:
        out_path = Path(output)
        out_path.write_text(cleaned_fc.model_dump_json(indent=2))
        console.print(f"[green]Wrote cleaned GeoJSON ->[/green] {out_path}")

@app.command("solve-vrp-test")
def solve_vrp_test():
    try:
        from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    except ImportError as e: console.print(f"[red]OR-Tools not available:[/red] {e}"); raise SystemExit(1)
    manager = pywrapcp.RoutingIndexManager(3, 1, 0)
    routing = pywrapcp.RoutingModel(manager)
    def cb(a, b): return 0 if manager.IndexToNode(a) == manager.IndexToNode(b) else 100
    transit_callback_index = routing.RegisterTransitCallback(cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    solution = routing.SolveWithParameters(params)
    console.print("[green]solve-vrp-test passed:[/green] OR-Tools VRP solved a trivial problem." if solution else "[yellow]Solver ran (no solution).[/yellow]")


@app.command("stress-partition")
def stress_partition(
    input_json: str = typer.Argument(..., help="Input GeoJSON (e.g. large_city.json)"),
    timeout_sec: float = typer.Option(30.0, "--timeout", "-t", help="Abort global solve after this many seconds"),
    zones: int = typer.Option(4, "--zones", "-k", help="Number of zones for partitioned solve"),
):
    """
    Zone Partitioning stress test: compare Global solve vs Partitioned solve.
    Records solve time, total distance, efficiency, deadhead; then boundary analysis and verdict.
    """
    from app.geojson_ops import GeoJSONFeatureCollection, geojson_to_partition_graph
    from app.optimize import OptimizeRequest, _run_optimize as optimize_route
    from app.main import partition_graph, EdgeInput

    path = Path(input_json)
    if not path.exists():
        console.print(f"[red]File not found:[/red] {path}")
        raise SystemExit(1)
    raw = json.loads(path.read_text())
    fc = GeoJSONFeatureCollection(**raw)
    n_features = len(fc.features)
    console.print(f"[bold]Stress test:[/bold] {path.name} ({n_features} features), timeout={timeout_sec}s, zones={zones}\n")

    # --- Benchmark A: Global solve (baseline) ---
    console.print("[bold cyan]Benchmark A: Global solve (no partitioning)[/bold cyan]")
    body = OptimizeRequest(geojson=fc, clean_before_optimize=True)
    t0 = time.perf_counter()
    try:
        resp_global = optimize_route(body)
        t_global_ms = (time.perf_counter() - t0) * 1000
    except Exception as e:
        t_global_ms = (time.perf_counter() - t0) * 1000
        if t_global_ms > timeout_sec * 1000:
            console.print(f"[red]Timeout/Too Slow[/red] ({t_global_ms/1000:.1f}s > {timeout_sec}s)")
            console.print(f"[red]Error:[/red] {e}")
            raise SystemExit(1)
        raise
    if t_global_ms > timeout_sec * 1000:
        console.print(f"[red]Timeout/Too Slow[/red] ({t_global_ms/1000:.1f}s > {timeout_sec}s)")
        console.print("Skipping Benchmark B (global exceeded threshold).")
        raise SystemExit(1)
    dist_global = resp_global.total_distance_km
    eff_global = resp_global.stats.efficiency
    deadhead_global = resp_global.stats.deadhead_distance_km
    console.print(f"  Solve time: {t_global_ms:.0f} ms")
    console.print(f"  Total distance: {dist_global:.4f} km")
    console.print(f"  Efficiency: {eff_global:.2f}%")
    console.print(f"  Deadhead: {deadhead_global:.4f} km\n")

    # --- Partition and assign features to zones ---
    edges_dict, node_count, id_to_coords = geojson_to_partition_graph(fc)
    if node_count == 0:
        console.print("[red]Partition graph produced no nodes.[/red]")
        raise SystemExit(1)
    edges = [EdgeInput(**d) for d in edges_dict]
    part_resp = partition_graph(
        edges, node_count, zones, "distance",
        node_coords=id_to_coords, include_polygons=False,
    )
    coord_to_node = {id_to_coords[i]: i for i in range(len(id_to_coords))}
    node_to_zone: dict[int, int] = {}
    for z in part_resp.zones:
        for nid in z.node_ids:
            node_to_zone[nid] = z.zone_id
    zone_features: dict[int, list] = {z.zone_id: [] for z in part_resp.zones}
    for feat in fc.features:
        geom = feat.geometry or {}
        coords_list = geom.get("coordinates", []) if geom.get("type") == "LineString" else []
        if not coords_list:
            if geom.get("type") == "MultiLineString":
                coords_list = (geom.get("coordinates") or [])[0] if geom.get("coordinates") else []
        if not coords_list:
            zone_features[0].append(feat.model_dump())
            continue
        first = coords_list[0]
        key = _round_key(first[0], first[1])
        nid = coord_to_node.get(key, 0)
        zid = node_to_zone.get(nid, 0)
        zone_features[zid].append(feat.model_dump())

    # --- Benchmark B: Partitioned solve ---
    from app.geojson_ops import GeoJSONFeature
    console.print("[bold cyan]Benchmark B: Partitioned solve[/bold cyan]")
    total_dist_part = 0.0
    total_deadhead_part = 0.0
    total_traversals_part = 0
    min_possible_part = 0.0
    t_part_start = time.perf_counter()
    for zid in sorted(zone_features.keys()):
        feats = zone_features[zid]
        if not feats:
            continue
        zone_fc = GeoJSONFeatureCollection(type="FeatureCollection", features=[GeoJSONFeature(**f) for f in feats])
        z_info = next((z for z in part_resp.zones if z.zone_id == zid), None)
        if z_info and z_info.estimated_distance is not None:
            min_possible_part += z_info.estimated_distance
        try:
            body_z = OptimizeRequest(geojson=zone_fc, clean_before_optimize=True)
            r = optimize_route(body_z)
            total_dist_part += r.total_distance_km
            total_deadhead_part += r.stats.deadhead_distance_km
            total_traversals_part += r.stats.total_traversals
        except Exception as e:
            console.print(f"  [yellow]Zone {zid} failed:[/yellow] {e}")
    t_part_ms = (time.perf_counter() - t_part_start) * 1000
    eff_part = (min_possible_part / total_dist_part * 100) if total_dist_part > 0 else 100.0
    console.print(f"  Solve time (all zones): {t_part_ms:.0f} ms")
    console.print(f"  Total distance: {total_dist_part:.4f} km")
    console.print(f"  Efficiency: {eff_part:.2f}%")
    console.print(f"  Deadhead: {total_deadhead_part:.4f} km\n")

    # --- Boundary analysis ---
    console.print("[bold cyan]Boundary analysis[/bold cyan]")
    deadhead_diff = total_deadhead_part - deadhead_global
    console.print(f"  Deadhead Global: {deadhead_global:.4f} km")
    console.print(f"  Deadhead Partitioned: {total_deadhead_part:.4f} km")
    console.print(f"  Delta (partitioned - global): {deadhead_diff:+.4f} km")
    if deadhead_diff > 0.001:
        console.print("  [yellow]Partitioning added deadhead (boundary/duplicate traversal).[/yellow]")
    else:
        console.print("  [green]Partitioned deadhead <= global.[/green]")

    # --- Final verdict ---
    console.print("\n[bold cyan]Final verdict[/bold cyan]")
    speed_gain = t_global_ms / t_part_ms if t_part_ms > 0 else 0
    eff_loss_pct = eff_global - eff_part
    console.print(f"  Speed gain (global/partitioned time): {speed_gain:.2f}x")
    console.print(f"  Efficiency loss: {eff_loss_pct:.2f} percentage points")
    if t_global_ms > timeout_sec * 1000 * 0.8:
        console.print("  [yellow]Recommendation: Global solve near timeout; consider partitioning for larger instances.[/yellow]")
    elif speed_gain > 1.2 and eff_loss_pct < 10:
        console.print("  [green]Recommendation: Partitioning is faster with acceptable quality loss.[/green]")
    elif eff_loss_pct > 15 or speed_gain < 1:
        console.print("  [dim]Recommendation: Keep global solve for graphs of this size.[/dim]")
    if t_global_ms > 5000:
        console.print("  [yellow]Use partitioning when global solve exceeds ~5–30s.[/yellow]")
    console.print(f"  Suggested threshold: use partitioning when global solve time > {timeout_sec}s (or edges >> {n_features}).")

if __name__ == "__main__": app()
