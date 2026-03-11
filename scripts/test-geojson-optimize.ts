/*
 Run the local RouteOptimizer v2 against a GeoJSON file.

 Usage:
  pnpm tsx scripts/test-geojson-optimize.ts <path-to-geojson> [--start-lat <lat>] [--start-lon <lon>] [--merge-m <meters>] [--min-edge-m <meters>] [--strict]

 Outputs:
   - Writes <input>-route.geojson with the computed route LineString
   - Prints stats summary to stdout
*/

import { readFileSync, writeFileSync } from "fs";
import { basename, resolve } from "path";
import { RouteOptimizer } from "@/lib/route-optimizer-v2/routeOptimizer";
import type { TurnPenaltyWeights } from "@/lib/route-optimizer-v2/types";
import { geojsonToOsmData, routePointsToGeoJSON } from "@/lib/geojsonToOsmData";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i]! : "true";
      args[k] = v;
    } else rest.push(a);
  }
  return { args, rest };
}

async function main() {
  const { args, rest } = parseArgs(process.argv);
  const file = rest[0];
  if (!file) {
    console.error(
      "Usage: pnpm tsx scripts/test-geojson-optimize.ts <file.geojson> [--start-lat <lat>] [--start-lon <lon>]",
    );
    process.exit(1);
  }
  const p = resolve(process.cwd(), file);
  const raw = readFileSync(p, "utf8");
  const gj = JSON.parse(raw);

  const { nodes, ways } = geojsonToOsmData(gj, { vehicularOnly: true });
  console.log("[GeoJSON->OSM]", { nodes: nodes.size, ways: ways.length });

  const mergeM = args["merge-m"] ? Number(args["merge-m"]) : undefined;
  const strict = Boolean(args["strict"] && args["strict"] !== "false");
  const minEdge = args["min-edge-m"] ? Number(args["min-edge-m"]) : undefined;
  const optimizer = new RouteOptimizer(nodes, ways, "A", [], undefined, {
    mergeNearbyThresholdM: mergeM,
    antiLoopMode: strict ? "strict" : "standard",
    logLoopEvery: 25,
    minEdgeMeters: minEdge,
  });

  const lat = args["start-lat"] ? Number(args["start-lat"]) : undefined;
  const lon = args["start-lon"] ? Number(args["start-lon"]) : undefined;

  const penalties: TurnPenaltyWeights | undefined = undefined; // use defaults
  const res = optimizer.optimize(lat, lon, penalties);

  const out = routePointsToGeoJSON(res.route);
  const base = basename(p).replace(/\.geojson$/i, "");
  const outPath = resolve(process.cwd(), `${base}-route.geojson`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log("[Optimize]", {
    points: res.route.length,
    total_km: Number(res.totalDistance.toFixed(3)),
    message: res.message,
    stats: res.stats,
    out: outPath,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
