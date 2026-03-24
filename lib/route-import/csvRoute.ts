import type { ParsedRoutePoint } from "./pointTypes";
import { normalizePointType } from "./pointTypes";

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  if (tabs >= commas && tabs >= semicolons && tabs > 0) return "\t";
  if (semicolons > commas && semicolons > 0) return ";";
  return ",";
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
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
 * Parse CSV with route planning columns.
 * Supports: lat, latitude (and common typo latitide), lon, longitude, lng, plus optional metadata columns.
 */
export function parseRouteCSV(content: string): { points: ParsedRoutePoint[]; warnings: string[] } {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV file must have at least a header and one data row");
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter).map((h) => h.toLowerCase().trim());

  const points: ParsedRoutePoint[] = [];
  const warnings: string[] = [];

  const latIdx = headers.findIndex(
    (h) => h === "lat" || h === "latitude" || h === "latitide",
  );
  const lonIdx = headers.findIndex((h) => h === "lon" || h === "longitude" || h === "lng");
  const nameIdx = headers.findIndex((h) => h === "name" || h === "label");
  const addressIdx = headers.findIndex((h) => h === "address");
  const typeIdx = headers.findIndex((h) => h === "type");
  const demandIdx = headers.findIndex((h) => h === "demand" || h === "capacity");
  const twStartIdx = headers.findIndex(
    (h) => h === "time_window_start" || h === "tw_start" || h === "open",
  );
  const twEndIdx = headers.findIndex(
    (h) => h === "time_window_end" || h === "tw_end" || h === "close",
  );
  const serviceIdx = headers.findIndex((h) => h === "service_time" || h === "duration");
  const notesIdx = headers.findIndex((h) => h === "notes");

  if (latIdx === -1 || lonIdx === -1) {
    throw new Error("CSV must have lat/latitude and lon/longitude/lng columns");
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const cells = parseCSVLine(line, delimiter);
      const lat = parseFloat(cells[latIdx]);
      const lon = parseFloat(cells[lonIdx]);

      if (isNaN(lat) || isNaN(lon)) {
        warnings.push(`Row ${i + 1}: Invalid coordinates, skipping`);
        continue;
      }

      const point: ParsedRoutePoint = {
        id: `import-${i}`,
        lat,
        lon,
        name: nameIdx >= 0 ? cells[nameIdx] : undefined,
        address: addressIdx >= 0 ? cells[addressIdx] : undefined,
        type: typeIdx >= 0 ? normalizePointType(cells[typeIdx]) : undefined,
        demand: demandIdx >= 0 ? parseFloat(cells[demandIdx]) || undefined : undefined,
        serviceTime: serviceIdx >= 0 ? parseFloat(cells[serviceIdx]) || undefined : undefined,
        notes: notesIdx >= 0 ? cells[notesIdx] : undefined,
      };

      if (twStartIdx >= 0 || twEndIdx >= 0) {
        point.timeWindow = {
          start: twStartIdx >= 0 ? cells[twStartIdx] : undefined,
          end: twEndIdx >= 0 ? cells[twEndIdx] : undefined,
        };
      }

      points.push(point);
    } catch (err) {
      warnings.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "Parse error"}`);
    }
  }

  return { points, warnings };
}
