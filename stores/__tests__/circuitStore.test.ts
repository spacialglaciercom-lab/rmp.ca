import { describe, it, expect, beforeEach } from "vitest";
import { useCircuitStore } from "../circuitStore";
import type { StreetEdge, TurnEdge } from "@/types/turnAware";

const sampleStreetEdge: StreetEdge = {
  id: "e1",
  from: "a",
  to: "b",
  coordinates: [
    [-73.5, 45.5],
    [-73.51, 45.51],
  ],
  length: 100,
  speed: 50,
  oneWay: false,
};

const sampleTurnEdge: TurnEdge = {
  id: "t1",
  from: {
    edgeId: "e0",
    direction: "forward",
    intersectionId: "i0",
  },
  to: {
    edgeId: "e1",
    direction: "forward",
    intersectionId: "i1",
  },
  turnType: "straight",
  staticPenalty: 2,
  baseTime: 10,
  totalCost: 12,
};

describe("circuitStore", () => {
  beforeEach(() => {
    useCircuitStore.getState().clearCircuit();
  });

  it("starts with empty circuit and street edges", () => {
    const s = useCircuitStore.getState();
    expect(s.circuit).toEqual([]);
    expect(s.streetEdges).toEqual([]);
  });

  it("setCircuit replaces circuit and street edges", () => {
    useCircuitStore.getState().setCircuit([sampleTurnEdge], [sampleStreetEdge]);
    const s = useCircuitStore.getState();
    expect(s.circuit).toHaveLength(1);
    expect(s.circuit[0]!.id).toBe("t1");
    expect(s.streetEdges).toHaveLength(1);
    expect(s.streetEdges[0]!.id).toBe("e1");
  });

  it("clearCircuit resets to empty arrays", () => {
    useCircuitStore.getState().setCircuit([sampleTurnEdge], [sampleStreetEdge]);
    useCircuitStore.getState().clearCircuit();
    const s = useCircuitStore.getState();
    expect(s.circuit).toEqual([]);
    expect(s.streetEdges).toEqual([]);
  });
});
