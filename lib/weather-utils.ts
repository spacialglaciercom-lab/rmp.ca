/**
 * Shared weather utility functions.
 */

/**
 * Converts cardinal direction strings (e.g., "NORTH", "NORTHEAST") to abbreviations (e.g., "N", "NE").
 */
export function cardinalToAbbrev(cardinal?: string): string {
  if (!cardinal) return "";
  const map: Record<string, string> = {
    NORTH: "N",
    NORTHEAST: "NE",
    EAST: "E",
    SOUTHEAST: "SE",
    SOUTH: "S",
    SOUTHWEST: "SW",
    WEST: "W",
    NORTHWEST: "NW",
    NORTH_NORTHEAST: "NNE",
    EAST_NORTHEAST: "ENE",
    EAST_SOUTHEAST: "ESE",
    SOUTH_SOUTHEAST: "SSE",
    SOUTH_SOUTHWEST: "SSW",
    WEST_SOUTHWEST: "WSW",
    WEST_NORTHWEST: "WNW",
    NORTH_NORTHWEST: "NNW",
  };
  return map[cardinal.toUpperCase()] ?? cardinal;
}
