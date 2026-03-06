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
 * Parse CSV text. Expected columns (case-insensitive): lat, lon, type, capacity, condition, address.
 * If header is missing, first row is treated as header.
 */
export function parseWasteCSV(text: string): WasteImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase());
  const latIdx = header.findIndex((h) => h === "lat" || h === "latitude");
  const lonIdx = header.findIndex((h) => h === "lon" || h === "lng" || h === "longitude");
  const typeIdx = header.findIndex((h) => h === "type");
  const capacityIdx = header.findIndex((h) => h === "capacity" || h === "capacity_liters" || h === "liters");
  const conditionIdx = header.findIndex((h) => h === "condition");
  const addressIdx = header.findIndex((h) => h === "address" || h === "address_string");

  const rows: WasteImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(/[,;\t]/).map((c) => c.trim());
    const lat = latIdx >= 0 && cells[latIdx] ? parseFloat(cells[latIdx]) : undefined;
    const lon = lonIdx >= 0 && cells[lonIdx] ? parseFloat(cells[lonIdx]) : undefined;
    const type = typeIdx >= 0 && cells[typeIdx] ? normalizeType(cells[typeIdx]) : "bin";
    const capacity = capacityIdx >= 0 && cells[capacityIdx] ? parseInt(cells[capacityIdx], 10) : undefined;
    const condition = conditionIdx >= 0 && cells[conditionIdx] ? normalizeCondition(cells[conditionIdx]) : undefined;
    const address = addressIdx >= 0 && cells[addressIdx] ? cells[addressIdx] : undefined;
    if ((lat != null && !Number.isNaN(lat) && lon != null && !Number.isNaN(lon)) || (address && address.length > 0)) {
      rows.push({ lat: Number.isNaN(lat!) ? undefined : lat, lon: Number.isNaN(lon!) ? undefined : lon, type, capacityLiters: capacity, condition, address });
    }
  }
  return rows;
}

/**
 * Parse GeoJSON FeatureCollection of Point features. Properties: type, capacity, condition, address.
 */
export function parseWasteGeoJSON(text: string): WasteImportRow[] {
  let data: { type?: string; features?: Array<{ type?: string; geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }> };
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) return [];
  const rows: WasteImportRow[] = [];
  for (const f of data.features) {
    if (f.type !== "Feature" || f.geometry?.type !== "Point" || !Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) continue;
    const [lon, lat] = f.geometry.coordinates;
    const p = (f.properties || {}) as Record<string, unknown>;
    const type = normalizeType(String(p.type ?? p.Type ?? "bin"));
    const capacity = typeof p.capacity === "number" ? p.capacity : typeof p.capacity === "string" ? parseInt(p.capacity, 10) : undefined;
    const condition = normalizeCondition(String(p.condition ?? p.Condition ?? ""));
    const address = [p.address, p.Address].find((a) => typeof a === "string") as string | undefined;
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
export function parseWasteFile(text: string, filename?: string): WasteImportRow[] {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    const parsed = parseWasteGeoJSON(text);
    if (parsed.length > 0) return parsed;
  }
  if (lower.endsWith(".csv") || text.trim().startsWith("lat") || text.trim().startsWith("type") || /[,;\t]/.test(text.split(/\r?\n/)[0] || "")) {
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
