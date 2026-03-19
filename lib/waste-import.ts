/**
 * Parse CSV or GeoJSON for waste points (bins/dumpsters) import.
 */

import type { WastePointType, WastePointCondition } from "@/types";

export interface WasteImportRow {
  lat?: number;
  lon?: number;
  type: WastePointType;
  capacityLiters?: number;
  condition?: WastePointCondition;
  address?: string;
}

function normalizeType(s: string): WastePointType {
  const t = (s || "").trim().toLowerCase();
  if (t === "dumpster" || t === "d") return "dumpster";
  return "bin";
}

function normalizeCondition(s: string): WastePointCondition | undefined {
  const c = (s || "").trim().toLowerCase();
  if (c === "good" || c === "overflowing" || c === "damaged") return c;
  return undefined;
}

/**
 * Parse a CSV line into cells, handling quoted values properly.
 * Supports double-quoted fields with embedded commas/semicolons.
 */
function parseCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Detect the CSV delimiter (comma, semicolon, or tab).
 */
function detectDelimiter(headerLine: string): string {
  // Count occurrences of each potential delimiter
  const commas = (headerLine.match(/,/g) || []).length;
  const semicolons = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;

  if (tabs >= commas && tabs >= semicolons && tabs > 0) return "\t";
  if (semicolons > commas && semicolons > 0) return ";";
  return ",";
}

/**
 * Parse a coordinate value, handling various formats:
 * - Standard: "45.5087"
 * - European decimal: "45,5087" (comma as decimal separator)
 * - With degree symbol: "45.5087°"
 */
function parseCoord(value: string | undefined): number | undefined {
  if (!value) return undefined;
  let cleaned = value
    .replace(/°/g, "")
    .replace(/[''′]/g, "") // Remove minute symbols
    .replace(/["″]/g, "") // Remove second symbols
    .trim();

  // If using comma as decimal separator (no other commas in string)
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }

  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? undefined : num;
}

/**
 * Try to extract lat/lon from a combined coordinates column.
 * Supports formats like: "45.5, -73.5" or "45.5 -73.5" or "(45.5, -73.5)"
 */
function parseCoordinatesColumn(value: string): { lat?: number; lon?: number } {
  if (!value) return {};

  // Remove parentheses and brackets
  const cleaned = value.replace(/[()[\]]/g, "").trim();

  // Try splitting by comma, semicolon, or whitespace
  const parts = cleaned.split(/[,;\s]+/).filter(Boolean);

  if (parts.length >= 2) {
    const first = parseCoord(parts[0]);
    const second = parseCoord(parts[1]);

    if (first !== undefined && second !== undefined) {
      // Heuristic: if first value looks like latitude (between -90 and 90)
      // and second looks like longitude (larger range), use that order
      // Otherwise, assume lon,lat (GeoJSON order)
      if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
        return { lat: first, lon: second };
      }
      // Default to lat,lon order (most common in CSV)
      return { lat: first, lon: second };
    }
  }

  return {};
}

/**
 * Find column index by trying multiple possible names.
 */
function findColumnIndex(header: string[], ...names: string[]): number {
  for (const name of names) {
    const idx = header.findIndex((h) => h === name);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Parse CSV text. Expected columns (case-insensitive): lat, lon, type, capacity, condition, address.
 * Also supports: x/y, point_x/point_y, latitude/longitude, coords, location, coordinates.
 * Handles quoted values and various delimiters (comma, semicolon, tab).
 */
export function parseWasteCSV(text: string): WasteImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCSVLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/['"]/g, ""),
  );

  // Find latitude column (try multiple variations)
  const latIdx = findColumnIndex(
    header,
    "lat",
    "latitude",
    "y",
    "point_y",
    "lat_y",
    "latitud",
  );

  // Find longitude column
  const lonIdx = findColumnIndex(
    header,
    "lon",
    "lng",
    "longitude",
    "long",
    "x",
    "point_x",
    "lon_x",
    "longitud",
  );

  // Find combined coordinates column (fallback if lat/lon not found)
  const coordsIdx = findColumnIndex(
    header,
    "coords",
    "coordinates",
    "coord",
    "location",
    "point",
    "geometry",
    "latlng",
    "latlon",
    "position",
  );

  const typeIdx = findColumnIndex(
    header,
    "type",
    "asset_type",
    "point_type",
    "category",
  );
  const capacityIdx = findColumnIndex(
    header,
    "capacity",
    "capacity_liters",
    "liters",
    "volume",
    "size",
  );
  const conditionIdx = findColumnIndex(header, "condition", "status", "state");
  const addressIdx = findColumnIndex(
    header,
    "address",
    "address_string",
    "location_name",
    "name",
    "description",
  );

  const rows: WasteImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i], delimiter);

    let lat: number | undefined;
    let lon: number | undefined;

    // Try separate lat/lon columns first
    if (latIdx >= 0 && lonIdx >= 0) {
      lat = parseCoord(cells[latIdx]);
      lon = parseCoord(cells[lonIdx]);
    }

    // If lat/lon not found or invalid, try combined coordinates column
    if ((lat === undefined || lon === undefined) && coordsIdx >= 0) {
      const coords = parseCoordinatesColumn(cells[coordsIdx] || "");
      if (coords.lat !== undefined) lat = coords.lat;
      if (coords.lon !== undefined) lon = coords.lon;
    }

    const type =
      typeIdx >= 0 && cells[typeIdx] ? normalizeType(cells[typeIdx]) : "bin";
    const capacityStr = capacityIdx >= 0 ? cells[capacityIdx] : undefined;
    const capacity = capacityStr
      ? parseInt(capacityStr.replace(/[^\d.-]/g, ""), 10)
      : undefined;
    const condition =
      conditionIdx >= 0 && cells[conditionIdx]
        ? normalizeCondition(cells[conditionIdx])
        : undefined;
    const address =
      addressIdx >= 0 && cells[addressIdx]
        ? cells[addressIdx].replace(/^["']|["']$/g, "")
        : undefined;

    // Accept row if it has valid coordinates OR has an address (for geocoding)
    if (
      (lat !== undefined && lon !== undefined) ||
      (address && address.length > 0)
    ) {
      rows.push({
        lat,
        lon,
        type,
        capacityLiters: Number.isNaN(capacity!) ? undefined : capacity,
        condition,
        address,
      });
    }
  }

  return rows;
}

/**
 * Parse GeoJSON FeatureCollection of Point features. Properties: type, capacity, condition, address.
 */
export function parseWasteGeoJSON(text: string): WasteImportRow[] {
  let data: {
    type?: string;
    features?: Array<{
      type?: string;
      geometry?: { type?: string; coordinates?: number[] };
      properties?: Record<string, unknown>;
    }>;
  };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
    return [];
  const rows: WasteImportRow[] = [];
  for (const f of data.features) {
    if (
      f.type !== "Feature" ||
      f.geometry?.type !== "Point" ||
      !Array.isArray(f.geometry.coordinates) ||
      f.geometry.coordinates.length < 2
    )
      continue;
    const [lon, lat] = f.geometry.coordinates;
    const p = (f.properties || {}) as Record<string, unknown>;
    const type = normalizeType(String(p.type ?? p.Type ?? "bin"));
    const capacity =
      typeof p.capacity === "number"
        ? p.capacity
        : typeof p.capacity === "string"
          ? parseInt(p.capacity, 10)
          : undefined;
    const condition = normalizeCondition(
      String(p.condition ?? p.Condition ?? ""),
    );
    const address = [
      p.address,
      p.Address,
      p.name,
      p.Name,
      p.description,
      p.Description,
    ].find((a) => typeof a === "string") as string | undefined;
    rows.push({
      lat: typeof lat === "number" && !Number.isNaN(lat) ? lat : undefined,
      lon: typeof lon === "number" && !Number.isNaN(lon) ? lon : undefined,
      type,
      capacityLiters: capacity,
      condition,
      address,
    });
  }
  return rows;
}

/**
 * Detect format and parse. Tries JSON first, then CSV.
 */
export function parseWasteFile(
  text: string,
  filename?: string,
): WasteImportRow[] {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    const parsed = parseWasteGeoJSON(text);
    if (parsed.length > 0) return parsed;
  }
  if (
    lower.endsWith(".csv") ||
    text.trim().startsWith("lat") ||
    text.trim().startsWith("type") ||
    /[,;\t]/.test(text.split(/\r?\n/)[0] || "")
  ) {
    return parseWasteCSV(text);
  }
  try {
    const parsed = parseWasteGeoJSON(text);
    if (parsed.length > 0) return parsed;
  } catch {
    // ignore
  }
  return parseWasteCSV(text);
}
