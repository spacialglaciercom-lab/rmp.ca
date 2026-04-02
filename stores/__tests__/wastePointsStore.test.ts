/**
 * Unit tests for wastePointsStore.
 *
 * Covers: add, addMany, update, remove, setAll, clearAll,
 * ID generation, createdAt stamping, and state isolation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// In-memory AsyncStorage mock (required by zustand/persist)
// ---------------------------------------------------------------------------
const storage = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(storage.get(k) ?? null),
    setItem: (k: string, v: string) => { storage.set(k, v); return Promise.resolve(); },
    removeItem: (k: string) => { storage.delete(k); return Promise.resolve(); },
    clear: () => { storage.clear(); return Promise.resolve(); },
    getAllKeys: () => Promise.resolve([...storage.keys()]),
  },
}));

import { useWastePointsStore } from "../wastePointsStore";
import type { WastePoint } from "@/types";

function reset() {
  useWastePointsStore.getState().clearAll();
}

const makePoint = (
  overrides: Partial<Omit<WastePoint, "id" | "createdAt">> = {},
): Omit<WastePoint, "id" | "createdAt"> => ({
  lat: 45.5,
  lon: -73.5,
  type: "bin",
  condition: "good",
  ...overrides,
});

describe("wastePointsStore — initial state", () => {
  beforeEach(reset);

  it("starts with an empty points array", () => {
    expect(useWastePointsStore.getState().points).toEqual([]);
  });
});

describe("wastePointsStore — add", () => {
  beforeEach(reset);

  it("adds a point with auto-generated id and createdAt", () => {
    useWastePointsStore.getState().add(makePoint());
    const { points } = useWastePointsStore.getState();
    expect(points).toHaveLength(1);
    expect(points[0]!.id).toMatch(/^waste_/);
    expect(typeof points[0]!.createdAt).toBe("string");
    expect(new Date(points[0]!.createdAt).getTime()).not.toBeNaN();
  });

  it("prepends new point to the list", () => {
    useWastePointsStore.getState().add(makePoint({ lat: 45.5 }));
    useWastePointsStore.getState().add(makePoint({ lat: 46.0 }));
    const { points } = useWastePointsStore.getState();
    expect(points[0]!.lat).toBe(46.0); // most recent first
    expect(points[1]!.lat).toBe(45.5);
  });

  it("generates unique ids for successive adds", () => {
    useWastePointsStore.getState().add(makePoint());
    useWastePointsStore.getState().add(makePoint());
    const ids = useWastePointsStore.getState().points.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("preserves all fields from the input", () => {
    useWastePointsStore.getState().add(
      makePoint({ type: "dumpster", capacityLiters: 1000, address: "123 Main St", condition: "overflowing" }),
    );
    const p = useWastePointsStore.getState().points[0]!;
    expect(p.type).toBe("dumpster");
    expect(p.capacityLiters).toBe(1000);
    expect(p.address).toBe("123 Main St");
    expect(p.condition).toBe("overflowing");
  });
});

describe("wastePointsStore — addMany", () => {
  beforeEach(reset);

  it("adds multiple points in one call", () => {
    useWastePointsStore.getState().addMany([makePoint({ lat: 45.5 }), makePoint({ lat: 46.0 })]);
    expect(useWastePointsStore.getState().points).toHaveLength(2);
  });

  it("all new points have unique ids", () => {
    useWastePointsStore.getState().addMany([makePoint(), makePoint(), makePoint()]);
    const ids = useWastePointsStore.getState().points.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("prepends new points before existing ones", () => {
    useWastePointsStore.getState().add(makePoint({ lat: 10 }));
    useWastePointsStore.getState().addMany([makePoint({ lat: 20 }), makePoint({ lat: 30 })]);
    const lats = useWastePointsStore.getState().points.map((p) => p.lat);
    // addMany puts new points first
    expect(lats[0]).toBe(20);
    expect(lats[1]).toBe(30);
    expect(lats[2]).toBe(10);
  });

  it("handles an empty array without error", () => {
    useWastePointsStore.getState().addMany([]);
    expect(useWastePointsStore.getState().points).toHaveLength(0);
  });
});

describe("wastePointsStore — update", () => {
  beforeEach(reset);

  it("updates fields of the matching point", () => {
    useWastePointsStore.getState().add(makePoint({ condition: "good" }));
    const id = useWastePointsStore.getState().points[0]!.id;
    useWastePointsStore.getState().update(id, { condition: "overflowing", address: "999 Elm St" });
    const p = useWastePointsStore.getState().points[0]!;
    expect(p.condition).toBe("overflowing");
    expect(p.address).toBe("999 Elm St");
    expect(p.id).toBe(id); // id unchanged
  });

  it("does not modify other points", () => {
    useWastePointsStore.getState().addMany([makePoint({ lat: 45.5 }), makePoint({ lat: 46.0 })]);
    const points = useWastePointsStore.getState().points;
    const [p0, p1] = points;
    useWastePointsStore.getState().update(p0!.id, { lat: 99 });
    expect(useWastePointsStore.getState().points.find((p) => p.id === p1!.id)?.lat).toBe(46.0);
  });

  it("is a no-op for an unknown id", () => {
    useWastePointsStore.getState().add(makePoint());
    const before = useWastePointsStore.getState().points[0]!.lat;
    useWastePointsStore.getState().update("nonexistent-id", { lat: 99 });
    expect(useWastePointsStore.getState().points[0]!.lat).toBe(before);
  });
});

describe("wastePointsStore — remove", () => {
  beforeEach(reset);

  it("removes the point with the given id", () => {
    useWastePointsStore.getState().addMany([makePoint(), makePoint()]);
    const id = useWastePointsStore.getState().points[0]!.id;
    useWastePointsStore.getState().remove(id);
    const remaining = useWastePointsStore.getState().points;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).not.toBe(id);
  });

  it("is a no-op for an unknown id", () => {
    useWastePointsStore.getState().add(makePoint());
    useWastePointsStore.getState().remove("ghost-id");
    expect(useWastePointsStore.getState().points).toHaveLength(1);
  });
});

describe("wastePointsStore — setAll", () => {
  beforeEach(reset);

  it("replaces the entire points array", () => {
    useWastePointsStore.getState().addMany([makePoint(), makePoint()]);
    const newPoints: WastePoint[] = [
      { id: "x1", lat: 1, lon: 1, type: "bin", createdAt: new Date().toISOString() },
    ];
    useWastePointsStore.getState().setAll(newPoints);
    const { points } = useWastePointsStore.getState();
    expect(points).toHaveLength(1);
    expect(points[0]!.id).toBe("x1");
  });

  it("can clear all points by passing an empty array", () => {
    useWastePointsStore.getState().add(makePoint());
    useWastePointsStore.getState().setAll([]);
    expect(useWastePointsStore.getState().points).toHaveLength(0);
  });
});

describe("wastePointsStore — clearAll", () => {
  beforeEach(reset);

  it("removes all points", () => {
    useWastePointsStore.getState().addMany([makePoint(), makePoint(), makePoint()]);
    useWastePointsStore.getState().clearAll();
    expect(useWastePointsStore.getState().points).toHaveLength(0);
  });

  it("is safe to call on an already-empty store", () => {
    expect(() => useWastePointsStore.getState().clearAll()).not.toThrow();
  });
});
