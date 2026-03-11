/**
 * OSM Parser v2 (from route-optimizer-mobile-v2)
 * Uses @xmldom/xmldom (already in project) to parse OSM XML.
 * parseOSMFromFile supports local .osm/.xml (UTF-8) and .pbf (via tiny-osmpbf).
 */

import { DOMParser } from "@xmldom/xmldom";
import * as FileSystem from "expo-file-system/legacy";
import type { Node, Way, TurnRestriction } from "./types";
import { debug } from "./debug";

/** Match route-optimizer-mobile-v2 (Videos app) so Optimizer v2 gets the same graph from the same OSM file. */
const INCLUDED_HIGHWAYS = new Set([
  "residential",
  "tertiary",
  "secondary",
  "unclassified",
  "living_street",
  "tertiary_link",
  "secondary_link",
  "service",
  "track",
]);

const EXCLUDED_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "driveway",
  "footway",
  "cycleway",
  "path",
  "steps",
  "pedestrian",
  "bridleway",
  "corridor",
  "elevator",
  "platform",
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
      return {
        nodes: this.nodes,
        ways: this.ways,
        turnRestrictions: this.turnRestrictions,
      };
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
      if (!INCLUDED_HIGHWAYS.has(highway)) continue;
      // Service subtypes to exclude (match Videos app EXCLUDED_SERVICE_TYPES)
      if (highway === "service") {
        const service = tags["service"];
        if (
          service &&
          [
            "driveway",
            "parking_aisle",
            "parking",
            "private",
            "alley",
            "emergency_access",
          ].includes(service)
        )
          continue;
      }
      if (tags["area"] === "yes" || tags["area"] === "parking") continue;
      if (
        tags["access"] === "private" ||
        tags["access"] === "no" ||
        tags["access"] === "customers" ||
        tags["access"] === "permit"
      )
        continue;
      if (tags["amenity"] === "parking") continue;
      if (tags["ownership"] === "private" || tags["private"] === "yes")
        continue;

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
      sampleWayNodeRefs: this.ways
        .slice(0, 2)
        .map((w) => ({ id: w.id, nodes: w.nodes.slice(0, 4) })),
    });
    return {
      nodes: this.nodes,
      ways: this.ways,
      turnRestrictions: this.turnRestrictions,
    };
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

  /**
   * Parse OSM from a local file (Expo FileSystem URI).
   * Supports .osm / .xml (UTF-8) and .pbf (binary, via tiny-osmpbf).
   */
  async parseOSMFromFile(uri: string): Promise<ParseOSMResult> {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".pbf")) {
      return this.parsePBFFromFile(uri);
    }
    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return this.parseOSM(content);
  }

  private async parsePBFFromFile(uri: string): Promise<ParseOSMResult> {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary =
      typeof Buffer !== "undefined"
        ? Buffer.from(base64, "base64")
        : base64ToUint8Array(base64);
    const osmJson = parsePBFToOSMJson(binary);
    return this.buildParseResultFromOSMJson(osmJson);
  }

  private buildParseResultFromOSMJson(osmJson: OSMJsonRoot): ParseOSMResult {
    this.nodes.clear();
    this.ways = [];
    this.turnRestrictions = [];

    const elements = osmJson.elements ?? [];
    for (const el of elements) {
      if (el.type === "node" && "lat" in el && "lon" in el) {
        const id = String(el.id ?? "");
        const lat = Number(el.lat);
        const lon = Number(el.lon);
        if (id && !Number.isNaN(lat) && !Number.isNaN(lon)) {
          this.nodes.set(id, { id, lat, lon });
        }
      }
    }

    for (const el of elements) {
      if (el.type !== "way" || !("nodes" in el)) continue;
      const tags = (el.tags as Record<string, string>) ?? {};
      const highway = tags.highway;
      if (!highway || EXCLUDED_HIGHWAYS.has(highway)) continue;
      if (!INCLUDED_HIGHWAYS.has(highway) && highway !== "service") continue;
      const service = tags.service;
      if (
        service &&
        [
          "parking_aisle",
          "driveway",
          "parking",
          "drive-through",
          "emergency_access",
        ].includes(service)
      )
        continue;
      if (tags.area === "yes" || tags.area === "parking") continue;
      if (tags.access === "private") continue;

      const nodeRefs = (el.nodes ?? []).map(String);
      if (nodeRefs.length >= 2) {
        this.ways.push({
          id: String(el.id ?? ""),
          nodes: nodeRefs,
          tags,
        });
      }
    }

    for (const el of elements) {
      if (el.type !== "relation") continue;
      const tags = (el.tags as Record<string, string>) ?? {};
      if (tags.type !== "restriction") continue;
      const restriction = tags.restriction ?? tags["restriction:hgv"];
      if (restriction !== "no_u_turn") continue;

      const members =
        (el.members as Array<{ type?: string; role?: string; ref?: number }>) ??
        [];
      let fromWayId = "";
      let viaNodeId = "";
      let toWayId = "";
      for (const m of members) {
        if (m.role === "from" && m.type === "way")
          fromWayId = String(m.ref ?? "");
        if (m.role === "via" && m.type === "node")
          viaNodeId = String(m.ref ?? "");
        if (m.role === "to" && m.type === "way") toWayId = String(m.ref ?? "");
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

    debug("OSMParser.buildParseResultFromOSMJson", {
      nodesCount: this.nodes.size,
      waysCount: this.ways.length,
      turnRestrictionsCount: this.turnRestrictions.length,
    });
    return {
      nodes: this.nodes,
      ways: this.ways,
      turnRestrictions: this.turnRestrictions,
    };
  }
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface OSMJsonNode {
  type: "node";
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OSMJsonWay {
  type: "way";
  id?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface OSMJsonRelation {
  type: "relation";
  id?: number;
  members?: Array<{ type?: string; role?: string; ref?: number }>;
  tags?: Record<string, string>;
}

interface OSMJsonRoot {
  elements?: Array<OSMJsonNode | OSMJsonWay | OSMJsonRelation>;
}

function parsePBFToOSMJson(binary: Buffer | Uint8Array): OSMJsonRoot {
  try {
    const tinyOsmpbf = require("tiny-osmpbf");
    return tinyOsmpbf(binary) as OSMJsonRoot;
  } catch (e) {
    debug("OSMParser.parsePBF", { error: e });
    throw new Error("Failed to parse OSM PBF file. Is tiny-osmpbf installed?");
  }
}
