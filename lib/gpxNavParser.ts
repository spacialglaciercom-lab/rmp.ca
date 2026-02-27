/**
 * Parse GPX string for navigation: extract track/route points and waypoints.
 * Used by the turn-by-turn navigation stack (map matching, NavigationEngine).
 */

export interface ParsedTrackPoint {
  lat: number;
  lon: number;
  ele?: number | null;
  time?: string | null;
  name?: string | null;
}

export interface ParsedWaypoint {
  lat: number;
  lon: number;
  name: string;
  desc?: string | null;
}

export interface ParsedGPX {
  points: ParsedTrackPoint[];
  waypoints: ParsedWaypoint[];
  metadata: {
    name: string;
    totalPoints: number;
  };
}

/** Extract lat/lon from a tag like <trkpt lat="40.1" lon="-74.0"> or <rtept lat="..." lon="..."> */
function parseLatLon(tag: string): { lat: number; lon: number } | null {
  const latMatch = tag.match(/lat="([^"]+)"/);
  const lonMatch = tag.match(/lon="([^"]+)"/);
  if (!latMatch || !lonMatch) return null;
  const lat = parseFloat(latMatch[1]);
  const lon = parseFloat(lonMatch[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}

/** Get content of a child element (e.g. <name>Route</name>). */
function getElementContent(gpx: string, afterIndex: number, tagName: string): string | null {
  const open = `<${tagName}>`;
  const close = `</${tagName}>`;
  const start = gpx.indexOf(open, afterIndex);
  if (start === -1) return null;
  const contentStart = start + open.length;
  const end = gpx.indexOf(close, contentStart);
  if (end === -1) return null;
  return gpx.slice(contentStart, end).trim();
}

/**
 * Parse GPX string and return structured points for navigation.
 * Supports <trk>/<trkseg>/<trkpt>, <rte>/<rtept>, and <wpt>.
 */
export function parseGPXForNavigation(gpxString: string): ParsedGPX {
  const points: ParsedTrackPoint[] = [];
  const waypoints: ParsedWaypoint[] = [];
  let metadataName = "Unnamed Route";

  // Metadata name
  const metaNameMatch = gpxString.match(/<metadata>[\s\S]*?<name>([^<]*)<\/name>/i);
  if (metaNameMatch) metadataName = metaNameMatch[1].trim();

  // Track points: <trkpt lat="..." lon="..."> ... </trkpt>
  const trkptRegex = /<trkpt[^>]*>[\s\S]*?<\/trkpt>/gi;
  let match: RegExpExecArray | null;
  while ((match = trkptRegex.exec(gpxString)) !== null) {
    const tag = match[0];
    const openTag = tag.slice(0, tag.indexOf(">"));
    const ll = parseLatLon(openTag);
    if (!ll) continue;
    const eleMatch = tag.match(/<ele>([^<]*)<\/ele>/);
    const timeMatch = tag.match(/<time>([^<]*)<\/time>/);
    const nameMatch = tag.match(/<name>([^<]*)<\/name>/);
    points.push({
      lat: ll.lat,
      lon: ll.lon,
      ele: eleMatch ? parseFloat(eleMatch[1]) : null,
      time: timeMatch ? timeMatch[1].trim() : null,
      name: nameMatch ? nameMatch[1].trim() : null,
    });
  }

  // Route points if no track points
  if (points.length === 0) {
    const rteptRegex = /<rtept[^>]*>[\s\S]*?<\/rtept>/gi;
    while ((match = rteptRegex.exec(gpxString)) !== null) {
      const tag = match[0];
      const openTag = tag.slice(0, tag.indexOf(">"));
      const ll = parseLatLon(openTag);
      if (!ll) continue;
      const nameMatch = tag.match(/<name>([^<]*)<\/name>/);
      points.push({
        lat: ll.lat,
        lon: ll.lon,
        name: nameMatch ? nameMatch[1].trim() : null,
      });
    }
  }

  // Waypoints: <wpt lat="..." lon="..."> ... </wpt>
  const wptRegex = /<wpt[^>]*>[\s\S]*?<\/wpt>/gi;
  while ((match = wptRegex.exec(gpxString)) !== null) {
    const tag = match[0];
    const openTag = tag.slice(0, tag.indexOf(">"));
    const ll = parseLatLon(openTag);
    if (!ll) continue;
    const nameMatch = tag.match(/<name>([^<]*)<\/name>/);
    const descMatch = tag.match(/<desc>([^<]*)<\/desc>/);
    waypoints.push({
      lat: ll.lat,
      lon: ll.lon,
      name: nameMatch ? nameMatch[1].trim() : "Waypoint",
      desc: descMatch ? descMatch[1].trim() : null,
    });
  }

  return {
    points,
    waypoints,
    metadata: {
      name: metadataName,
      totalPoints: points.length,
    },
  };
}
