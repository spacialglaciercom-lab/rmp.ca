import type { StreetEdge, TurnNode, TurnEdge } from "@/types/turnAware";
import { DEFAULT_STATIC_PENALTIES } from "@/types/turnAware";
import { calculateBearing, classifyTurn } from "@/lib/_core/bearing";

const yieldToUI = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Progress callback for long-running pipeline steps. */
export type PipelineProgressCallback = (step: string, detail?: string) => void;

/**
 * Optional ML-derived penalties per OSM way id: baseTime is multiplied by (1 + penalty).
 * Used to bias the turn-aware CPP away from narrow / time-restricted edges.
 */
export type EdgePenaltyMultipliers = Map<string, number>;

/** Lightweight reference to a street edge in the adjacency list. */
interface AdjRef {
  /** Index into the streetEdges array. */
  idx: number;
  /** True when traversing the edge in reverse (bidirectional edge). */
  reversed: boolean;
}

function buildAdjacencyList(edges: StreetEdge[]): Map<string, AdjRef[]> {
  const adj = new Map<string, AdjRef[]>();
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    let fromList = adj.get(edge.from);
    if (!fromList) {
      fromList = [];
      adj.set(edge.from, fromList);
    }
    fromList.push({ idx: i, reversed: false });
    if (!edge.oneWay) {
      let toList = adj.get(edge.to);
      if (!toList) {
        toList = [];
        adj.set(edge.to, toList);
      }
      toList.push({ idx: i, reversed: true });
    }
  }
  return adj;
}

/** Transform street graph to turn-expanded graph. */
export async function buildTurnExpandedGraph(
  streetEdges: StreetEdge[],
  penalties: typeof DEFAULT_STATIC_PENALTIES = DEFAULT_STATIC_PENALTIES,
  edgePenaltyMultipliers?: EdgePenaltyMultipliers,
  onProgress?: PipelineProgressCallback,
): Promise<{ nodes: TurnNode[]; edges: TurnEdge[] }> {
  const adj = buildAdjacencyList(streetEdges);
  const turnNodes = new Map<string, TurnNode>();
  const turnEdges: TurnEdge[] = [];

  const forwardEntry = new Float64Array(streetEdges.length);
  const forwardExit = new Float64Array(streetEdges.length);
  const reverseEntry = new Float64Array(streetEdges.length);
  const reverseExit = new Float64Array(streetEdges.length);

  for (let i = 0; i < streetEdges.length; i++) {
    const coords = streetEdges[i]!.coordinates;
    if (coords.length < 2) continue;
    const last = coords.length - 1;
    forwardEntry[i] = calculateBearing(coords[0]!, coords[1]!);
    forwardExit[i] = calculateBearing(coords[last - 1]!, coords[last]!);
    reverseEntry[i] = calculateBearing(coords[last]!, coords[last - 1]!);
    reverseExit[i] = calculateBearing(coords[1]!, coords[0]!);
  }

  const baseTimeCache = new Float64Array(streetEdges.length);
  for (let i = 0; i < streetEdges.length; i++) {
    const e = streetEdges[i]!;
    const speedKmh = e.speed > 0 ? e.speed : 30;
    const bt = e.length / 1000 / (speedKmh / 3600);
    const mlPenalty = edgePenaltyMultipliers?.get(e.wayId ?? e.id) ?? 0;
    baseTimeCache[i] = bt * (1 + mlPenalty);
  }

  onProgress?.(
    "build-graph",
    `Pre-computed bearings for ${streetEdges.length} edges`,
  );
  await yieldToUI();

  for (let i = 0; i < streetEdges.length; i++) {
    const edge = streetEdges[i]!;
    turnNodes.set(`${edge.id}:forward`, {
      edgeId: edge.id,
      direction: "forward",
      intersectionId: edge.from,
    });
    if (!edge.oneWay) {
      turnNodes.set(`${edge.id}:backward`, {
        edgeId: edge.id,
        direction: "backward",
        intersectionId: edge.to,
      });
    }
  }

  const processOutgoing = (
    incomingIdx: number,
    incomingReversed: boolean,
    incomingBearing: number,
    intersectionId: string,
    fromNode: TurnNode,
    idPrefix: string,
  ) => {
    const outgoing = adj.get(intersectionId);
    if (!outgoing) return;
    const incomingId = streetEdges[incomingIdx]!.id;

    for (let j = 0; j < outgoing.length; j++) {
      const ref = outgoing[j]!;
      const outEdge = streetEdges[ref.idx]!;

      if (outEdge.id === incomingId && ref.reversed === incomingReversed)
        continue;

      if (outEdge.coordinates.length < 2) continue;

      const outgoingBearing = ref.reversed
        ? reverseEntry[ref.idx]!
        : forwardEntry[ref.idx]!;
      const turnType = classifyTurn(incomingBearing, outgoingBearing);
      const penalty = penalties[turnType];
      const baseTime = baseTimeCache[ref.idx]!;

      const outDirection: "forward" | "backward" = ref.reversed
        ? "backward"
        : "forward";
      const toIntersection = ref.reversed ? outEdge.to : outEdge.from;

      turnEdges.push({
        id: `${idPrefix}->${outEdge.id}${ref.reversed ? ":r" : ""}`,
        from: fromNode,
        to: {
          edgeId: outEdge.id,
          direction: outDirection,
          intersectionId: toIntersection,
        },
        turnType,
        staticPenalty: penalty,
        baseTime,
        totalCost: baseTime + penalty,
      });
    }
  };

  for (let i = 0; i < streetEdges.length; i++) {
    const incoming = streetEdges[i]!;
    if (incoming.coordinates.length < 2) continue;

    processOutgoing(
      i,
      false,
      forwardExit[i]!,
      incoming.to,
      {
        edgeId: incoming.id,
        direction: "forward",
        intersectionId: incoming.to,
      },
      incoming.id,
    );

    if (!incoming.oneWay) {
      processOutgoing(
        i,
        true,
        reverseExit[i]!,
        incoming.from,
        {
          edgeId: incoming.id,
          direction: "backward",
          intersectionId: incoming.from,
        },
        `${incoming.id}:b`,
      );
    }

    if (i > 0 && i % 200 === 0) await yieldToUI();
  }

  return {
    nodes: Array.from(turnNodes.values()),
    edges: turnEdges,
  };
}
