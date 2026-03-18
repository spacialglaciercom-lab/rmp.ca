/**
 * Populate node.z (elevation metres) by sampling the backend DEM.
 * Used by the offline v2 optimizer so FuelAwarePlugin has real terrain grades.
 *
 * Calls POST /api/elevation — the backend reads DEM_PATH (a local GeoTIFF).
 * Silently no-ops when the backend is unreachable or DEM_PATH is not configured.
 */

import type { Node } from "@/lib/route-optimizer-v2/types";
import { getApiBaseUrl } from "@/shared/oauth";

/**
 * Fetch elevation for every node from the backend DEM and write it to node.z.
 * Silently no-ops when:
 *  - nodes is empty
 *  - backend is offline / unreachable
 *  - DEM_PATH is not configured on the backend (dem_available=false)
 *  - any network or parse error
 */
export async function enrichNodesWithElevation(
  nodes: Map<string, Node>,
): Promise<void> {
  if (nodes.size === 0) return;

  const entries = Array.from(nodes.entries());
  const points = entries.map(([, n]) => [Number(n.lon), Number(n.lat)]);

  try {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/elevation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    });

    if (!res.ok) return;

    const data = (await res.json()) as {
      elevations: (number | null)[];
      dem_available: boolean;
    };

    if (!data.dem_available) return;

    const { elevations } = data;
    for (let i = 0; i < elevations.length; i++) {
      const z = elevations[i];
      if (z !== null && z !== undefined) {
        const node = nodes.get(entries[i]![0]!);
        if (node) node.z = z;
      }
    }
  } catch {
    // Backend offline or DEM not configured — proceed with flat terrain (z=0)
  }
}
