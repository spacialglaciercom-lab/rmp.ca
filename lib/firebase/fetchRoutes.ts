/**
 * Read route metadata from Firebase Firestore (recommended for queries and real-time).
 * Use Firestore for route metadata; Storage holds the actual GPX files.
 */
import { firestoreDb, ensureAppCheckReady } from "./index";

const ROUTES_COLLECTION = "routes";

export interface RouteMetadata {
  id: string;
  title?: string;
  gpxData?: {
    dataType: string;
    storagePath?: string;
    downloadUrl?: string;
  };
  userId?: string;
  createdAt?: number;
  updatedAt?: number;
  hasInvalidGPX?: boolean;
  [key: string]: unknown;
}

/**
 * Fetch all route documents from Firestore (one-time read).
 * Filter client-side for gpxData.dataType === 'application/gpx+xml' if needed.
 */
export async function fetchRouteMetadata(): Promise<RouteMetadata[]> {
  await ensureAppCheckReady();
  const snapshot = await firestoreDb.collection(ROUTES_COLLECTION).get();
  const routes: RouteMetadata[] = [];
  const docs = snapshot.docs ?? [];
  docs.forEach((doc) => {
    const data = doc.data();
    routes.push({
      id: doc.id,
      ...data,
      title: (data.title as string) ?? doc.id,
    } as RouteMetadata);
  });
  return routes;
}

/**
 * Fetch routes that have valid GPX references (application/gpx+xml).
 * Use this when you only need routes that can be loaded as GPX.
 */
export async function fetchRoutesWithGPX(): Promise<RouteMetadata[]> {
  const all = await fetchRouteMetadata();
  return all.filter(
    (r) =>
      r.gpxData &&
      (r.gpxData as { dataType?: string }).dataType === "application/gpx+xml",
  );
}

/**
 * Parse GPX title/reference from Firestore metadata for display or loading.
 * Returns the title for display; use getGpxDownloadUrl or getGpxFile to load the actual file.
 */
export function getRouteTitleForDisplay(metadata: RouteMetadata): string {
  if (metadata.title && typeof metadata.title === "string")
    return metadata.title;
  const gpxName =
    metadata.gpxData && (metadata.gpxData as { name?: string }).name;
  if (typeof gpxName === "string") return gpxName;
  return metadata.id;
}
