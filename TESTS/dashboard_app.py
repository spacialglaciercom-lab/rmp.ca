#!/usr/bin/env python3
"""
Universal Routing Algorithm Tester: Streamlit UI with drag-and-drop file upload,
AI Gatekeeper (LLM) for parsing, and dispatcher to CVRP (Clarke-Wright + 2-Opt or Backend OR-Tools) or CPP (Hierholzer).
Shows solver efficiency (total distance, route count, solve time) and can call rmp.ca backend for same results as production.
Run from repo root: streamlit run backend/dashboard_app.py
With PYTHONPATH=. if imports fail.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

# Ensure repo root (benchmark) and backend (app) are on path
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import streamlit as st


def _pyplot_with_download(fig: Any, filename: str = "plot.png", key: str = "download_plot") -> None:
    """Display matplotlib figure in Streamlit and offer PNG download."""
    import matplotlib.pyplot as plt

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    st.pyplot(fig)
    st.download_button(
        "Download image (PNG)",
        data=buf.getvalue(),
        file_name=filename,
        mime="image/png",
        key=key,
    )
    plt.close(fig)


# ---------------------------------------------------------------------------
# API key persistence (survives refresh / restart)
# ---------------------------------------------------------------------------

_API_KEY_FILE = os.path.join(_SCRIPT_DIR, ".streamlit", "api_key.json")


def _load_api_key_from_file() -> dict[str, Any]:
    """Load persisted provider, key, and optional ZAI base URL."""
    if not os.path.isfile(_API_KEY_FILE):
        return {}
    try:
        with open(_API_KEY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_api_key_to_file(provider: str, key: str, zai_base_url: str = "") -> None:
    """Persist API key so it survives refresh."""
    dir_path = os.path.dirname(_API_KEY_FILE)
    os.makedirs(dir_path, exist_ok=True)
    with open(_API_KEY_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {"provider": provider, "api_key": key, "zai_base_url": zai_base_url or ""},
            f,
            indent=0,
        )


# ---------------------------------------------------------------------------
# AI Gatekeeper
# ---------------------------------------------------------------------------


def _get_parsed_payload(
    raw_text: str,
    api_key_override: str | None = None,
    api_base_url_override: str | None = None,
) -> dict[str, Any] | None:
    """Call AI gatekeeper; return payload dict or None on error."""
    try:
        from ai_gatekeeper import call_ai_gatekeeper
        return call_ai_gatekeeper(
            raw_text,
            api_key_override=api_key_override or None,
            api_base_url_override=api_base_url_override or None,
        )
    except ValueError as e:
        st.error(str(e))
        return None
    except Exception as e:
        st.error(f"Could not parse file: {e}")
        return None


# ---------------------------------------------------------------------------
# Adapters: AI JSON -> VRPProblem / NetworkX
# ---------------------------------------------------------------------------


def _payload_to_vrp_problem(
    payload: dict[str, Any],
    capacity_override: int | None = None,
    vehicle_capacities: list[int] | None = None,
    must_share_route: list[tuple[int, int]] | None = None,
) -> Any:
    """Build benchmark.VRPProblem from AI CVRP payload. coords stored as (lat, lon) for GPX."""
    from benchmark import VRPProblem

    nodes = payload.get("nodes") or []
    if not nodes:
        raise ValueError("CVRP payload has no nodes.")
    capacity = capacity_override if capacity_override is not None else payload.get("capacity") or 0
    depot_id = payload.get("depot_id")
    if depot_id is None and nodes:
        depot_id = nodes[0]["id"]

    coords: dict[int, tuple[float, float]] = {}
    demands: dict[int, float] = {}
    for n in nodes:
        nid = int(n["id"])
        lat = float(n.get("lat", n.get("y", 0)))
        lon = float(n.get("lon", n.get("x", 0)))
        coords[nid] = (lat, lon)
        demands[nid] = float(n.get("demand", 0))

    return VRPProblem(
        dimension=len(nodes),
        capacity=int(capacity),
        coords=coords,
        demands=demands,
        depot=int(depot_id),
        name="dashboard",
        vehicle_capacities=vehicle_capacities,
        must_share_route=must_share_route,
    )


def _payload_to_nx_graph(payload: dict[str, Any]) -> Any:
    """Build NetworkX MultiGraph from AI CPP payload."""
    import networkx as nx

    G = nx.MultiGraph()
    for e in payload.get("edges") or []:
        u, v = int(e["u"]), int(e["v"])
        w = float(e.get("weight", 1.0))
        G.add_edge(u, v, weight=w)
    return G


def _is_eulerian(G: Any) -> bool:
    """True if every vertex has even degree (undirected)."""
    import networkx as nx
    return all(G.degree(n) % 2 == 0 for n in G.nodes())


# ---------------------------------------------------------------------------
# CVRP: run solver, metrics, and plot
# ---------------------------------------------------------------------------


def _run_cvrp_local(problem: Any, solver: str) -> tuple[list[list[int]], float]:
    """Run local CVRP solver; return (routes, solve_time_sec)."""
    from benchmark import clarke_wright_savings, two_opt

    t0 = time.perf_counter()
    routes = clarke_wright_savings(problem)
    if solver == "Clarke-Wright + 2-Opt":
        routes = two_opt(routes, problem.coords, problem.depot)
    elapsed = time.perf_counter() - t0
    return routes, elapsed


def _cvrp_metrics_local(problem: Any, routes: list[list[int]], solve_time_sec: float) -> dict[str, Any]:
    """Compute efficiency metrics for local solver (EUC_2D cost, route count, time)."""
    from benchmark import route_distance_euc2d

    total_cost = sum(route_distance_euc2d(r, problem.coords, problem.depot) for r in routes)
    return {
        "total_distance": total_cost,
        "num_routes": len(routes),
        "solve_time_sec": solve_time_sec,
    }


def _is_planar_coords(nodes: list[dict]) -> bool:
    """True if any node has |lat| > 90 or |lon| > 180 (likely planar EUC_2D, not WGS84)."""
    for n in nodes:
        lat = float(n.get("lat", n.get("y", 0)))
        lon = float(n.get("lon", n.get("x", 0)))
        if abs(lat) > 90 or abs(lon) > 180:
            return True
    return False


def _coords_dict_are_planar(coords: dict[int, tuple[float, float]]) -> bool:
    """True if any (lat, lon) in coords is outside WGS84 bounds (likely EUC_2D)."""
    for _nid, (lat, lon) in coords.items():
        if abs(lat) > 90 or abs(lon) > 180:
            return True
    return False


def _scale_coords_dict_to_wgs84(
    coords: dict[int, tuple[float, float]],
    center_lat: float = 45.5,
    center_lon: float = -73.6,
    span_deg: float = 0.1,
) -> dict[int, tuple[float, float]]:
    """
    Scale planar (x,y) coords dict to valid WGS84 so GPX is valid for map viewers and Android.
    coords: node_id -> (lat, lon). Returns new dict with same keys, scaled (lat, lon).
    """
    if not coords:
        return coords
    lats = [c[0] for c in coords.values()]
    lons = [c[1] for c in coords.values()]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    range_lat = max_lat - min_lat or 1.0
    range_lon = max_lon - min_lon or 1.0
    half = span_deg / 2.0
    out = {}
    for nid, (lat, lon) in coords.items():
        new_lat = center_lat - half + (lat - min_lat) / range_lat * span_deg
        new_lon = center_lon - half + (lon - min_lon) / range_lon * span_deg
        out[nid] = (new_lat, new_lon)
    return out


def _scale_planar_to_wgs84(nodes: list[dict], center_lat: float = 45.5, center_lon: float = -73.6, span_deg: float = 0.1) -> list[dict]:
    """
    Scale planar (x,y) coords into a small WGS84 box so backend Haversine and GPX are valid.
    Preserves relative positions; distances become roughly proportional for routing.
    """
    if not nodes:
        return nodes
    lats = [float(n.get("lat", n.get("y", 0))) for n in nodes]
    lons = [float(n.get("lon", n.get("x", 0))) for n in nodes]
    min_lat, max_lat = min(lats), max(lats)
    min_lon, max_lon = min(lons), max(lons)
    range_lat = max_lat - min_lat or 1.0
    range_lon = max_lon - min_lon or 1.0
    half = span_deg / 2.0
    out = []
    for n in nodes:
        lat = float(n.get("lat", n.get("y", 0)))
        lon = float(n.get("lon", n.get("x", 0)))
        # Map [min,max] -> [center - half, center + half]
        new_lat = center_lat - half + (lat - min_lat) / range_lat * span_deg
        new_lon = center_lon - half + (lon - min_lon) / range_lon * span_deg
        n = dict(n)
        n["lat"] = new_lat
        n["lon"] = new_lon
        out.append(n)
    return out


def _payload_to_vrp_request(
    payload: dict[str, Any],
    problem: Any,
    max_vehicles: int | None = None,
) -> dict[str, Any]:
    """Build JSON body for POST /api/vrp/solve (same schema as rmp.ca backend)."""
    nodes = payload.get("nodes") or []
    capacity = int(problem.capacity) if problem.capacity else 100
    depot_id = problem.depot
    # If coords look planar (e.g. CVRPLIB EUC_2D like Leuven1), scale to WGS84 so backend/GPX don't wrap the globe
    if _is_planar_coords(nodes):
        nodes = _scale_planar_to_wgs84(nodes)
    depot_node = next((n for n in nodes if int(n["id"]) == depot_id), nodes[0])
    depot_lat = float(depot_node.get("lat", depot_node.get("y", 0)))
    depot_lon = float(depot_node.get("lon", depot_node.get("x", 0)))
    total_demand = sum(int(n.get("demand", 0)) for n in nodes if int(n["id"]) != depot_id)
    num_vehicles = max(1, min(20, (total_demand // capacity) + 1)) if capacity else 10
    if max_vehicles is not None:
        num_vehicles = min(num_vehicles, max(1, max_vehicles))
    vehicle_caps = getattr(problem, "vehicle_capacities", None) or [capacity] * num_vehicles
    if not vehicle_caps or len(vehicle_caps) != num_vehicles:
        vehicle_caps = [capacity] * num_vehicles

    stops = [
        {
            "id": int(n["id"]),
            "location": {"lat": float(n.get("lat", n.get("y", 0))), "lon": float(n.get("lon", n.get("x", 0)))},
            "demand": [int(n.get("demand", 0))],
        }
        for n in nodes
        if int(n["id"]) != depot_id
    ]
    vehicles = [
        {
            "id": i + 1,
            "start_location": {"lat": depot_lat, "lon": depot_lon},
            "end_location": {"lat": depot_lat, "lon": depot_lon},
            "capacity": [vehicle_caps[i] if i < len(vehicle_caps) else capacity],
        }
        for i in range(num_vehicles)
    ]
    return {"stops": stops, "vehicles": vehicles, "use_time_windows": False}


def _run_cvrp_via_backend(
    problem: Any,
    payload: dict[str, Any],
    backend_url: str,
    max_vehicles: int | None = None,
) -> tuple[dict[str, Any] | None, float]:
    """POST to backend /api/vrp/solve; return (response_json, solve_time_sec). On error return (None, 0)."""
    url = backend_url.rstrip("/") + "/api/vrp/solve"
    body = _payload_to_vrp_request(payload, problem, max_vehicles=max_vehicles)
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            out = json.loads(resp.read().decode())
        elapsed = time.perf_counter() - t0
        return out, elapsed
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        return None, time.perf_counter() - t0


def _parse_vrplib_name_comment(raw_text: str) -> tuple[str | None, str | None]:
    """Parse VRPLIB-style NAME and COMMENT from raw file text (e.g. .vrp). Returns (name, comment)."""
    name_val: str | None = None
    comment_val: str | None = None
    for line in raw_text.splitlines()[:80]:
        line = line.strip()
        if not line or line.startswith("NODE_COORD") or line.startswith("DEMAND_") or line.startswith("DEPOT_"):
            continue
        if ":" in line:
            key, _, value = line.partition(":")
            key = key.strip().upper()
            value = value.strip()
            if key == "NAME":
                name_val = value or None
            elif key == "COMMENT":
                comment_val = value or None
    return (name_val, comment_val)


def _plot_cvrp_routes(
    problem: Any,
    routes: list[list[int]],
    instance_name: str | None = None,
    instance_comment: str | None = None,
) -> None:
    """Render CVRP routes with matplotlib into Streamlit. coords are (lat, lon)."""
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    coords = problem.coords
    depot = problem.depot
    # Plot: x = lon, y = lat
    dep_lat, dep_lon = coords[depot]
    ax.scatter([dep_lon], [dep_lat], marker="*", s=300, c="black", zorder=3, label="Depot")
    customers = [n for n in coords if n != depot]
    if customers:
        lons = [coords[n][1] for n in customers]
        lats = [coords[n][0] for n in customers]
        ax.scatter(lons, lats, c="gray", s=50, zorder=2, label="Customers")
    colors = plt.cm.tab10.colors
    for i, route in enumerate(routes):
        if not route:
            continue
        color = colors[i % len(colors)]
        path = [depot] + route + [depot]
        xs = [coords[n][1] for n in path]
        ys = [coords[n][0] for n in path]
        ax.plot(xs, ys, color=color, linewidth=2, label=f"Route {i + 1}")
    ax.legend(loc="best", fontsize=8)
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    title_parts = []
    if instance_name:
        title_parts.append(f"NAME : {instance_name}")
    if instance_comment:
        title_parts.append(f"COMMENT : {instance_comment}")
    if title_parts:
        fig.suptitle("\n".join(title_parts), fontsize=10, y=1.02)
    ax.set_title("CVRP Solution")
    ax.axis("equal")
    _pyplot_with_download(fig, filename="cvrp_routes.png", key="download_cvrp_routes")


def _cvrp_gpx_download(problem: Any, routes: list[list[int]], name: str = "routes") -> bytes | None:
    """
    Build GPX bytes for CVRP solution. If coords are planar (EUC_2D), scale to WGS84
    so the GPX is valid for map viewers, GPS devices, and Android (lat in [-90,90], lon in [-180,180]).
    """
    try:
        from benchmark import VRPProblem, cvrp_solution_to_gpx_segments
        from app.gpx_export import build_gpx
    except ImportError:
        return None
    # Use a problem with WGS84-scaled coords when source is planar so GPX is valid
    if _coords_dict_are_planar(problem.coords):
        scaled_coords = _scale_coords_dict_to_wgs84(problem.coords)
        problem = VRPProblem(
            dimension=problem.dimension,
            capacity=problem.capacity,
            coords=scaled_coords,
            demands=problem.demands,
            depot=problem.depot,
            name=problem.name,
        )
    segments = cvrp_solution_to_gpx_segments(problem, routes)
    if not segments:
        return None
    gpx_str = build_gpx(segments, creator="Universal Routing Tester", waypoints_only_from_tracks=False)
    return gpx_str.encode("utf-8")


def _plot_cvrp_from_backend_response(
    response: dict[str, Any],
    instance_name: str | None = None,
    instance_comment: str | None = None,
) -> None:
    """Render CVRP routes from backend VrpResponse (steps with lat/lon)."""
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    routes = response.get("routes") or []
    colors = plt.cm.tab10.colors
    all_lats, all_lons = [], []
    for i, route in enumerate(routes):
        steps = route.get("steps") or []
        if not steps:
            continue
        lats = [s["location"]["lat"] for s in steps]
        lons = [s["location"]["lon"] for s in steps]
        all_lats.extend(lats)
        all_lons.extend(lons)
        color = colors[i % len(colors)]
        ax.plot(lons, lats, color=color, linewidth=2, label=f"Vehicle {route.get('vehicle_id', i + 1)}")
    if all_lats:
        ax.scatter(all_lons, all_lats, c="gray", s=30, zorder=2, alpha=0.7)
    ax.legend(loc="best", fontsize=8)
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    title_parts = []
    if instance_name:
        title_parts.append(f"NAME : {instance_name}")
    if instance_comment:
        title_parts.append(f"COMMENT : {instance_comment}")
    if title_parts:
        fig.suptitle("\n".join(title_parts), fontsize=10, y=1.02)
    ax.set_title("CVRP Solution (Backend OR-Tools)")
    ax.axis("equal")
    _pyplot_with_download(fig, filename="cvrp_routes_backend.png", key="download_cvrp_backend")


def _cvrp_gpx_from_backend_response(response: dict[str, Any]) -> bytes | None:
    """Build GPX bytes from backend VrpResponse."""
    try:
        from app.gpx_export import Waypoint, RouteSegment, build_gpx
    except ImportError:
        return None
    segments = []
    for route in response.get("routes") or []:
        steps = route.get("steps") or []
        if not steps:
            continue
        waypoints = [
            Waypoint(s["location"]["lat"], s["location"]["lon"], name=f"Stop {s.get('id', i)}")
            for i, s in enumerate(steps)
        ]
        track = [(s["location"]["lat"], s["location"]["lon"]) for s in steps]
        segments.append(
            RouteSegment(track=track, waypoints=waypoints, name=f"Vehicle {route.get('vehicle_id', 0)}")
        )
    if not segments:
        return None
    gpx_str = build_gpx(segments, creator="Universal Routing Tester", waypoints_only_from_tracks=False)
    return gpx_str.encode("utf-8")


# ---------------------------------------------------------------------------
# CPP: Hierholzer and display
# ---------------------------------------------------------------------------


def _run_cpp_circuit(G: Any) -> list[tuple[Any, Any]]:
    """Run Hierholzer; return list of (u, v) edges in circuit order."""
    from app.hierholzer import eulerian_circuit_nx
    return eulerian_circuit_nx(G)


def _plot_cpp_circuit(G: Any, circuit: list[tuple[Any, Any]]) -> None:
    """Draw CPP graph and circuit with NetworkX/matplotlib."""
    import matplotlib.pyplot as plt
    import networkx as nx

    fig, ax = plt.subplots()
    pos = nx.spring_layout(G, seed=42)
    nx.draw_networkx_edges(G, pos, ax=ax, edge_color="lightgray", width=1)
    nx.draw_networkx_nodes(G, pos, ax=ax, node_color="lightblue", node_size=300)
    nx.draw_networkx_labels(G, pos, ax=ax, font_size=8)
    # Highlight circuit edges in order (first edge only for clarity)
    if circuit:
        nx.draw_networkx_edges(G, pos, edgelist=circuit, ax=ax, edge_color="green", width=2)
    ax.set_title("CPP: Eulerian circuit (green)")
    ax.axis("off")
    _pyplot_with_download(fig, filename="cpp_circuit.png", key="download_cpp_circuit")


# ---------------------------------------------------------------------------
# GPX drag-and-drop: parse and display
# ---------------------------------------------------------------------------

GPX_NS = "http://www.topografix.com/GPX/1/1"


def _parse_gpx(raw_bytes: bytes) -> tuple[list[tuple[float, float, str]], list[list[tuple[float, float]]]]:
    """
    Parse GPX XML; return (waypoints, tracks).
    waypoints: list of (lat, lon, name)
    tracks: list of segments, each segment = list of (lat, lon)
    """
    import xml.etree.ElementTree as ET

    root = ET.fromstring(raw_bytes)
    # GPX 1.1 uses this namespace; ElementTree stores it as {uri}tag
    wpt_tag = f"{{{GPX_NS}}}wpt"
    name_tag = f"{{{GPX_NS}}}name"
    trk_tag = f"{{{GPX_NS}}}trk"
    trkseg_tag = f"{{{GPX_NS}}}trkseg"
    trkpt_tag = f"{{{GPX_NS}}}trkpt"
    waypoints = []
    for wpt in root.iter(wpt_tag):
        lat = wpt.get("lat")
        lon = wpt.get("lon")
        if lat is not None and lon is not None:
            try:
                name_el = wpt.find(name_tag)
                name = (name_el.text or "").strip() if name_el is not None else ""
                waypoints.append((float(lat), float(lon), name))
            except ValueError:
                pass
    tracks = []
    for trk in root.iter(trk_tag):
        seg_points = []
        for trkseg in trk.findall(trkseg_tag):
            for trkpt in trkseg.findall(trkpt_tag):
                lat = trkpt.get("lat")
                lon = trkpt.get("lon")
                if lat is not None and lon is not None:
                    try:
                        seg_points.append((float(lat), float(lon)))
                    except ValueError:
                        pass
        if seg_points:
            tracks.append(seg_points)
    return waypoints, tracks


def _plot_gpx(waypoints: list[tuple[float, float, str]], tracks: list[list[tuple[float, float]]]) -> None:
    """Draw GPX waypoints and tracks on a map (matplotlib)."""
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    colors = plt.cm.tab10.colors
    for i, seg in enumerate(tracks):
        if not seg:
            continue
        lats, lons = [p[0] for p in seg], [p[1] for p in seg]
        ax.plot(lons, lats, color=colors[i % len(colors)], linewidth=2, label=f"Track {i + 1}")
    if waypoints:
        wpt_lats = [w[0] for w in waypoints]
        wpt_lons = [w[1] for w in waypoints]
        ax.scatter(wpt_lons, wpt_lats, c="red", s=80, zorder=3, marker="o", label="Waypoints")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.set_title("GPX route")
    ax.axis("equal")
    if waypoints or tracks:
        ax.legend(loc="best", fontsize=8)
    _pyplot_with_download(fig, filename="gpx_route.png", key="download_gpx_plot")


def _handle_gpx_upload(uploaded_file: Any) -> None:
    """Handle dropped GPX: parse and display waypoints, tracks, and a map."""
    raw = uploaded_file.read()
    try:
        waypoints, tracks = _parse_gpx(raw)
    except Exception as e:
        st.error(f"Could not parse GPX: {e}")
        return
    st.subheader("GPX: " + (uploaded_file.name or "route"))
    if waypoints:
        st.write("**Waypoints**")
        st.dataframe(
            [{"Lat": w[0], "Lon": w[1], "Name": w[2]} for w in waypoints],
            use_container_width=True,
            hide_index=True,
        )
    if tracks:
        total_pts = sum(len(seg) for seg in tracks)
        st.write(f"**Tracks:** {len(tracks)} segment(s), {total_pts} points")
    if not waypoints and not tracks:
        st.warning("No waypoints or tracks found in this GPX.")
        return
    _plot_gpx(waypoints, tracks)
    st.download_button(
        "Download GPX (same file)",
        data=raw,
        file_name=uploaded_file.name or "route.gpx",
        mime="application/gpx+xml",
        key="gpx_download",
    )


# ---------------------------------------------------------------------------
# Streamlit UI
# ---------------------------------------------------------------------------


def main() -> None:
    st.set_page_config(page_title="Universal Routing Algorithm Tester", layout="wide")
    st.title("Universal Routing Algorithm Tester")

    # Load persisted API key into session (survives refresh)
    persisted = _load_api_key_from_file()
    if "api_key_input" not in st.session_state:
        st.session_state.api_key_input = persisted.get("api_key") or ""
    if "api_provider_select" not in st.session_state:
        st.session_state.api_provider_select = persisted.get("provider") or "OpenAI"
    if "zai_base_url_input" not in st.session_state:
        st.session_state.zai_base_url_input = persisted.get("zai_base_url") or ""

    # Sidebar: Backend URL and API key
    with st.sidebar:
        st.subheader("AI API Key")
        st.caption("Used for parsing files (CVRP/CPP). Saved so it persists after refresh.")
        provider = st.selectbox(
            "Provider",
            options=["OpenAI", "ZAI"],
            key="api_provider_select",
            help="ZAI = OpenAI-compatible API (e.g. custom endpoint).",
        )
        api_key_value = st.text_input(
            "API Key",
            type="password",
            placeholder="sk-..." if provider == "OpenAI" else "Paste your API key",
            key="api_key_input",
            help="Your OpenAI or ZAI API key. Click Save to persist after refresh.",
        )
        zai_base_url = ""
        if provider == "ZAI":
            zai_base_url = st.text_input(
                "ZAI Base URL (optional)",
                placeholder="https://api.z.ai/v1",
                key="zai_base_url_input",
                help="Leave blank for default OpenAI endpoint.",
            )
        if st.button("Save key", key="save_api_key"):
            key_to_save = (api_key_value or "").strip()
            url_to_save = (zai_base_url or "").strip() if provider == "ZAI" else ""
            _save_api_key_to_file(provider, key_to_save, url_to_save)
            st.success("Key saved. It will persist after refresh.")
        st.divider()

        st.subheader("Backend (optional)")
        backend_url = st.text_input(
            "Backend URL",
            value=os.environ.get("BACKEND_URL", "http://localhost:8000"),
            help="rmp.ca backend base URL (e.g. http://localhost:8000). Enables OR-Tools (Backend) solver.",
        ).strip()
        if backend_url:
            st.caption("OR-Tools will be available in the solver dropdown.")

        st.divider()
        st.subheader("Configuration")
        st.caption("CVRP parameters. Keeps the Routes map uncluttered.")
        with st.expander("Vehicle & solver settings", expanded=False):
            config_vehicle_count = st.slider(
                "Vehicle count",
                min_value=1,
                max_value=10,
                value=5,
                key="config_vehicle_count",
                help="Max number of vehicles (e.g. 1–10).",
            )
            config_vehicle_capacity = st.number_input(
                "Vehicle capacity",
                min_value=1,
                value=100,
                step=1,
                key="config_vehicle_capacity",
                help="CVRP capacity per vehicle (units). Used when file has no capacity.",
            )
            solver_options = ["Clarke-Wright + 2-Opt"]
            if backend_url:
                solver_options.append("OR-Tools (Backend)")
            config_solver = st.selectbox(
                "Optimization strategy",
                options=solver_options,
                key="config_solver",
                help="Solver algorithm.",
            )
            config_prioritize_distance = st.toggle(
                "Prioritize distance (vs. time)",
                value=True,
                key="config_prioritize_distance",
                help="Optimize for total distance. Turn off for time-based (when supported).",
            )
            config_allow_route_overlap = st.toggle(
                "Allow route overlap (stress test)",
                value=False,
                key="config_allow_route_overlap",
                help="Force selected customer pairs onto the same route to test 2-Opt.",
            )
            config_route_overlap_pairs = ""
            if config_allow_route_overlap:
                config_route_overlap_pairs = st.text_input(
                    "Force same route (pairs)",
                    placeholder="e.g. 5,12  7,9",
                    key="config_route_overlap_pairs",
                    help="Comma-separated pairs or space-separated: 5,12 7,9",
                )

        st.divider()
        with st.expander("Planned features (next round of testing)", expanded=False):
            st.markdown("""
**Time windows**  
The current GPX does not include `<time>` tags on waypoints. To support **service time constraints** (e.g. *"Customer 38 must be visited before 10 AM"*), time windows need to be added to the data model and reflected in the solver and GPX export.

**Capacity variation**  
This is a CVRP solver; testing with **different vehicle sizes** (e.g. Vehicle 1 capacity 50, Vehicle 3 capacity 10) will help find bugs in allocation logic and ensure larger/smaller trucks are assigned correctly.

**Route overlap**  
Solutions today often look like clean "petals" (radial routes). A good stress test is to **force two customers from opposite sides of the city onto one route** and check that the 2-Opt algorithm still produces a sensible path without tangled crossings.
            """)

    # API key: from sidebar (persisted) or environment
    dashboard_key = (api_key_value or "").strip()
    has_ai_key = (
        bool(dashboard_key)
        or os.environ.get("VERCEL_AI_GATEWAY_API_KEY")
        or os.environ.get("AI_GATEWAY_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
    )
    if not has_ai_key:
        st.warning(
            "Enter an **OpenAI** or **ZAI** API key in the sidebar (and click Save to persist after refresh), "
            "or set an env var. Without it, you can still upload files and see a preview."
        )

    uploaded_file = st.file_uploader(
        "Drop any routing data file here",
        type=["vrp", "txt", "csv", "json", "gpx"],
        help=".vrp (CVRPLIB), .csv, .txt (edge list), .json, or .gpx (view waypoints and track)",
    )

    if not uploaded_file:
        st.info("Upload a file to classify and solve, or drop a GPX to view it.")
        return

    is_gpx = uploaded_file.name and uploaded_file.name.lower().endswith(".gpx")
    if is_gpx:
        _handle_gpx_upload(uploaded_file)
        return

    raw_text = uploaded_file.read().decode("utf-8", errors="replace")
    preview = raw_text[:500] + ("..." if len(raw_text) > 500 else "")
    st.text_area("File Preview", preview, height=120)

    # First ~100 lines for AI
    lines = raw_text.splitlines()[:100]
    text_for_ai = "\n".join(lines)

    # Persist parsed payload so capacity fallback can run on next click; clear when file changes
    file_id = (uploaded_file.name, uploaded_file.size)
    if "parsed_payload" not in st.session_state:
        st.session_state.parsed_payload = None
        st.session_state.parsed_file_id = None
    if st.session_state.get("parsed_file_id") != file_id:
        st.session_state.parsed_payload = None
        st.session_state.parsed_file_id = file_id

    if st.button("Parse and solve"):
        if not text_for_ai.strip():
            st.error("File is empty.")
            return
        if not has_ai_key:
            st.error("Cannot parse: no API key set.")
            return

        with st.spinner("AI Gatekeeper is classifying and extracting..."):
            key_override = dashboard_key or None
            base_override = (zai_base_url or "").strip() if provider == "ZAI" else None
            payload = _get_parsed_payload(text_for_ai, api_key_override=key_override, api_base_url_override=base_override)
        if payload is None:
            return
        st.session_state.parsed_payload = payload
        st.session_state.parsed_file_id = file_id

    payload = st.session_state.parsed_payload
    if payload is not None:
        problem_type = payload.get("type")

        if problem_type == "CVRP":
            capacity = payload.get("capacity") or 0
            capacity_override = config_vehicle_capacity if not capacity else None
            must_share_route: list[tuple[int, int]] = []
            if config_allow_route_overlap and (config_route_overlap_pairs or "").strip():
                for part in (config_route_overlap_pairs or "").split():
                    tokens = [x.strip() for x in part.split(",") if x.strip()]
                    if len(tokens) >= 2:
                        try:
                            must_share_route.append((int(tokens[0]), int(tokens[1])))
                        except ValueError:
                            pass
            try:
                problem = _payload_to_vrp_problem(
                    payload,
                    capacity_override=capacity_override,
                    must_share_route=must_share_route if must_share_route else None,
                )
            except Exception as e:
                st.error(f"Invalid CVRP data: {e}")
            else:
                solver = config_solver
                use_backend = solver == "OR-Tools (Backend)" and bool(backend_url)
                if use_backend and _is_planar_coords(payload.get("nodes") or []):
                    st.info("Coordinates are planar (EUC_2D, e.g. CVRPLIB). Scaled to WGS84 for the backend so the route and GPX display correctly.")
                with st.spinner("Solving CVRP..."):
                    if use_backend:
                        backend_resp, solve_time_sec = _run_cvrp_via_backend(
                            problem,
                            payload,
                            backend_url,
                            max_vehicles=config_vehicle_count,
                        )
                        routes = None
                        if backend_resp is None:
                            st.error("Backend request failed. Is the server running? Check Backend URL in the sidebar.")
                        else:
                            total_dist = backend_resp.get("total_distance", 0)
                            num_routes = len(backend_resp.get("routes") or [])
                            st.subheader("Solver efficiency")
                            col1, col2, col3 = st.columns(3)
                            with col1:
                                st.metric("Total distance", f"{total_dist:,}" if isinstance(total_dist, int) else total_dist)
                            with col2:
                                st.metric("Routes", num_routes)
                            with col3:
                                st.metric("Solve time", f"{solve_time_sec:.2f} s")
                            st.subheader("Routes")
                            instance_name, instance_comment = _parse_vrplib_name_comment(raw_text)
                            _plot_cvrp_from_backend_response(
                                backend_resp,
                                instance_name=instance_name,
                                instance_comment=instance_comment,
                            )
                            gpx_bytes = _cvrp_gpx_from_backend_response(backend_resp)
                            if gpx_bytes:
                                st.download_button("Download GPX", data=gpx_bytes, file_name="routes.gpx", mime="application/gpx+xml")
                    else:
                        routes, solve_time_sec = _run_cvrp_local(problem, solver)
                        metrics = _cvrp_metrics_local(problem, routes, solve_time_sec)
                        st.subheader("Solver efficiency")
                        col1, col2, col3 = st.columns(3)
                        with col1:
                            st.metric("Total distance (EUC_2D)", metrics["total_distance"])
                        with col2:
                            st.metric("Routes", metrics["num_routes"])
                        with col3:
                            st.metric("Solve time", f"{metrics['solve_time_sec']:.2f} s")
                        st.subheader("Routes")
                        instance_name, instance_comment = _parse_vrplib_name_comment(raw_text)
                        _plot_cvrp_routes(
                            problem,
                            routes,
                            instance_name=instance_name,
                            instance_comment=instance_comment,
                        )
                        gpx_bytes = _cvrp_gpx_download(problem, routes, name=uploaded_file.name or "routes")
                        if gpx_bytes:
                            st.download_button("Download GPX", data=gpx_bytes, file_name="routes.gpx", mime="application/gpx+xml")
                            if _coords_dict_are_planar(problem.coords):
                                st.caption("EUC_2D coordinates were scaled to WGS84 in the GPX so it works in map viewers and on Android.")
            return

        if problem_type == "CPP":
            try:
                G = _payload_to_nx_graph(payload)
            except Exception as e:
                st.error(f"Invalid CPP data: {e}")
                return
            if G.number_of_nodes() == 0:
                st.error("No edges in CPP payload.")
                return
            if not _is_eulerian(G):
                odd = [n for n in G.nodes() if G.degree(n) % 2 != 0]
                st.error(
                    f"Graph is not Eulerian (odd-degree vertices: {odd}). "
                    "Add edges so every vertex has even degree, or use a post-processing step (future)."
                )
                return
            with st.spinner("Running Hierholzer..."):
                circuit = _run_cpp_circuit(G)
            st.subheader("Eulerian circuit")
            st.text(" → ".join(str(u) for u, _ in circuit) + f" → {circuit[0][0]}" if circuit else "(empty)")
            _plot_cpp_circuit(G, circuit)
            return

        st.error("Unknown problem type from AI. Expected CVRP or CPP.")
        return


if __name__ == "__main__":
    main()
