#!/usr/bin/env python3
"""
Convert OSM XML to GeoJSON using ogr2ogr (GDAL), with optional geometry repair.

Usage:
  python -m scripts.osm_to_geojson input.osm output.json
  python -m scripts.osm_to_geojson input.osm output.json --no-makevalid

Requires: ogr2ogr on PATH (install GDAL: conda install gdal, or system package).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Convert OSM XML to GeoJSON using ogr2ogr (GDAL). Optionally run makevalid."
    )
    ap.add_argument("input", type=Path, help="Input OSM file (.osm or .pbf)")
    ap.add_argument("output", type=Path, help="Output GeoJSON file (.json or .geojson)")
    ap.add_argument(
        "--no-makevalid",
        action="store_true",
        help="Skip -makevalid (faster; use if data is already valid)",
    )
    ap.add_argument(
        "--layer",
        type=str,
        default="lines",
        help="OGR layer name (default: lines). Use 'points' or 'multipolygons' for other geometry.",
    )
    args = ap.parse_args()

    ogr2ogr = shutil.which("ogr2ogr")
    if not ogr2ogr:
        print("ogr2ogr not found. Install GDAL (e.g. conda install gdal).", file=sys.stderr)
        return 1

    if not args.input.exists():
        print(f"Input file not found: {args.input}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)

    cmd = [ogr2ogr]
    if not args.no_makevalid:
        cmd.append("-makevalid")
    cmd.extend(["-f", "GeoJSON", str(args.output), str(args.input), args.layer])

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"ogr2ogr failed: {e}", file=sys.stderr)
        return 1

    print(f"Wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
