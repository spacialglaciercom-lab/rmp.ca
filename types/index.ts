export * from "./navigation";

export type CollectionStatus = "pending" | "completed" | "skipped" | "issue";

export type CollectionType = "residential" | "commercial" | "recycling" | "bulk";

export interface CollectionPoint {
  id: string;
  address: string;
  locationName?: string;
  latitude: number;
  longitude: number;
  collectionType: CollectionType;
  status: CollectionStatus;
  specialInstructions?: string;
  notes?: string;
  photoUri?: string;
  lastCollectionDate?: string;
  scheduledTime?: string;
}

/** Route origin: VRP = discrete stops (Processing Queue); OSM = navigation-only (use Map). */
export type RouteSource = "vrp" | "osm";

export interface Route {
  id: string;
  date: string;
  points: CollectionPoint[];
  totalPoints: number;
  completedPoints: number;
  estimatedDuration: number; // in minutes
  status: "not_started" | "in_progress" | "completed";
  /** When "vrp", Home shows Processing Queue with stops; when "osm" or missing, route is for Map navigation only. */
  routeSource?: RouteSource;
}

export interface RouteStats {
  totalCollections: number;
  completedToday: number;
  remainingToday: number;
  completionPercentage: number;
  estimatedTimeRemaining: number; // in minutes
}

/** Waste asset for zone mapping: bin or dumpster. */
export type WastePointType = "bin" | "dumpster";

export type WastePointCondition = "good" | "overflowing" | "damaged";

export interface WastePoint {
  id: string;
  lat: number;
  lon: number;
  type: WastePointType;
  capacityLiters?: number;
  condition?: WastePointCondition;
  address?: string;
  photoUri?: string;
  createdAt: string;
}
