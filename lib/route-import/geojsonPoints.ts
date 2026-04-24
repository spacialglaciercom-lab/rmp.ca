import type { ParsedRoutePoint } from "./pointTypes";
import { normalizePointType } from "./pointTypes";

/** Minimal FeatureCollection input for point extraction (matches hook JSON path). */
export function featureCollectionToImportPoints(data: {
  type: "FeatureCollection";
  features: Array<{
    id?: string | number;
    geometry?: { type?: string; coordinates?: number[] };
    properties?: Record<string, unknown>;
  }>;
}): ParsedRoutePoint[] {
  return data.features
    .filter((f) => f.geometry?.type === "Point")
    .map((feature, idx: number) => {
      const coords = feature.geometry!.coordinates!;
      const props = feature.properties ?? {};
      const twStart = props.time_window_start ?? props.tw_start;
      const twEnd = props.time_window_end ?? props.tw_end;
      const timeWindow =
        twStart != null || twEnd != null
          ? {
              start: twStart != null ? String(twStart) : undefined,
              end: twEnd != null ? String(twEnd) : undefined,
            }
          : undefined;

      const serviceRaw = props.service_time ?? props.duration;
      const serviceTime =
        serviceRaw != null && serviceRaw !== "" ? parseFloat(String(serviceRaw)) : undefined;

      return {
        id: feature.id != null ? String(feature.id) : `geojson-${idx}`,
        lon: coords[0],
        lat: coords[1],
        name: (props.name ?? props.label) != null ? String(props.name ?? props.label) : undefined,
        address: props.address != null ? String(props.address) : undefined,
        type: normalizePointType(props.type != null ? String(props.type) : undefined),
        demand: (() => {
          if (props.demand != null && props.demand !== "") {
            const d = Number(props.demand);
            return Number.isFinite(d) ? d : undefined;
          }
          if (props.capacity != null && props.capacity !== "") {
            const c = Number(props.capacity);
            return Number.isFinite(c) ? c : undefined;
          }
          return undefined;
        })(),
        notes: props.notes != null ? String(props.notes) : undefined,
        serviceTime: Number.isFinite(serviceTime) ? serviceTime : undefined,
        timeWindow,
      };
    });
}
