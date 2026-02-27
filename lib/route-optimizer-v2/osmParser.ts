/**
 * OSM Parser v2 (from route-optimizer-mobile-v2)
 * Uses @xmldom/xmldom (already in project) to parse OSM XML
 */

import { DOMParser } from "@xmldom/xmldom";
import type { Node, Way, TurnRestriction } from "./types";
import { debug } from "./debug";

/** Align with lib/osm-filter.ts: same allowed tags for trash collection routes. */
const INCLUDED_HIGHWAYS = new Set([
  "residential",
  "unclassified",
  "tertiary",
  "secondary",
]);

const EXCLUDED_HIGHWAYS = new Set([
  "footway",
  "cycleway",
  "steps",
  "path",
  "track",
  "bridleway",
  "pedestrian",
  "corridor",
  "elevator",
  "platform",
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
]);

export interface ParseOSMResult {
  nodes: Map<string, Node>;
  ways: Way[];
  /** Turn restrictions (no_u_turn etc.) from OSM relations */
  turnRestrictions: TurnRestriction[];
}

function getChildElements(parent: Element, tagName: string): Element[] {
  const list: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const child = parent.childNodes[i];
    if (child.nodeType === 1 && (child as Element).tagName === tagName) {
      list.push(child as Element);
    }
  }
  return list;
}

export class OSMParser {
  private nodes: Map<string, Node> = new Map();
  private ways: Way[] = [];
  private domParser: DOMParser;

  constructor() {
    this.domParser = new DOMParser();
  }

  private turnRestrictions: TurnRestriction[] = [];

  parseOSM(osmContent: string): ParseOSMResult {
    this.nodes.clear();
    this.ways = [];
    this.turnRestrictions = [];

    const doc = this.domParser.parseFromString(osmContent, "text/xml");
    const osm = doc.documentElement;
    if (!osm || osm.tagName !== "osm") {
      return { nodes: this.nodes, ways: this.ways, turnRestrictions: this.turnRestrictions };
    }

    const rawNodes = getChildElements(osm, "node");
    for (const el of rawNodes) {
      const id = el.getAttribute("id") ?? "";
      const lat = parseFloat(el.getAttribute("lat") ?? "");
      const lon = parseFloat(el.getAttribute("lon") ?? "");
      if (id && !Number.isNaN(lat) && !Number.isNaN(lon)) {
        this.nodes.set(id, { id, lat, lon });
      }
    }

    const rawWays = getChildElements(osm, "way");
    for (const wayEl of rawWays) {
      const tags: Record<string, string> = {};
      const tagEls = getChildElements(wayEl, "tag");
      for (const tag of tagEls) {
        const k = tag.getAttribute("k");
        const v = tag.getAttribute("v");
        if (k && v) tags[k] = v;
      }

      const highway = tags["highway"];
      if (!highway || EXCLUDED_HIGHWAYS.has(highway)) continue;
      if (INCLUDED_HIGHWAYS.has(highway)) {
        // included
      } else if (highway === "service" && tags["service"] === "alley") {
        // service=alley only (matches osm-filter)
      } else {
        continue;
      }
      const service = tags["service"];
      if (service && ["parking_aisle", "driveway", "parking", "drive-through", "emergency_access"].includes(service))
        continue;
      if (tags["area"] === "yes" || tags["area"] === "parking") continue;
      if (tags["access"] === "private") continue;

      const nodeRefs: string[] = [];
      const ndEls = getChildElements(wayEl, "nd");
      for (const nd of ndEls) {
        const ref = nd.getAttribute("ref");
        if (ref) nodeRefs.push(ref);
      }

      if (nodeRefs.length >= 2) {
        this.ways.push({
          id: wayEl.getAttribute("id") ?? "",
          nodes: nodeRefs,
          tags,
        });
      }
    }

    const rawRelations = getChildElements(osm, "relation");
    for (const relEl of rawRelations) {
      const tags: Record<string, string> = {};
      const tagEls = getChildElements(relEl, "tag");
      for (const tag of tagEls) {
        const k = tag.getAttribute("k");
        const v = tag.getAttribute("v");
        if (k && v) tags[k] = v;
      }
      if (tags["type"] !== "restriction") continue;
      const restriction = tags["restriction"] ?? tags["restriction:hgv"];
      if (restriction !== "no_u_turn") continue;

      let fromWayId = "";
      let viaNodeId = "";
      let toWayId = "";
      const members = getChildElements(relEl, "member");
      for (const m of members) {
        const role = m.getAttribute("role") ?? "";
        const ref = m.getAttribute("ref") ?? "";
        const typeAttr = m.getAttribute("type") ?? "";
        if (role === "from" && typeAttr === "way") fromWayId = ref;
        if (role === "via" && typeAttr === "node") viaNodeId = ref;
        if (role === "to" && typeAttr === "way") toWayId = ref;
      }
      if (fromWayId && viaNodeId && toWayId) {
        this.turnRestrictions.push({
          fromWayId,
          viaNodeId,
          toWayId,
          restriction: "no_u_turn",
          hgv: tags["restriction:hgv"] === "no_u_turn",
        });
      }
    }

    debug("OSMParser.parseOSM", {
      nodesCount: this.nodes.size,
      waysCount: this.ways.length,
      turnRestrictionsCount: this.turnRestrictions.length,
      sampleNodeIds: Array.from(this.nodes.keys()).slice(0, 5),
      sampleWayNodeRefs: this.ways.slice(0, 2).map((w) => ({ id: w.id, nodes: w.nodes.slice(0, 4) })),
    });
    return { nodes: this.nodes, ways: this.ways, turnRestrictions: this.turnRestrictions };
  }

  getNodes(): Map<string, Node> {
    return this.nodes;
  }

  getWays(): Way[] {
    return this.ways;
  }

  getTurnRestrictions(): TurnRestriction[] {
    return this.turnRestrictions;
  }
}
