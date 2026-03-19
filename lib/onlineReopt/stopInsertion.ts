/**
 * Emergency Stop Insertion
 *
 * Supervisor use-case: a missed bin, illegal dumping report, or ad-hoc service
 * request arrives while a truck is already running its circuit. This module
 * finds the cheapest position in the active Eulerian circuit to insert a detour
 * to the new stop without re-solving the entire CPP.
 *
 * Algorithm — cheapest-insertion heuristic:
 *   For each consecutive pair of edges (circuit[i], circuit[i+1]):
 *     detourCost = dist(circuit[i].to, stop) + dist(stop, circuit[i+1].from)
 *                  - dist(circuit[i].to, circuit[i+1].from)   // savings from skipping
 *   Pick the pair with minimum detourCost and splice in two synthetic TurnEdges
 *   (approach + departure) representing the detour.
 *
 * The detour edges are marked deadhead=true so the downstream CPP circuit
 * remains Eulerian and display layers can distinguish collection vs. deadhead.
 */

import type { TurnEdge, TurnNode } from "@/types/turnAware";
import { createLogger } from "@/lib/logger";

const log = createLogger("StopInsertion");

/** Haversine distance in seconds at a nominal collection-vehicle speed (15 km/h). */
function detourSeconds(
  fromCoords: [number, number],
  toCoords: [number, number],
): number {
  const R = 6371000; // metres
  const dLat = ((toCoords[0] - fromCoords[0]) * Math.PI) / 180;
  const dLon = ((toCoords[1] - fromCoords[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((fromCoords[0] * Math.PI) / 180) *
      Math.cos((toCoords[0] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const distMetres = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // 15 km/h = 4.167 m/s
  return distMetres / 4.167;
}

/** Coordinates of a TurnNode's physical location inferred from its edge id.
 *  We encode `lat_lon` in a synthetic edge id produced by buildDetourEdge. */
function nodeCoords(node: TurnNode): [number, number] | null {
  // Real TurnNodes don't carry lat/lon directly; we use the id convention:
  // "detour:lat:lon:in|out" — only detour nodes are parseable here.
  const parts = node.edgeId.split(":");
  if (parts[0] === "detour" && parts.length >= 3) {
    return [parseFloat(parts[1]!), parseFloat(parts[2]!)];
  }
  return null;
}

/** Build a synthetic TurnEdge representing a deadhead leg to/from the new stop. */
function buildDetourEdge(
  fromNode: TurnNode,
  toNode: TurnNode,
  costSeconds: number,
  idSuffix: string,
): TurnEdge {
  return {
    id: `detour-stop-${idSuffix}`,
    from: fromNode,
    to: toNode,
    turnType: "straight",
    staticPenalty: 0,
    baseTime: costSeconds,
    totalCost: costSeconds,
    deadhead: true,
  };
}

export interface StopInsertionResult {
  /** Updated circuit with the emergency stop detour spliced in. */
  circuit: TurnEdge[];
  /** Zero-based index in the new circuit where the detour approach edge begins. */
  insertionIndex: number;
  /** Estimated extra time added to the route in seconds. */
  addedCostSeconds: number;
}

/**
 * Insert an emergency pickup stop into the active Eulerian circuit.
 *
 * @param circuit         The current active circuit (from solveTurnAwareCPP).
 * @param currentEdgeIdx  Index of the edge the truck is currently traversing.
 *                        Insertion search starts from currentEdgeIdx + 1.
 * @param stopCoords      [lat, lon] of the emergency stop.
 * @param stopServiceTime Extra service time at the new stop, in seconds (default 120 s).
 * @param circuitCoordFn  A function that resolves a TurnNode to [lat, lon]; if null
 *                        is returned the edge pair is skipped. Callers should cache
 *                        this from the original StreetEdge array for O(1) lookup.
 * @returns               Updated circuit and metadata.
 */
export function insertEmergencyStop(
  circuit: TurnEdge[],
  currentEdgeIdx: number,
  stopCoords: [number, number],
  circuitCoordFn: (node: TurnNode) => [number, number] | null,
  stopServiceTime = 120,
): StopInsertionResult {
  if (circuit.length === 0) {
    log.warn("Cannot insert stop into empty circuit");
    return { circuit: [], insertionIndex: 0, addedCostSeconds: 0 };
  }

  const searchFrom = Math.max(0, currentEdgeIdx + 1);

  let bestInsertIdx = searchFrom;
  let bestCost = Infinity;

  for (let i = searchFrom; i < circuit.length - 1; i++) {
    const exitNode = circuit[i]!.to;
    const entryNode = circuit[i + 1]!.from;

    const exitCoords = circuitCoordFn(exitNode);
    const entryCoords = circuitCoordFn(entryNode);
    if (!exitCoords || !entryCoords) continue;

    const costToStop = detourSeconds(exitCoords, stopCoords);
    const costFromStop = detourSeconds(stopCoords, entryCoords);
    // Original direct cost that we "replace" is the turn penalty edge between i and i+1
    const originalCost = circuit[i + 1]!.staticPenalty;
    const detourCost = costToStop + stopServiceTime + costFromStop - originalCost;

    if (detourCost < bestCost) {
      bestCost = detourCost;
      bestInsertIdx = i + 1;
    }
  }

  // Build synthetic stop node and two detour edges
  const stopNode: TurnNode = {
    edgeId: `detour:${stopCoords[0]}:${stopCoords[1]}:stop`,
    direction: "forward",
    intersectionId: `stop-${stopCoords[0]}-${stopCoords[1]}`,
  };

  const prevNode = circuit[bestInsertIdx - 1]!.to;
  const nextNode = circuit[bestInsertIdx]!.from;

  const prevCoords = circuitCoordFn(prevNode);
  const nextCoords = circuitCoordFn(nextNode);

  const approachCost = prevCoords ? detourSeconds(prevCoords, stopCoords) : 60;
  const departureCost = nextCoords ? detourSeconds(stopCoords, nextCoords) : 60;

  const approachEdge = buildDetourEdge(prevNode, stopNode, approachCost, "approach");
  const departureEdge = buildDetourEdge(stopNode, nextNode, departureCost, "depart");

  const newCircuit = [
    ...circuit.slice(0, bestInsertIdx),
    approachEdge,
    departureEdge,
    ...circuit.slice(bestInsertIdx),
  ];

  const addedCost = approachCost + stopServiceTime + departureCost;

  log.debug(
    `Emergency stop inserted at position ${bestInsertIdx} — +${addedCost.toFixed(0)}s`,
  );

  return {
    circuit: newCircuit,
    insertionIndex: bestInsertIdx,
    addedCostSeconds: addedCost,
  };
}
