import { describe, it, expect, beforeEach } from "vitest";
import {
  CycleDetector,
  detectSimpleOscillation,
  detectRouteCycle,
  DEFAULT_CYCLE_CONFIG,
} from "../cycleDetector";

describe("CycleDetector", () => {
  let detector: CycleDetector;

  beforeEach(() => {
    detector = new CycleDetector();
  });

  describe("enterNode", () => {
    it("should not detect loop on first visit", () => {
      const result = detector.enterNode("A", 10);
      expect(result.isLooping).toBe(false);
      expect(result.loopType).toBe("none");
    });

    it("should detect node oscillation when visiting same node too many times", () => {
      // Visit node A repeatedly
      for (let i = 0; i < DEFAULT_CYCLE_CONFIG.maxNodeRevisits; i++) {
        const result = detector.enterNode("A", 10 - i);
        expect(result.isLooping).toBe(false);
      }

      // One more visit should trigger oscillation detection
      const result = detector.enterNode("A", 5);
      expect(result.isLooping).toBe(true);
      expect(result.loopType).toBe("node-oscillation");
      expect(result.culprit).toBe("A");
    });

    it("should detect zero progress when edge count doesn't decrease", () => {
      const config = { ...DEFAULT_CYCLE_CONFIG, recentWindowSize: 10 };
      detector = new CycleDetector(config);

      // Simulate stagnation
      for (let i = 0; i < config.recentWindowSize + 1; i++) {
        const result = detector.enterNode(`node${i % 5}`, 10);
        if (i > config.recentWindowSize) {
          expect(result.isLooping).toBe(true);
          expect(result.loopType).toBe("zero-progress");
          break;
        }
      }
    });

    it("should add looping nodes to tabu list", () => {
      // Trigger oscillation
      for (let i = 0; i <= DEFAULT_CYCLE_CONFIG.maxNodeRevisits; i++) {
        detector.enterNode("A", 10);
      }

      expect(detector.isTabu("A")).toBe(true);
    });
  });

  describe("leaveNode", () => {
    it("should handle leaving nodes not on stack gracefully", () => {
      expect(() => detector.leaveNode("nonexistent")).not.toThrow();
    });

    it("should update SCC membership on backtrack", () => {
      // Build a simple cycle: A -> B -> C -> A
      detector.enterNode("A", 10);
      detector.enterNode("B", 9);
      detector.enterNode("C", 8);
      detector.enterNode("A", 7); // Back to A - forms SCC

      detector.leaveNode("A");
      detector.leaveNode("C");
      detector.leaveNode("B");
      detector.leaveNode("A");

      const diag = detector.getDiagnostics();
      expect(diag.sccsFound).toBeGreaterThan(0);
    });
  });

  describe("getPenalty", () => {
    it("should return 0 for unvisited nodes", () => {
      expect(detector.getPenalty("unvisited")).toBe(0);
    });

    it("should return exponential penalty based on visit count", () => {
      detector.enterNode("A", 10);
      const penalty1 = detector.getPenalty("A");

      detector.enterNode("A", 9);
      const penalty2 = detector.getPenalty("A");

      expect(penalty2).toBeGreaterThan(penalty1);
    });

    it("should return high penalty for tabu nodes", () => {
      // Trigger tabu
      for (let i = 0; i <= DEFAULT_CYCLE_CONFIG.maxNodeRevisits; i++) {
        detector.enterNode("A", 10);
      }

      expect(detector.getPenalty("A")).toBe(1000);
    });
  });

  describe("clearTabu", () => {
    it("should remove node from tabu list", () => {
      // Trigger tabu
      for (let i = 0; i <= DEFAULT_CYCLE_CONFIG.maxNodeRevisits; i++) {
        detector.enterNode("A", 10);
      }

      expect(detector.isTabu("A")).toBe(true);
      detector.clearTabu("A");
      expect(detector.isTabu("A")).toBe(false);
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      detector.enterNode("A", 10);
      detector.enterNode("B", 9);

      detector.reset();

      const diag = detector.getDiagnostics();
      expect(diag.totalNodesVisited).toBe(0);
      expect(diag.uniqueNodes).toBe(0);
      expect(diag.tabuListSize).toBe(0);
    });
  });

  describe("getDiagnostics", () => {
    it("should return accurate statistics", () => {
      detector.enterNode("A", 10);
      detector.enterNode("B", 9);
      detector.enterNode("A", 8);

      const diag = detector.getDiagnostics();
      expect(diag.totalNodesVisited).toBe(3);
      expect(diag.uniqueNodes).toBe(2);
      expect(diag.mostVisitedNodes.length).toBeGreaterThan(0);
      expect(diag.mostVisitedNodes[0]?.node).toBe("A");
      expect(diag.mostVisitedNodes[0]?.visits).toBe(2);
    });
  });
});

describe("detectSimpleOscillation", () => {
  it("should return false for short paths", () => {
    const result = detectSimpleOscillation(["A", "B", "C"]);
    expect(result.isOscillating).toBe(false);
  });

  it("should detect oscillation in recent path", () => {
    const path = ["A", "B", "A", "B", "A", "B", "A", "B", "A", "B", "A", "B"];
    const result = detectSimpleOscillation(path, 12, 3);
    expect(result.isOscillating).toBe(true);
    expect(result.culprit).toBe("A");
  });

  it("should not detect oscillation in varied path", () => {
    const path = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const result = detectSimpleOscillation(path, 12, 3);
    expect(result.isOscillating).toBe(false);
  });
});

describe("detectRouteCycle", () => {
  it("should return false for short routes", () => {
    const result = detectRouteCycle(["A", "B", "C"]);
    expect(result.hasCycle).toBe(false);
  });

  it("should detect repeating pattern", () => {
    const route = ["A", "B", "C", "D", "E", "A", "B", "C", "D", "E"];
    const result = detectRouteCycle(route, 3, 10);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleLength).toBe(5);
  });

  it("should detect short repeating pattern", () => {
    const route = ["A", "B", "C", "A", "B", "C"];
    const result = detectRouteCycle(route, 3, 10);
    expect(result.hasCycle).toBe(true);
    expect(result.cycleLength).toBe(3);
  });

  it("should not detect cycle in non-repeating route", () => {
    const route = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const result = detectRouteCycle(route, 3, 10);
    expect(result.hasCycle).toBe(false);
  });
});
