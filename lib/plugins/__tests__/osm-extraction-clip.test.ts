import { describe, it, expect } from "vitest";
import { clipLineFeaturesToExtractBbox } from "../osm-extraction/osmExtractionService";

describe("clipLineFeaturesToExtractBbox", () => {
  const polygon: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    },
  };

  it("truncates a LineString that extends past the extraction bbox", () => {
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        id: "way/1",
        properties: { highway: "residential" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-5, 5],
            [15, 5],
          ],
        },
      },
    ];

    const clipped = clipLineFeaturesToExtractBbox(polygon, features);
    expect(clipped).toHaveLength(1);
    expect(clipped[0].geometry.type).toBe("LineString");
    const coords = (clipped[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[0]).toEqual([0, 5]);
    expect(coords[coords.length - 1]).toEqual([10, 5]);
  });

  it("drops lines fully outside the bbox", () => {
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [20, 5],
            [30, 5],
          ],
        },
      },
    ];

    expect(clipLineFeaturesToExtractBbox(polygon, features)).toHaveLength(0);
  });
});
