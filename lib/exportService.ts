/**
 * Export Service for OSM Data
 * Generate GeoJSON, CSV, and valid OSM 0.6 XML exports and share via expo-sharing.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { GeoJSONFeature, OverpassElement } from "./overpassService";
import type { OverpassCounts } from "./overpassService";

export interface OSMBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export function toGeoJSON(features: GeoJSONFeature[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features,
  };
}

function getCoordinates(feature: GeoJSONFeature): number[] {
  const geom = feature.geometry;
  if (!geom) return [];

  switch (geom.type) {
    case "Point":
      return geom.coordinates as number[];
    case "LineString":
      return (geom.coordinates as number[][])[0] ?? [];
    case "Polygon":
      return ((geom.coordinates as number[][][])[0] ?? [])[0] ?? [];
    default:
      return [];
  }
}

/**
 * Convert features to CSV
 */
export function toCSV(features: GeoJSONFeature[]): string {
  if (features.length === 0) return "";

  const allKeys = new Set<string>();
  features.forEach((f) => {
    Object.keys(f.properties ?? {}).forEach((k) => allKeys.add(k));
  });
  const keys = ["id", "type", "longitude", "latitude", ...Array.from(allKeys)];
  const rows = [keys.join(",")];

  features.forEach((feature) => {
    const coords = getCoordinates(feature);
    const row = keys.map((k) => {
      let value: string | number;
      switch (k) {
        case "id":
          value = feature.id ?? "";
          break;
        case "type":
          value = feature.geometry?.type ?? "";
          break;
        case "longitude":
          value = coords[0] ?? "";
          break;
        case "latitude":
          value = coords[1] ?? "";
          break;
        default:
          value = (feature.properties as Record<string, unknown>)?.[k] ?? "";
      }
      if (
        typeof value === "string" &&
        (value.includes(",") || value.includes('"'))
      ) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    rows.push(row.join(","));
  });

  return rows.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convert raw Overpass elements to valid OSM 0.6 XML (for use with OSM parsers / route optimizer).
 */
export function toOSMXML(
  rawElements: OverpassElement[],
  bounds: OSMBounds
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="RouteMasterPro OSM Extractor">',
    `  <bounds minlat="${bounds.minLat}" minlon="${bounds.minLon}" maxlat="${bounds.maxLat}" maxlon="${bounds.maxLon}"/>`,
  ];

  const nodes = rawElements.filter((el) => el.type === "node");
  const ways = rawElements.filter((el) => el.type === "way");

  for (const n of nodes) {
    if (n.lat == null || n.lon == null) continue;
    const lat = Number(n.lat).toFixed(7);
    const lon = Number(n.lon).toFixed(7);
    if (!n.tags || Object.keys(n.tags).length === 0) {
      lines.push(`  <node id="${n.id}" lat="${lat}" lon="${lon}"/>`);
    } else {
      lines.push(`  <node id="${n.id}" lat="${lat}" lon="${lon}">`);
      for (const [k, v] of Object.entries(n.tags)) {
        if (v == null) continue;
        lines.push(`    <tag k="${escapeXml(k)}" v="${escapeXml(String(v))}"/>`);
      }
      lines.push("  </node>");
    }
  }

  for (const w of ways) {
    if (!w.nodes || w.nodes.length < 2) continue;
    lines.push(`  <way id="${w.id}">`);
    for (const ref of w.nodes) {
      lines.push(`    <nd ref="${ref}"/>`);
    }
    if (w.tags) {
      for (const [k, v] of Object.entries(w.tags)) {
        if (v == null) continue;
        lines.push(`    <tag k="${escapeXml(k)}" v="${escapeXml(String(v))}"/>`);
      }
    }
    lines.push("  </way>");
  }

  lines.push("</osm>");
  return lines.join("\n");
}

/**
 * Share OSM XML file (valid 0.6 format for parsers and external tools).
 */
export async function shareOSM(
  rawElements: OverpassElement[],
  bounds: OSMBounds,
  filename = "osm-export"
): Promise<string> {
  const content = toOSMXML(rawElements, bounds);
  const filePath = `${FileSystem.cacheDirectory}${filename}.osm`;

  await FileSystem.writeAsStringAsync(filePath, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: "application/xml",
      dialogTitle: "Share OSM file",
    });
  }

  return filePath;
}

/**
 * Share GeoJSON file
 */
export async function shareGeoJSON(
  features: GeoJSONFeature[],
  filename = "osm-export"
): Promise<string> {
  const geojson = toGeoJSON(features);
  const content = JSON.stringify(geojson, null, 2);
  const filePath = `${FileSystem.cacheDirectory}${filename}.geojson`;

  await FileSystem.writeAsStringAsync(filePath, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: "application/geo+json",
      dialogTitle: "Share GeoJSON",
    });
  }

  return filePath;
}

/**
 * Share CSV file
 */
export async function shareCSV(
  features: GeoJSONFeature[],
  filename = "osm-export"
): Promise<string> {
  const content = toCSV(features);
  const filePath = `${FileSystem.cacheDirectory}${filename}.csv`;

  await FileSystem.writeAsStringAsync(filePath, content, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, {
      mimeType: "text/csv",
      dialogTitle: "Share CSV",
    });
  }

  return filePath;
}

/**
 * Generate summary text
 */
export function generateSummary(counts: OverpassCounts, area: number): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return `
OSM Data Extraction Summary
==========================
Area: ${area.toFixed(3)} km²
Total Features: ${total}

Breakdown:
• Roads: ${counts.roads}
• Buildings: ${counts.buildings}
• POIs/Amenities: ${counts.amenities}
• Natural: ${counts.natural}
• Waterways: ${counts.waterways}
• Land Use: ${counts.landuse}
  `.trim();
}
