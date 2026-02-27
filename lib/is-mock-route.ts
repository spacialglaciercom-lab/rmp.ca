import type { Route, CollectionPoint } from "@/types";

/** Detect stored mock/sample route (123 Main St, 456 Oak Ave, etc.) so we can clear it. */
export function isMockRoute(r: Route): boolean {
  if (!r.points?.length || r.points.length !== 10) return false;
  return isMockCollectionPoints(r.points);
}

/** Detect mock/sample collection points so they can be cleared and not used for export. */
export function isMockCollectionPoints(points: CollectionPoint[]): boolean {
  if (!points?.length || points.length !== 10) return false;
  const first = points[0];
  return (
    first?.address === "123 Main Street" ||
    first?.id === "1" ||
    (first?.locationName === "Residential Area A" && first?.address?.includes("Main"))
  );
}
