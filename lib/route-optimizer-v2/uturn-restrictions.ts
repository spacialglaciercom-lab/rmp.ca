/**
 * U-turn restriction logic for waste collection routing.
 * Prevents inefficient U-turns in two scenarios:
 * 1. Mid-block: U-turns at nodes with exactly 2 connected ways (same way both sides).
 * 2. OSM relations: type=restriction, restriction=no_u_turn.
 * 3. Way tags: u_turn=no, no_u_turn=yes, u_turn:hgv=no.
 *
 * Future: Restriction A (no U-turns around interior islands without addresses) would
 * require building an address spatial index (addr:housenumber, building=*) and
 * detecting loops that enclose address-less polygons (landuse=grass, leisure=park,
 * highway=traffic_island). Apply as soft penalty or dynamic restriction.
 */

import type { Way, TurnRestriction, UturnRestrictionSet } from "./types";
import { debug } from "./debug";

export interface GraphAccess {
  getEdgeWayId(from: string, to: string): string | undefined;
  getNeighbors(node: string): string[];
  nodeIds(): Iterable<string>;
}

/**
 * Build restriction sets from OSM data and graph structure.
 * - Mid-block: nodes with degree 2 where both edges belong to the same way (no U-turn).
 * - Relation: via nodes from restriction=no_u_turn relations.
 * - Way-based: way IDs with u_turn=no or no_u_turn=yes.
 */
export function buildUturnRestrictions(
  ways: Way[],
  turnRestrictions: TurnRestriction[],
  graph: GraphAccess,
  deadEndNodes: Set<string>,
): UturnRestrictionSet {
  const midBlockNoUturnNodes = new Set<string>();
  const relationNoUturnNodes = new Set<string>();
  const noUturnWayIds = new Set<string>();

  for (const way of ways) {
    const uTurnNo =
      way.tags?.["u_turn"] === "no" ||
      way.tags?.["no_u_turn"] === "yes" ||
      way.tags?.["u_turn:hgv"] === "no";
    if (uTurnNo && way.id) noUturnWayIds.add(way.id);
  }

  for (const r of turnRestrictions) {
    if (r.restriction === "no_u_turn" && r.viaNodeId) {
      relationNoUturnNodes.add(r.viaNodeId);
    }
  }

  for (const nodeId of graph.nodeIds()) {
    const neighbors = graph.getNeighbors(nodeId);
    if (neighbors.length !== 2) continue;
    if (deadEndNodes.has(nodeId)) continue;

    const [a, b] = neighbors;
    const wayIdA =
      graph.getEdgeWayId(nodeId, a) ?? graph.getEdgeWayId(a, nodeId);
    const wayIdB =
      graph.getEdgeWayId(nodeId, b) ?? graph.getEdgeWayId(b, nodeId);
    if (wayIdA && wayIdB && wayIdA === wayIdB) {
      midBlockNoUturnNodes.add(nodeId);
    }
  }

  debug("uturn-restrictions.build", {
    midBlockCount: midBlockNoUturnNodes.size,
    relationCount: relationNoUturnNodes.size,
    noUturnWayCount: noUturnWayIds.size,
  });

  return {
    midBlockNoUturnNodes,
    relationNoUturnNodes,
    noUturnWayIds,
  };
}

/**
 * Returns true if a U-turn at current (going back to prevNode) is forbidden.
 */
export function isUturnForbidden(
  prevNode: string,
  current: string,
  currentWayId: string | undefined,
  restrictions: UturnRestrictionSet,
): boolean {
  const atMidBlock = restrictions.midBlockNoUturnNodes.has(current);
  const atRelation = restrictions.relationNoUturnNodes.has(current);
  const wayForbids = Boolean(
    currentWayId && restrictions.noUturnWayIds.has(currentWayId),
  );
  return atMidBlock || atRelation || wayForbids;
}
