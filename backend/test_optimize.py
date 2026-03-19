"""
Diagnostic script for route optimization debugging.

Usage:
    # Test with a GeoJSON file
    python test_optimize.py route.geojson

    # Compare OSM vs GeoJSON (auto-converts .osm file)
    python test_optimize.py route.geojson map.osm

    # Run against a live optimizer (default: http://localhost:8000)
    python test_optimize.py route.geojson --url http://localhost:8000

    # Dry-run: analyse graph stats without calling the optimizer
    python test_optimize.py route.geojson --dry-run

    # Show how many duplicate edges exist before/after dedup
    python test_optimize.py route.geojson --dedup-report

    # Save OSM-derived GeoJSON for inspection
    python test_optimize.py map.osm --save-osm-geojson out.geojson
"""

import argparse
import hashlib
import json
import math
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    import networkx as nx
    HAS_NX = True
except ImportError:
    HAS_NX = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _round_coord(val: float, decimals: int = 6) -> float:
    return round(val, decimals)

def _node_id(lon: float, lat: float) -> str:
    return f"{_round_coord(lon)},{_round_coord(lat)}"

def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def load_geojson(path: str) -> dict:
    with open(path) as f:
        return json.load(f)

def get_road_class(props: dict) -> str:
    return str(props.get("class") or props.get("road_class") or props.get("highway") or "unknown")


# ---------------------------------------------------------------------------
# OSM -> GeoJSON converter
# ---------------------------------------------------------------------------

# OSM highway values that the app filters in (mirrors lib/offline-extract.ts)
OSM_ROAD_TAGS = {
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified", "residential",
    "living_street", "service",
    "pedestrian", "track",
    "footway", "path", "cycleway",
    "steps", "road",
}


def osm_to_geojson(osm_path: str, road_tags: set[str] | None = None) -> dict:
    """
    Parse an OSM XML file and return a GeoJSON FeatureCollection.
    Only ways with a highway tag are included (matching the app's filter logic).
    Coordinates are [lon, lat] (GeoJSON convention).
    """
    if road_tags is None:
        road_tags = OSM_ROAD_TAGS

    tree = ET.parse(osm_path)
    root = tree.getroot()

    # Build node id -> (lat, lon) map
    nodes: dict[str, tuple[float, float]] = {}
    for node in root.iter("node"):
        nid = node.get("id")
        lat = node.get("lat")
        lon = node.get("lon")
        if nid and lat and lon:
            nodes[nid] = (float(lat), float(lon))

    features = []
    for way in root.iter("way"):
        tags: dict[str, str] = {t.get("k"): t.get("v") for t in way.iter("tag")}
        highway = tags.get("highway", "")
        if highway not in road_tags:
            continue

        nd_refs = [nd.get("ref") for nd in way.iter("nd")]
        coords = []
        for ref in nd_refs:
            if ref and ref in nodes:
                lat, lon = nodes[ref]
                coords.append([lon, lat])  # GeoJSON: [lon, lat]

        if len(coords) < 2:
            continue

        feature = {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "highway": highway,
                "name": tags.get("name", ""),
                "oneway": tags.get("oneway", "no"),
                "osm_id": way.get("id"),
            },
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


# ---------------------------------------------------------------------------
# Local graph analysis (no optimizer needed)
# ---------------------------------------------------------------------------

def analyse_geojson(fc: dict, label: str = "") -> dict:
    """
    Analyse a GeoJSON FeatureCollection for graph properties that affect
    route optimization quality. Returns a stats dict and prints a report.
    """
    features = fc.get("features", [])
    line_features = [f for f in features if f.get("geometry", {}).get("type") in ("LineString", "MultiLineString")]

    total_features = len(features)
    line_count = len(line_features)

    # Collect all line segments
    all_lines: list[tuple[list, int]] = []
    coord_count: dict[str, int] = {}
    for idx, feat in enumerate(line_features):
        geom = feat.get("geometry", {})
        gtype = geom.get("type", "")
        if gtype == "LineString":
            lines = [geom.get("coordinates", [])]
        else:
            lines = geom.get("coordinates", [])
        for lc in lines:
            if len(lc) < 2:
                continue
            all_lines.append((lc, idx))
            for c in lc:
                nid = _node_id(c[0], c[1])
                coord_count[nid] = coord_count.get(nid, 0) + 1

    # Road class breakdown
    road_classes: dict[str, int] = {}
    for feat in line_features:
        rc = get_road_class(feat.get("properties") or {})
        road_classes[rc] = road_classes.get(rc, 0) + 1

    # Total length
    total_length_km = 0.0
    for lc, _ in all_lines:
        for i in range(1, len(lc)):
            total_length_km += _haversine_km(lc[i-1][0], lc[i-1][1], lc[i][0], lc[i][1])

    # Detect reverse-direction duplicates (the Overture bidirectional edge bug)
    # Two segments are "reverse duplicates" if they share the same (u,v) endpoint pair
    # and one's coords are approximately the reverse of the other.
    endpoint_pairs: dict[tuple[str, str], list[list]] = {}
    for lc, _ in all_lines:
        u = _node_id(lc[0][0], lc[0][1])
        v = _node_id(lc[-1][0], lc[-1][1])
        key = (min(u, v), max(u, v))
        if key not in endpoint_pairs:
            endpoint_pairs[key] = []
        endpoint_pairs[key].append(lc)

    # Count pairs where the same (u,v) has multiple segments
    multi_edge_pairs = {k: v for k, v in endpoint_pairs.items() if len(v) > 1}
    duplicate_count = sum(len(v) - 1 for v in multi_edge_pairs.values())

    # Direction-normalised dedup (same as the fix in vector_clean.py)
    def _norm_hash(coords: list) -> str:
        norm = coords if (not coords or coords[0] <= coords[-1]) else list(reversed(coords))
        return hashlib.sha256(str(tuple(tuple(c) for c in norm)).encode()).hexdigest()[:16]

    seen: dict[tuple[str, str], set[str]] = {}
    direction_dupes = 0
    for lc, _ in all_lines:
        u = _node_id(lc[0][0], lc[0][1])
        v = _node_id(lc[-1][0], lc[-1][1])
        key = (min(u, v), max(u, v))
        h = _norm_hash(lc)
        if key not in seen:
            seen[key] = set()
        if h in seen[key]:
            direction_dupes += 1
        else:
            seen[key].add(h)

    # Estimate graph stats if networkx available
    graph_stats = {}
    if HAS_NX:
        G = nx.MultiGraph()
        split_nodes: set[str] = set()
        for lc, _ in all_lines:
            split_nodes.add(_node_id(lc[0][0], lc[0][1]))
            split_nodes.add(_node_id(lc[-1][0], lc[-1][1]))
        for nid, cnt in coord_count.items():
            if cnt >= 2:
                split_nodes.add(nid)
        edge_idx = 0
        for lc, feat_idx in all_lines:
            run_start = 0
            for i in range(1, len(lc)):
                nid = _node_id(lc[i][0], lc[i][1])
                if nid not in split_nodes and i != len(lc) - 1:
                    continue
                seg = lc[run_start:i+1]
                if len(seg) < 2:
                    run_start = i
                    continue
                u = _node_id(seg[0][0], seg[0][1])
                v = _node_id(seg[-1][0], seg[-1][1])
                G.add_node(u); G.add_node(v)
                G.add_edge(u, v, key=edge_idx)
                edge_idx += 1
                run_start = i

        components = list(nx.connected_components(G))
        odd_degree = [n for n in G.nodes() if G.degree(n) % 2 != 0]
        graph_stats = {
            "nodes": G.number_of_nodes(),
            "edges": G.number_of_edges(),
            "components": len(components),
            "largest_component_nodes": max(len(c) for c in components) if components else 0,
            "odd_degree_nodes": len(odd_degree),
            # Minimum extra traversals needed = odd_degree / 2 (each pair needs one deadhead)
            "min_deadhead_traversals": len(odd_degree) // 2,
        }

    stats = {
        "label": label,
        "total_features": total_features,
        "line_features": line_count,
        "total_length_km": round(total_length_km, 3),
        "road_classes": dict(sorted(road_classes.items(), key=lambda x: -x[1])),
        "multi_edge_pairs": len(multi_edge_pairs),
        "direction_duplicate_edges": direction_dupes,
        "duplicate_pct": round(direction_dupes / max(len(all_lines), 1) * 100, 1),
        **graph_stats,
    }
    return stats


def print_analysis(stats: dict) -> None:
    label = stats.get("label", "")
    title = f"  {label}  " if label else "  Analysis  "
    print(f"\n{'='*60}")
    print(f"{title:^60}")
    print(f"{'='*60}")
    print(f"  Features (total/lines): {stats['total_features']} / {stats['line_features']}")
    print(f"  Total road length:      {stats['total_length_km']} km")
    print(f"  Road classes:")
    for cls, cnt in stats.get("road_classes", {}).items():
        print(f"    {cls:<20} {cnt}")

    dupes = stats['direction_duplicate_edges']
    pct   = stats['duplicate_pct']
    flag  = " !! HIGH -- likely Overture bidirectional duplication" if pct > 30 else (" OK" if pct < 5 else "")
    print(f"\n  Duplicate (reverse-dir) edges: {dupes} ({pct}%){flag}")

    if "nodes" in stats:
        print(f"\n  Graph (after split at intersections):")
        print(f"    Nodes:              {stats['nodes']}")
        print(f"    Edges:              {stats['edges']}")
        print(f"    Components:         {stats['components']}", end="")
        if stats['components'] > 1:
            print(f"  !! disconnected -- CPP will concatenate", end="")
        print()
        print(f"    Odd-degree nodes:   {stats['odd_degree_nodes']}")
        print(f"    Min deadhead runs:  {stats['min_deadhead_traversals']}")

        # Efficiency estimate: ideal distance = total_length_km, actual ≈ total + deadhead
        # Each deadhead traversal averages ~half the total / edges distance
        if stats['edges'] > 0 and stats['total_length_km'] > 0:
            avg_edge_km = stats['total_length_km'] / stats['edges']
            est_deadhead = stats['min_deadhead_traversals'] * avg_edge_km
            est_total    = stats['total_length_km'] + est_deadhead
            print(f"    Est. optimized distance: ~{est_total:.2f} km  (road={stats['total_length_km']:.2f} + deadhead>={est_deadhead:.2f})")
    print()


# ---------------------------------------------------------------------------
# Live optimizer call
# ---------------------------------------------------------------------------

def call_optimizer(fc: dict, url: str, label: str = "") -> dict | None:
    if not HAS_REQUESTS:
        print("  [skip] requests not installed -- pip install requests")
        return None
    endpoint = url.rstrip("/") + "/api/optimize"
    payload = {"geojson": fc, "clean_before_optimize": True}
    print(f"  POST {endpoint} ... ", end="", flush=True)
    t0 = time.time()
    try:
        resp = requests.post(endpoint, json=payload, timeout=120)
        elapsed = time.time() - t0
        if resp.status_code != 200:
            print(f"HTTP {resp.status_code}")
            try:
                print(f"  Error: {resp.json().get('detail', resp.text[:200])}")
            except Exception:
                print(f"  {resp.text[:200]}")
            return None
        data = resp.json()
        s = data.get("stats", {})
        print(f"OK ({elapsed:.1f}s)")
        result = {
            "label": label,
            "distance_km": data.get("total_distance_km"),
            "route_points": len(data.get("route", [])),
            "edges_in_graph": s.get("edges_in_graph"),
            "nodes_in_graph": s.get("nodes_in_graph"),
            "odd_degree": s.get("odd_degree_vertices"),
            "right_turns": s.get("right_turns"),
            "left_turns": s.get("left_turns"),
            "u_turns": s.get("u_turns"),
            "deadhead_km": s.get("deadhead_distance_km"),
            "efficiency_pct": s.get("efficiency"),
            "elapsed_s": round(elapsed, 2),
        }
        return result
    except requests.exceptions.ConnectionError:
        print("CONNECTION REFUSED -- is the optimizer running?")
        return None
    except Exception as e:
        print(f"ERROR: {e}")
        return None


def print_result(r: dict) -> None:
    label = r.get("label", "")
    print(f"\n  {'Result: ' + label if label else 'Result':}")
    print(f"    Distance:    {r['distance_km']:.2f} km  (deadhead: {r['deadhead_km']:.2f} km)")
    print(f"    Efficiency:  {r['efficiency_pct']:.1f}%")
    print(f"    Graph:       {r['nodes_in_graph']} nodes, {r['edges_in_graph']} edges, {r['odd_degree']} odd-degree")
    print(f"    Turns:       R={r['right_turns']}  L={r['left_turns']}  U={r['u_turns']}")
    print(f"    Route pts:   {r['route_points']}")
    print(f"    Time:        {r['elapsed_s']}s")


def print_comparison(r1: dict, r2: dict) -> None:
    print(f"\n{'='*60}")
    print(f"  COMPARISON")
    print(f"{'='*60}")
    rows = [
        ("Distance (km)",   f"{r1['distance_km']:.2f}",    f"{r2['distance_km']:.2f}"),
        ("Deadhead (km)",   f"{r1['deadhead_km']:.2f}",    f"{r2['deadhead_km']:.2f}"),
        ("Efficiency (%)",  f"{r1['efficiency_pct']:.1f}", f"{r2['efficiency_pct']:.1f}"),
        ("Right turns",     str(r1['right_turns']),         str(r2['right_turns'])),
        ("Left turns",      str(r1['left_turns']),          str(r2['left_turns'])),
        ("U-turns",         str(r1['u_turns']),             str(r2['u_turns'])),
        ("Edges in graph",  str(r1['edges_in_graph']),      str(r2['edges_in_graph'])),
        ("Odd-degree nodes",str(r1['odd_degree']),          str(r2['odd_degree'])),
        ("Time (s)",        str(r1['elapsed_s']),           str(r2['elapsed_s'])),
    ]
    l1 = r1.get("label", "File 1")[:18]
    l2 = r2.get("label", "File 2")[:18]
    print(f"  {'Metric':<22} {l1:<20} {l2:<20}")
    print(f"  {'-'*62}")
    for metric, v1, v2 in rows:
        try:
            fv1, fv2 = float(v1), float(v2)
            ratio = fv1 / fv2 if fv2 != 0 else float("inf")
            flag = f"  !! {ratio:.1f}x" if ratio > 1.5 else ""
        except ValueError:
            flag = ""
        print(f"  {metric:<22} {v1:<20} {v2:<20}{flag}")
    print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose route optimization issues")
    parser.add_argument("files", nargs="+", help="GeoJSON or OSM file(s) to analyse/optimize")
    parser.add_argument("--url", default="http://localhost:8000", help="Optimizer base URL")
    parser.add_argument("--dry-run", action="store_true", help="Graph analysis only, no optimizer call")
    parser.add_argument("--dedup-report", action="store_true", help="Show duplicate edge detail")
    parser.add_argument("--save-osm-geojson", metavar="OUT", help="Save OSM-derived GeoJSON to a file")
    args = parser.parse_args()

    if not HAS_NX:
        print("!! networkx not installed -- graph stats unavailable (pip install networkx)")
    if not HAS_REQUESTS and not args.dry_run:
        print("!! requests not installed -- optimizer calls unavailable (pip install requests)")

    results = []
    for path in args.files:
        p = Path(path)
        if not p.exists():
            print(f"File not found: {path}")
            sys.exit(1)

        if p.suffix.lower() == ".osm":
            print(f"\nParsing OSM file {p.name} ...")
            fc = osm_to_geojson(str(p))
            label = p.stem + " (OSM)"
            print(f"  Converted {len(fc['features'])} road ways to GeoJSON LineStrings")
            if args.save_osm_geojson:
                out_path = Path(args.save_osm_geojson)
                out_path.write_text(json.dumps(fc, indent=2))
                print(f"  Saved to {out_path}")
        else:
            print(f"\nLoading {p.name} ...")
            fc = load_geojson(str(p))
            label = p.stem

        stats = analyse_geojson(fc, label=label)
        print_analysis(stats)

        if args.dedup_report and stats["direction_duplicate_edges"] > 0:
            print(f"  !! {stats['direction_duplicate_edges']} reverse-direction duplicate edges detected.")
            print(f"      These will cause each road to be traversed twice by the CPP solver.")
            print(f"      Fixed by the coordinate-normalised dedupe in vector_clean.py.\n")

        if not args.dry_run:
            r = call_optimizer(fc, args.url, label=label)
            if r:
                print_result(r)
                results.append(r)

    if len(results) == 2:
        print_comparison(results[0], results[1])


if __name__ == "__main__":
    main()
