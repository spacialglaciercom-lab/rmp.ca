"""
GPX export tests.

Covers:
  - Waypoint and RouteSegment data classes
  - build_gpx produces valid GPX 1.1 XML
  - Waypoints emitted as <wpt> elements with correct lat/lon/name/comment
  - Tracks emitted as <trk><trkseg><trkpt> with correct coordinates
  - waypoints_only_from_tracks suppresses <wpt> elements
  - Multiple segments produce multiple tracks
  - cpp_solution_to_gpx_segments converts NetworkX graph correctly
  - Empty / edge-case inputs handled gracefully
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import networkx as nx
import pytest

from app.gpx_export import Waypoint, RouteSegment, build_gpx

# Import the CPP GPX converter from optimize (where it's actually defined)
from app.optimize import cpp_solution_to_gpx_segments


GPX_NS = "http://www.topografix.com/GPX/1/1"


def _parse_gpx(gpx_str: str) -> ET.Element:
    """Parse GPX string, stripping duplicate xmlns attributes that build_gpx emits."""
    # build_gpx sets xmlns both via Element attrib and register_namespace,
    # producing duplicate xmlns="..." which is invalid XML.  Strip the first
    # occurrence so the parser accepts it.
    gpx_str = re.sub(
        r'(xmlns="[^"]*")\s+(.*?)\1',
        r'\1 \2',
        gpx_str,
    )
    return ET.fromstring(gpx_str)


def _find_all(root: ET.Element, tag: str) -> list[ET.Element]:
    """Find all elements with given tag in GPX namespace."""
    return root.findall(f"{{{GPX_NS}}}{tag}")


def _find(root: ET.Element, tag: str) -> ET.Element | None:
    return root.find(f"{{{GPX_NS}}}{tag}")


# ---------------------------------------------------------------------------
# Waypoint data class
# ---------------------------------------------------------------------------


class TestWaypoint:
    def test_basic_construction(self):
        w = Waypoint(45.5, -73.6)
        assert w.lat == 45.5
        assert w.lon == -73.6
        assert w.name is None
        assert w.comment is None
        assert w.time_iso is None

    def test_named_waypoint(self):
        w = Waypoint(45.5, -73.6, name="Depot", comment="Start here")
        assert w.name == "Depot"
        assert w.comment == "Start here"

    def test_with_time(self):
        w = Waypoint(45.5, -73.6, time_iso="2025-03-13T10:00:00Z")
        assert w.time_iso == "2025-03-13T10:00:00Z"


# ---------------------------------------------------------------------------
# RouteSegment data class
# ---------------------------------------------------------------------------


class TestRouteSegment:
    def test_basic_construction(self):
        seg = RouteSegment(track=[(45.5, -73.6), (45.6, -73.7)])
        assert len(seg.track) == 2
        assert seg.waypoints == []
        assert seg.name is None

    def test_with_waypoints_and_name(self):
        wpts = [Waypoint(45.5, -73.6, name="A")]
        seg = RouteSegment(
            track=[(45.5, -73.6), (45.6, -73.7)],
            waypoints=wpts,
            name="Route 1",
        )
        assert len(seg.waypoints) == 1
        assert seg.name == "Route 1"

    def test_track_is_copied(self):
        original = [(45.5, -73.6)]
        seg = RouteSegment(track=original)
        original.append((45.6, -73.7))
        assert len(seg.track) == 1  # not affected by mutation


# ---------------------------------------------------------------------------
# build_gpx: structure and validity
# ---------------------------------------------------------------------------


class TestBuildGpx:
    def test_empty_routes(self):
        gpx_str = build_gpx([])
        assert '<?xml version="1.0"' in gpx_str
        root = _parse_gpx(gpx_str)
        assert root.attrib["version"] == "1.1"

    def test_xml_declaration(self):
        gpx_str = build_gpx([])
        assert gpx_str.startswith('<?xml version="1.0" encoding="UTF-8"?>')

    def test_creator_attribute(self):
        gpx_str = build_gpx([], creator="TestApp")
        root = _parse_gpx(gpx_str)
        assert root.attrib["creator"] == "TestApp"

    def test_default_creator(self):
        gpx_str = build_gpx([])
        root = _parse_gpx(gpx_str)
        assert root.attrib["creator"] == "RouteMasterPro"

    def test_single_track_no_waypoints(self):
        seg = RouteSegment(track=[(45.5, -73.6), (45.6, -73.7)])
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        tracks = _find_all(root, "trk")
        assert len(tracks) == 1
        trksegs = tracks[0].findall(f"{{{GPX_NS}}}trkseg")
        assert len(trksegs) == 1
        trkpts = trksegs[0].findall(f"{{{GPX_NS}}}trkpt")
        assert len(trkpts) == 2

    def test_track_point_coordinates(self):
        seg = RouteSegment(track=[(45.512345, -73.678901)])
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        trkpt = root.find(f".//{{{GPX_NS}}}trkpt")
        assert trkpt is not None
        assert trkpt.attrib["lat"] == "45.512345"
        assert trkpt.attrib["lon"] == "-73.678901"

    def test_waypoints_emitted(self):
        wpts = [
            Waypoint(45.5, -73.6, name="Stop A"),
            Waypoint(45.6, -73.7, name="Stop B"),
        ]
        seg = RouteSegment(track=[(45.5, -73.6)], waypoints=wpts)
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        wpt_elems = _find_all(root, "wpt")
        assert len(wpt_elems) == 2
        names = [w.find(f"{{{GPX_NS}}}name").text for w in wpt_elems]
        assert "Stop A" in names
        assert "Stop B" in names

    def test_waypoint_comment(self):
        wpts = [Waypoint(45.5, -73.6, name="A", comment="Important stop")]
        seg = RouteSegment(track=[(45.5, -73.6)], waypoints=wpts)
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        wpt = _find_all(root, "wpt")[0]
        cmt = wpt.find(f"{{{GPX_NS}}}cmt")
        assert cmt is not None
        assert cmt.text == "Important stop"

    def test_waypoint_time(self):
        wpts = [Waypoint(45.5, -73.6, time_iso="2025-03-13T10:00:00Z")]
        seg = RouteSegment(track=[(45.5, -73.6)], waypoints=wpts)
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        wpt = _find_all(root, "wpt")[0]
        time_el = wpt.find(f"{{{GPX_NS}}}time")
        assert time_el is not None
        assert time_el.text == "2025-03-13T10:00:00Z"

    def test_waypoints_only_from_tracks_suppresses_wpt(self):
        wpts = [Waypoint(45.5, -73.6, name="A")]
        seg = RouteSegment(track=[(45.5, -73.6)], waypoints=wpts)
        gpx_str = build_gpx([seg], waypoints_only_from_tracks=True)
        root = _parse_gpx(gpx_str)

        assert len(_find_all(root, "wpt")) == 0
        # Track still present
        assert len(_find_all(root, "trk")) == 1

    def test_track_name(self):
        seg = RouteSegment(track=[(45.5, -73.6)], name="Vehicle 1")
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        trk = _find_all(root, "trk")[0]
        name_el = trk.find(f"{{{GPX_NS}}}name")
        assert name_el is not None
        assert name_el.text == "Vehicle 1"

    def test_multiple_segments(self):
        seg1 = RouteSegment(track=[(45.5, -73.6)], name="Route A")
        seg2 = RouteSegment(track=[(45.7, -73.8)], name="Route B")
        gpx_str = build_gpx([seg1, seg2])
        root = _parse_gpx(gpx_str)

        tracks = _find_all(root, "trk")
        assert len(tracks) == 2

    def test_coordinate_precision_six_decimals(self):
        seg = RouteSegment(track=[(45.1234567890, -73.9876543210)])
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        trkpt = root.find(f".//{{{GPX_NS}}}trkpt")
        # Should be 6 decimal places
        assert trkpt.attrib["lat"] == "45.123457"
        assert trkpt.attrib["lon"] == "-73.987654"

    def test_segment_with_empty_track(self):
        seg = RouteSegment(track=[], waypoints=[Waypoint(45.5, -73.6, name="X")])
        gpx_str = build_gpx([seg])
        root = _parse_gpx(gpx_str)

        # No track element when track is empty
        assert len(_find_all(root, "trk")) == 0
        # Waypoint still emitted
        assert len(_find_all(root, "wpt")) == 1


# ---------------------------------------------------------------------------
# cpp_solution_to_gpx_segments (from optimize.py)
# ---------------------------------------------------------------------------


def _make_graph(*nodes_with_coords, edges=None):
    """Build a simple NetworkX graph with lat/lon node attributes."""
    G = nx.MultiGraph()
    for node_id, lat, lon in nodes_with_coords:
        G.add_node(node_id, lat=lat, lon=lon)
    if edges:
        for u, v in edges:
            G.add_edge(u, v)
    return G


class TestCppSolutionToGpxSegments:
    def test_empty_route(self):
        G = _make_graph((1, 45.5, -73.6))
        result = cpp_solution_to_gpx_segments(G, [])
        assert result == []

    def test_single_node_route(self):
        G = _make_graph((1, 45.5, -73.6))
        segments = cpp_solution_to_gpx_segments(G, [1])
        assert len(segments) == 1
        assert len(segments[0].track) == 1
        assert segments[0].track[0] == (45.5, -73.6)

    def test_two_node_route(self):
        G = _make_graph(
            (1, 45.5, -73.6),
            (2, 45.6, -73.7),
        )
        segments = cpp_solution_to_gpx_segments(G, [1, 2, 1])
        assert len(segments) == 1
        seg = segments[0]
        assert len(seg.track) == 3
        assert seg.track[0] == (45.5, -73.6)
        assert seg.track[1] == (45.6, -73.7)
        assert seg.track[2] == (45.5, -73.6)

    def test_waypoints_unique_nodes(self):
        """Waypoints should only include unique nodes even if route revisits."""
        G = _make_graph(
            (1, 45.5, -73.6),
            (2, 45.6, -73.7),
        )
        segments = cpp_solution_to_gpx_segments(G, [1, 2, 1])
        assert len(segments[0].waypoints) == 2  # only 2 unique nodes

    def test_segment_name(self):
        G = _make_graph((1, 45.5, -73.6))
        segments = cpp_solution_to_gpx_segments(G, [1])
        assert segments[0].name == "Eulerian Circuit"

    def test_waypoint_names(self):
        G = _make_graph(
            (1, 45.5, -73.6),
            (2, 45.6, -73.7),
        )
        segments = cpp_solution_to_gpx_segments(G, [1, 2])
        names = [w.name for w in segments[0].waypoints]
        assert "Node 1" in names
        assert "Node 2" in names

    def test_produces_valid_gpx(self):
        """End-to-end: segments → build_gpx → valid XML."""
        G = _make_graph(
            (1, 45.5, -73.6),
            (2, 45.6, -73.7),
            (3, 45.7, -73.8),
        )
        segments = cpp_solution_to_gpx_segments(G, [1, 2, 3, 1])
        gpx_str = build_gpx(segments)

        root = _parse_gpx(gpx_str)
        assert root.attrib["version"] == "1.1"

        # Check waypoints
        wpts = _find_all(root, "wpt")
        assert len(wpts) == 3

        # Check track points
        trkpts = root.findall(f".//{{{GPX_NS}}}trkpt")
        assert len(trkpts) == 4

    def test_node_missing_from_graph(self):
        """Nodes not in graph are skipped gracefully."""
        G = _make_graph((1, 45.5, -73.6))
        segments = cpp_solution_to_gpx_segments(G, [1, 999, 1])
        seg = segments[0]
        # Node 999 missing from graph → skipped in track and waypoints
        assert len(seg.track) == 2  # only node 1 appears twice
        assert len(seg.waypoints) == 1  # only node 1

    def test_default_coords_when_missing_attrs(self):
        """Nodes without lat/lon attrs get default 0."""
        G = nx.MultiGraph()
        G.add_node(1)  # no lat/lon
        segments = cpp_solution_to_gpx_segments(G, [1])
        assert segments[0].track[0] == (0, 0)
