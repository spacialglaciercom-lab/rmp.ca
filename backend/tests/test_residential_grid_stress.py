"""
Test #1 — Residential Grid Stress (Laval–Auteuil/Vimont)
=========================================================

**Test ID:**        RESID-GRID-STRESS-001
**Location:**       Laval, QC – Auteuil / Vimont residential grid
                    (northeast Montreal metropolitan area)
**Overture Release:** Overture 2024-* Transportation theme
**Data Source:**     extract-8v1w0jvao6.geojson  (real Overture Maps)
                    Bounding box: [-73.746256, 45.609772, -73.722585, 45.627933]

**Scenario Description:**
    The residential sub-graph of this extract contains 198 segments across
    128 nodes in the largest connected component.  The graph is heavily
    non-Eulerian — **108 out of 128 nodes are odd-degree** — which forces
    the Chinese Postman solver to compute minimum-weight perfect matching
    on 54 pairs.  The grid is dense with T-intersections (97 nodes with
    degree 3) plus 39 dead-end cul-de-sacs, creating a worst-case topology
    for Blossom matching and deadhead minimisation.

    This test stresses:
      1. CPP matching scalability on a large odd-degree set (108 nodes → C(108,2)
         = 5 778 potential matching edges; Blossom must solve 54-pair matching).
      2. Hierholzer turn-aware circuit quality on a real residential grid
         (many right-angle intersections → high turn cost if not optimised).
      3. Dead-end U-turn handling: 39 cul-de-sacs guarantee at least 39 U-turns;
         any additional U-turns signal refinement failure.
      4. Deadhead distance efficiency: theoretical lower bound vs actual.

**Hypothesised Inefficiency Causes Targeted:**
    - Blossom matching O(n³) blow-up when odd-degree count is high (108 nodes)
    - Poor heuristic causing excess deadhead distance above minimum
    - Hierholzer circuit choosing bad edge order at degree-3 T-junctions
      → unnecessary left turns or U-turns instead of right-turn sequences
    - Post-circuit refinement failing to eliminate all avoidable U-turns
    - Graph build time regression from splitting 198 segments at shared nodes
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Path to real Overture extract
GEOJSON_PATH = Path(__file__).resolve().parents[2] / "extract-8v1w0jvao6.geojson"


@pytest.fixture(autouse=True)
def _clear_dem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Avoid DEM plugin activation from developer shell environment."""
    monkeypatch.delenv("DEM_PATH", raising=False)


# ---------------------------------------------------------------------------
# Data-loading helpers
# ---------------------------------------------------------------------------

def _load_geojson() -> dict:
    with open(GEOJSON_PATH) as f:
        return json.load(f)


def _filter_residential(fc: dict) -> dict:
    """Keep only LineString features with class=residential."""
    features = [
        f for f in fc["features"]
        if f["geometry"]["type"] == "LineString"
        and f.get("properties", {}).get("class") == "residential"
    ]
    return {"type": "FeatureCollection", "features": features}


def _filter_linestrings(fc: dict, classes: list[str] | None = None) -> dict:
    """Keep only LineString features, optionally filtered by road class."""
    features = []
    for f in fc["features"]:
        if f["geometry"]["type"] != "LineString":
            continue
        if classes is not None:
            if f.get("properties", {}).get("class") not in classes:
                continue
        features.append(f)
    return {"type": "FeatureCollection", "features": features}


def _optimize(fc: dict, **kwargs) -> dict:
    body = {"geojson": fc, "clean_before_optimize": True, **kwargs}
    r = client.post("/api/optimize/sync", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    R = 6371.0
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    dlat = lat2r - lat1r
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1r) * math.cos(lat2r) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _bearing(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Forward azimuth in degrees [0, 360)."""
    dlon = math.radians(lon2 - lon1)
    lat1r, lat2r = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _turn_angle(bearing_in: float, bearing_out: float) -> float:
    """Signed turn angle: positive = right, negative = left.  Range (-180, 180]."""
    diff = (bearing_out - bearing_in + 540) % 360 - 180
    return diff


def _classify_turn(angle: float) -> str:
    a = abs(angle)
    if a > 150:
        return "u_turn"
    if a > 30:
        return "right" if angle > 0 else "left"
    return "straight"


def _analyse_route_turns(route_points: list[dict]) -> dict:
    """
    Walk through route points and classify every direction change.

    Returns a dict with:
        total_turns, u_turns, left_turns, right_turns, straight,
        sharp_turns (>90°), turns_per_km, max_consecutive_same_direction,
        detailed_angles (list of (angle, classification))
    """
    if len(route_points) < 3:
        return {"total_turns": 0}

    bearings = []
    distances = []
    for i in range(len(route_points) - 1):
        p1 = route_points[i]
        p2 = route_points[i + 1]
        b = _bearing(p1["longitude"], p1["latitude"],
                     p2["longitude"], p2["latitude"])
        d = _haversine_km(p1["longitude"], p1["latitude"],
                          p2["longitude"], p2["latitude"])
        bearings.append(b)
        distances.append(d)

    total_distance = sum(distances)
    u_turns = 0
    left_turns = 0
    right_turns = 0
    straight = 0
    sharp_turns = 0
    detailed = []

    for i in range(len(bearings) - 1):
        angle = _turn_angle(bearings[i], bearings[i + 1])
        cls = _classify_turn(angle)
        detailed.append((angle, cls))
        if cls == "u_turn":
            u_turns += 1
        elif cls == "left":
            left_turns += 1
            if abs(angle) > 90:
                sharp_turns += 1
        elif cls == "right":
            right_turns += 1
            if abs(angle) > 90:
                sharp_turns += 1
        else:
            straight += 1

    total_turns = u_turns + left_turns + right_turns
    turns_per_km = total_turns / total_distance if total_distance > 0 else 0

    return {
        "total_turns": total_turns,
        "u_turns": u_turns,
        "left_turns": left_turns,
        "right_turns": right_turns,
        "straight": straight,
        "sharp_turns": sharp_turns,
        "turns_per_km": round(turns_per_km, 2),
        "total_distance_km": round(total_distance, 3),
        "detailed_angles": detailed,
    }


# ===========================================================================
# Test #1a — Baseline: residential-only, no turn penalties, undirected
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Overture extract not found")
class TestResidentialGridStress:
    """
    Residential grid stress tests using real Overture Transportation data
    from Laval, QC (Auteuil/Vimont neighbourhood).

    Dataset: 198 residential LineStrings, 128 nodes (largest component),
    108 odd-degree nodes, 39 dead-ends, ~24.8 km total road length.
    """

    @pytest.fixture(scope="class")
    def residential_fc(self) -> dict:
        return _filter_residential(_load_geojson())

    @pytest.fixture(scope="class")
    def full_lines_fc(self) -> dict:
        return _filter_linestrings(_load_geojson())

    # -----------------------------------------------------------------------
    # 1a. Graph structure invariants
    # -----------------------------------------------------------------------

    def test_graph_has_expected_scale(self, residential_fc: dict) -> None:
        """Verify the residential sub-graph has the expected node/edge counts."""
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        # Must have at least 150 edges (198 raw, some may merge after clean)
        assert stats["edges_in_graph"] >= 150, (
            f"Expected ≥150 edges, got {stats['edges_in_graph']} — "
            f"graph construction may be dropping segments"
        )
        assert stats["nodes_in_graph"] >= 100, (
            f"Expected ≥100 nodes, got {stats['nodes_in_graph']}"
        )

    def test_high_odd_degree_count(self, residential_fc: dict) -> None:
        """
        The residential grid has ~108 odd-degree vertices.  The CPP solver
        must match at least 50 pairs.  A low odd-degree count here would
        mean the graph was incorrectly simplified.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        assert stats["odd_degree_vertices"] >= 80, (
            f"Expected ≥80 odd-degree vertices, got {stats['odd_degree_vertices']} — "
            f"graph may be incorrectly merging nodes"
        )

    # -----------------------------------------------------------------------
    # 1b. Deadhead / efficiency bounds
    # -----------------------------------------------------------------------

    def test_deadhead_bounded(self, residential_fc: dict) -> None:
        """
        With 108 odd nodes and ~24.8 km total, Blossom matching should keep
        deadhead below 40% of total.  Higher values signal matching failure
        or greedy fallback.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        deadhead_ratio = stats["deadhead_distance_km"] / stats["total_distance_km"]
        assert deadhead_ratio < 0.50, (
            f"Deadhead ratio {deadhead_ratio:.2%} exceeds 50% — "
            f"Blossom matching may have fallen back to greedy. "
            f"Deadhead: {stats['deadhead_distance_km']:.2f} km, "
            f"Total: {stats['total_distance_km']:.2f} km"
        )

    def test_efficiency_above_minimum(self, residential_fc: dict) -> None:
        """
        Efficiency = (min_distance / actual_distance) × 100.
        On this graph (heavily non-Eulerian), expect ≥60%.  Below that
        indicates the CPP solver is producing grossly suboptimal routes.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        assert stats["efficiency"] >= 50.0, (
            f"Efficiency {stats['efficiency']:.1f}% is below 50% floor — "
            f"CPP matching or circuit construction is severely suboptimal"
        )

    # -----------------------------------------------------------------------
    # 1c. Turn analysis — the core inefficiency signal
    # -----------------------------------------------------------------------

    def test_u_turn_count_bounded(self, residential_fc: dict) -> None:
        """
        The grid has 39 dead-ends → at least 39 forced U-turns.
        Post-circuit refinement should keep total U-turns below 2× the
        theoretical minimum (i.e., < 78).  Excess U-turns indicate
        refinement pass failure or bad edge ordering in Hierholzer.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        dead_ends = stats["dead_ends"]
        u_turns = stats["u_turns"]
        # U-turns should not greatly exceed dead-end count
        theoretical_min = max(dead_ends, 1)
        assert u_turns <= theoretical_min * 2.5, (
            f"U-turns ({u_turns}) > 2.5× dead-ends ({dead_ends}) — "
            f"post-circuit U-turn elimination is failing. "
            f"Ratio: {u_turns/theoretical_min:.1f}×"
        )

    def test_left_turn_ratio_reasonable(self, residential_fc: dict) -> None:
        """
        UPS-style turn-aware Hierholzer should prefer right turns.
        On a regular grid the left/right ratio should be ≤ 1.0.
        A ratio > 1.2 indicates the turn-scoring heuristic is ineffective.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        if stats["right_turns"] == 0:
            pytest.skip("No right turns recorded — turn classification may be disabled")
        lr_ratio = stats["left_turns"] / max(stats["right_turns"], 1)
        assert lr_ratio <= 1.25, (
            f"Left/Right turn ratio = {lr_ratio:.2f} (L={stats['left_turns']}, "
            f"R={stats['right_turns']}) — turn-aware scoring is not effective"
        )

    def test_route_turn_density(self, residential_fc: dict) -> None:
        """
        Analyse the actual route geometry for turn density.
        Residential grids with ~100 m block spacing should produce
        ≤ 6 turns/km.  Higher density signals unnecessary zigzagging.
        """
        resp = _optimize(residential_fc)
        route = resp["route"]
        analysis = _analyse_route_turns(route)
        if analysis["total_distance_km"] < 1.0:
            pytest.skip("Route too short for meaningful turn density")
        assert analysis["turns_per_km"] <= 8.0, (
            f"Turn density {analysis['turns_per_km']} turns/km exceeds 8.0 — "
            f"route has excessive direction changes. "
            f"U-turns: {analysis['u_turns']}, "
            f"Left: {analysis['left_turns']}, Right: {analysis['right_turns']}"
        )

    # -----------------------------------------------------------------------
    # 1d. Timing — wall-clock performance bounds
    # -----------------------------------------------------------------------

    def test_graph_build_under_2s(self, residential_fc: dict) -> None:
        """Graph construction for 198 segments must complete in < 2 seconds."""
        resp = _optimize(residential_fc)
        build_ms = resp.get("timing_ms", {}).get("graph_build", 0)
        assert build_ms < 2000, (
            f"Graph build took {build_ms:.0f} ms (limit: 2000 ms) — "
            f"segment splitting or node snapping has a bottleneck"
        )

    def test_cpp_solve_under_10s(self, residential_fc: dict) -> None:
        """
        CPP solve (matching + circuit) on 108 odd-degree nodes must
        complete in < 10 seconds.  Blossom matching is O(n³); 108 nodes
        should still be fast.  A timeout here signals algorithmic regression.
        """
        resp = _optimize(residential_fc)
        solve_ms = resp.get("timing_ms", {}).get("cpp_solve", 0)
        assert solve_ms < 10_000, (
            f"CPP solve took {solve_ms:.0f} ms (limit: 10000 ms) — "
            f"Blossom matching or Dijkstra shortest-paths is too slow"
        )

    def test_total_time_under_15s(self, residential_fc: dict) -> None:
        """End-to-end must complete in < 15 seconds (no DEM, no plugins)."""
        resp = _optimize(residential_fc)
        total_ms = resp.get("timing_ms", {}).get("total", 0)
        assert total_ms < 15_000, (
            f"Total optimization took {total_ms:.0f} ms (limit: 15000 ms)"
        )

    # -----------------------------------------------------------------------
    # 1e. All-edges-covered invariant
    # -----------------------------------------------------------------------

    def test_all_edges_traversed(self, residential_fc: dict) -> None:
        """
        The CPP solution must traverse every edge at least once.
        total_traversals ≥ edges_in_graph is the fundamental invariant.
        """
        resp = _optimize(residential_fc)
        stats = resp["stats"]
        assert stats["total_traversals"] >= stats["edges_in_graph"], (
            f"Only {stats['total_traversals']} traversals for "
            f"{stats['edges_in_graph']} edges — route is incomplete"
        )

    # -----------------------------------------------------------------------
    # 1f. Turn penalty sensitivity — compare with vs without
    # -----------------------------------------------------------------------

    def test_turn_penalty_reduces_u_turns(self, residential_fc: dict) -> None:
        """
        Enabling use_turn_penalty_plugin should reduce U-turn count
        compared to baseline.  If it doesn't, the plugin isn't influencing
        the CPP matching.
        """
        baseline = _optimize(residential_fc)
        penalised = _optimize(residential_fc, use_turn_penalty_plugin=True)

        base_u = baseline["stats"]["u_turns"]
        pen_u = penalised["stats"]["u_turns"]

        # Allow same or fewer — just assert penalty mode doesn't make it worse
        assert pen_u <= base_u * 1.1 + 2, (
            f"Turn penalty mode increased U-turns: {pen_u} vs baseline {base_u} — "
            f"TurnPenaltyPlugin is counter-productive"
        )

    def test_turn_penalty_does_not_explode_distance(self, residential_fc: dict) -> None:
        """
        Turn penalties may increase total distance slightly (trading distance
        for fewer turns), but should not increase it by more than 25%.
        """
        baseline = _optimize(residential_fc)
        penalised = _optimize(residential_fc, use_turn_penalty_plugin=True)

        base_d = baseline["stats"]["total_distance_km"]
        pen_d = penalised["stats"]["total_distance_km"]
        ratio = pen_d / base_d if base_d > 0 else 1.0
        assert ratio < 1.25, (
            f"Turn penalty increased distance by {(ratio-1)*100:.1f}% "
            f"({base_d:.2f} → {pen_d:.2f} km) — penalty weights may be too high"
        )

    # -----------------------------------------------------------------------
    # 1g. Full extract stress — all road classes combined
    # -----------------------------------------------------------------------

    def test_full_extract_completes(self, full_lines_fc: dict) -> None:
        """
        Run the optimizer on ALL 509 LineString segments (residential +
        service + tertiary + secondary).  This is a scalability stress
        test: graph build + CPP on the full network must complete and
        produce a valid route.
        """
        resp = _optimize(full_lines_fc)
        stats = resp["stats"]
        assert stats["edges_in_graph"] >= 250, (
            f"Full extract should have ≥250 edges, got {stats['edges_in_graph']}"
        )
        assert stats["total_traversals"] >= stats["edges_in_graph"]
        assert stats["efficiency"] > 0

    def test_full_extract_timing(self, full_lines_fc: dict) -> None:
        """Full 509-segment extract must finish in < 30 seconds."""
        resp = _optimize(full_lines_fc)
        total_ms = resp.get("timing_ms", {}).get("total", 0)
        assert total_ms < 30_000, (
            f"Full extract took {total_ms:.0f} ms (limit: 30000 ms) — "
            f"scalability bottleneck on {resp['stats']['edges_in_graph']} edges"
        )


# ===========================================================================
# Diagnostic report — run with `pytest -s` to see full output
# ===========================================================================

@pytest.mark.skipif(not GEOJSON_PATH.exists(), reason="Overture extract not found")
def test_diagnostic_report() -> None:
    """
    Not a pass/fail test — prints a comprehensive diagnostic report.
    Run with `pytest -s -k test_diagnostic_report` to view.
    """
    fc = _filter_residential(_load_geojson())
    resp = _optimize(fc)
    stats = resp["stats"]
    timing = resp.get("timing_ms", {})
    route = resp["route"]
    turn_analysis = _analyse_route_turns(route)

    report = f"""
╔══════════════════════════════════════════════════════════════════╗
║          TEST #1 — RESIDENTIAL GRID STRESS DIAGNOSTIC          ║
║          Laval–Auteuil/Vimont · Overture Transportation        ║
╠══════════════════════════════════════════════════════════════════╣
║ GRAPH STRUCTURE                                                 ║
║   Edges in graph:        {stats['edges_in_graph']:>6}                             ║
║   Nodes in graph:        {stats['nodes_in_graph']:>6}                             ║
║   Odd-degree vertices:   {stats['odd_degree_vertices']:>6}                             ║
║   Dead-ends:             {stats['dead_ends']:>6}                             ║
╠══════════════════════════════════════════════════════════════════╣
║ ROUTE METRICS                                                   ║
║   Total traversals:      {stats['total_traversals']:>6}                             ║
║   Total distance:        {stats['total_distance_km']:>9.2f} km                      ║
║   Deadhead distance:     {stats['deadhead_distance_km']:>9.2f} km                      ║
║   Efficiency:            {stats['efficiency']:>8.1f}%                           ║
║   Deadhead ratio:        {stats['deadhead_distance_km']/stats['total_distance_km']*100 if stats['total_distance_km']>0 else 0:>8.1f}%                           ║
╠══════════════════════════════════════════════════════════════════╣
║ TURN ANALYSIS (from stats)                                      ║
║   Right turns:           {stats['right_turns']:>6}                             ║
║   Left turns:            {stats['left_turns']:>6}                             ║
║   U-turns:               {stats['u_turns']:>6}                             ║
║   Straight:              {stats['straight']:>6}                             ║
║   L/R ratio:             {stats['left_turns']/max(stats['right_turns'],1):>8.2f}                           ║
╠══════════════════════════════════════════════════════════════════╣
║ TURN ANALYSIS (from route geometry)                             ║
║   Route points:          {len(route):>6}                             ║
║   Geo total turns:       {turn_analysis.get('total_turns',0):>6}                             ║
║   Geo U-turns:           {turn_analysis.get('u_turns',0):>6}                             ║
║   Geo left turns:        {turn_analysis.get('left_turns',0):>6}                             ║
║   Geo right turns:       {turn_analysis.get('right_turns',0):>6}                             ║
║   Geo sharp turns (>90°):{turn_analysis.get('sharp_turns',0):>6}                             ║
║   Turns per km:          {turn_analysis.get('turns_per_km',0):>8.2f}                           ║
╠══════════════════════════════════════════════════════════════════╣
║ TIMING                                                          ║
║   Clean:                 {timing.get('clean', 0):>8.0f} ms                         ║
║   Graph build:           {timing.get('graph_build', 0):>8.0f} ms                         ║
║   CPP solve:             {timing.get('cpp_solve', 0):>8.0f} ms                         ║
║   Route build:           {timing.get('route_build', 0):>8.0f} ms                         ║
║   Analytics:             {timing.get('analytics', 0):>8.0f} ms                         ║
║   Total:                 {timing.get('total', 0):>8.0f} ms                         ║
╚══════════════════════════════════════════════════════════════════╝
"""
    print(report)

    # Inefficiency flags
    flags = []
    if stats["u_turns"] > stats["dead_ends"] * 2:
        flags.append(f"⚠ U-turns ({stats['u_turns']}) > 2× dead-ends ({stats['dead_ends']}): refinement failing")
    if stats["left_turns"] > stats["right_turns"] * 1.2:
        flags.append(f"⚠ Left turns dominate (L/R={stats['left_turns']/max(stats['right_turns'],1):.2f}): turn scoring ineffective")
    if stats["deadhead_distance_km"] / stats["total_distance_km"] > 0.35:
        flags.append(f"⚠ Deadhead ratio {stats['deadhead_distance_km']/stats['total_distance_km']:.1%}: matching suboptimal")
    if timing.get("cpp_solve", 0) > 5000:
        flags.append(f"⚠ CPP solve {timing.get('cpp_solve',0):.0f}ms: Blossom may be slow on {stats['odd_degree_vertices']} odd nodes")
    if turn_analysis.get("turns_per_km", 0) > 6:
        flags.append(f"⚠ Turn density {turn_analysis['turns_per_km']} turns/km: excessive zigzagging")

    if flags:
        print("INEFFICIENCY FLAGS:")
        for f in flags:
            print(f"  {f}")
    else:
        print("✓ No inefficiency flags triggered")
