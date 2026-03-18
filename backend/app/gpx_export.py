"""
GPX 1.1 export for CVRP/CPP route outputs.

Uses only the standard library (xml.etree.ElementTree). Produces:
- <wpt> for each stop or key decision point
- <trk> with <trkseg> per vehicle/segment, each <trkpt> for path points

Coordinates must be WGS84 (decimal degrees). Suitable for offline file handoff
and consumption by native mobile (e.g. Android Intent filter) or third-party viewers.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Sequence


GPX_NS = "http://www.topografix.com/GPX/1/1"

def _tag(tag: str) -> str:
    """Full element name for GPX 1.1 namespace."""
    return f"{{{GPX_NS}}}{tag}"


def build_gpx(
    routes: Sequence[RouteSegment],
    *,
    creator: str = "RouteMasterPro",
    waypoints_only_from_tracks: bool = False,
) -> str:
    """
    Build a GPX 1.1 document from a list of route segments.

    Args:
        routes: One segment per vehicle (CVRP) or logical path (CPP). Each segment
            has waypoints (named stops) and track (ordered path points).
        creator: Value for the GPX creator attribute.
        waypoints_only_from_tracks: If True, do not emit a separate <wpt> section;
            waypoints are implied by track points. If False, emit <wpt> for each
            named waypoint in each segment.

    Returns:
        GPX 1.1 XML string (UTF-8).
    """
    root = ET.Element(_tag("gpx"), attrib={
        "version": "1.1",
        "creator": creator,
        "xmlns": GPX_NS,
    })
    root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")
    root.set(
        "xsi:schemaLocation",
        f"{GPX_NS} {GPX_NS}/gpx.xsd"
    )

    for seg in routes:
        if not waypoints_only_from_tracks and seg.waypoints:
            for wpt in seg.waypoints:
                el = ET.SubElement(root, _tag("wpt"), lat=_str6(wpt.lat), lon=_str6(wpt.lon))
                if wpt.name:
                    name_el = ET.SubElement(el, _tag("name"))
                    name_el.text = wpt.name
                if wpt.comment:
                    cmt_el = ET.SubElement(el, _tag("cmt"))
                    cmt_el.text = wpt.comment
                if getattr(wpt, "time_iso", None):
                    time_el = ET.SubElement(el, _tag("time"))
                    time_el.text = wpt.time_iso

        if seg.track:
            trk = ET.SubElement(root, _tag("trk"))
            if seg.name:
                name_el = ET.SubElement(trk, _tag("name"))
                name_el.text = seg.name
            trkseg = ET.SubElement(trk, _tag("trkseg"))
            for pt in seg.track:
                lat, lon = pt[0], pt[1]
                ET.SubElement(trkseg, _tag("trkpt"), lat=_str6(lat), lon=_str6(lon))

    return _serialize(root)


def _str6(val: float) -> str:
    """Format coordinate to 6 decimal places (WGS84 sufficient precision)."""
    return f"{float(val):.6f}"


def _serialize(root: ET.Element) -> str:
    """Serialize to XML string with declaration. Uses default namespace (no prefix) for maximum app compatibility."""
    # Register empty prefix so output is <gpx xmlns="..."> and <wpt>, <trk> instead of <ns0:gpx>, <ns0:wpt>
    ET.register_namespace("", GPX_NS)
    tree = ET.ElementTree(root)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ", level=0)
    raw = ET.tostring(root, encoding="unicode", method="xml")
    # Strip any remaining namespace prefix (e.g. ns0:) so parsers that expect unprefixed GPX work
    for prefix in ("ns0:", "ns1:", "gpx:"):
        if prefix in raw:
            raw = raw.replace(prefix, "")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + raw


# ---------------------------------------------------------------------------
# Data structures (backend-agnostic; VRP/CPP adapters build these)
# ---------------------------------------------------------------------------


class Waypoint:
    """A named point (stop or key decision point). Optional time_iso for GPX <time> (e.g. "2025-03-13T10:00:00Z")."""

    __slots__ = ("lat", "lon", "name", "comment", "time_iso")

    def __init__(
        self,
        lat: float,
        lon: float,
        name: str | None = None,
        comment: str | None = None,
        time_iso: str | None = None,
    ):
        self.lat = lat
        self.lon = lon
        self.name = name
        self.comment = comment
        self.time_iso = time_iso


class RouteSegment:
    """
    One track (e.g. one vehicle route) with optional named waypoints.

    - waypoints: Stops or key points to show as markers (emitted as <wpt>).
    - track: Ordered path for polyline (emitted as <trk><trkseg><trkpt>...).
    - name: Optional label for the track (e.g. "Vehicle 1").
    """

    __slots__ = ("waypoints", "track", "name")

    def __init__(
        self,
        track: Sequence[tuple[float, float]],
        waypoints: Sequence[Waypoint] | None = None,
        name: str | None = None,
    ):
        self.track = list(track)  # list of (lat, lon) for <trkpt>
        self.waypoints = list(waypoints) if waypoints else []
        self.name = name
