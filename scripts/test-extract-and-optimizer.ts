#!/usr/bin/env npx tsx
/**
 * Troubleshooting script: check backend, extract, and optimizer connectivity.
 * Run with: pnpm run test:services
 * Or: npx tsx scripts/test-extract-and-optimizer.ts
 *
 * Set API_BASE to test a different backend (e.g. http://localhost:3000).
 */
const API_BASE = process.env.TEST_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

async function fetchStatus(url: string): Promise<{ ok: boolean; status: number; body?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body: body.slice(0, 200) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  Error: ${msg}`);
    return { ok: false, status: -1 };
  }
}

async function main() {
  const base = API_BASE.replace(/\/$/, "");
  console.log("Testing connectivity (API_BASE =", base, ")\n");

  // 1. Backend health
  const healthUrl = `${base}/api/health`;
  process.stdout.write("1. Backend health GET /api/health ... ");
  const health = await fetchStatus(healthUrl);
  if (health.ok) {
    console.log("OK", health.status);
  } else {
    console.log("FAIL", health.status);
    console.log("   → Start the backend: pnpm run dev:server (or docker compose up for backend)");
    process.exitCode = 1;
  }

  // 2. Optimizer health (proxied by backend)
  const optUrl = `${base}/optimizer/health`;
  process.stdout.write("2. Optimizer health GET /optimizer/health ... ");
  const opt = await fetchStatus(optUrl);
  if (opt.ok) {
    let status = "unknown";
    try {
      const data = opt.body ? JSON.parse(opt.body) : {};
      status = data.status ?? status;
    } catch {}
    console.log("OK", opt.status, "status:", status);
    if (status !== "ok") {
      console.log("   → Optimizer is not configured or unreachable. With Docker: use optimizer profile:");
      console.log("     docker compose -f docker-compose.yml -f docker-compose.optimizer.yml --profile optimizer up");
    }
  } else if (opt.status === 502) {
    console.log("502 (proxy could not reach optimizer)");
    console.log("   → Optimizer backend is offline. Start it or use Docker with optimizer profile.");
    process.exitCode = 1;
  } else {
    console.log("FAIL", opt.status);
    process.exitCode = 1;
  }

  // 3. Extract GeoJSON proxy (backend → extract service)
  const geojsonUrl = `${base}/geojson/test-nonexistent-hash`;
  process.stdout.write("3. Extract proxy GET /geojson/:hash ... ");
  const geo = await fetchStatus(geojsonUrl);
  if (geo.status === 404) {
    console.log("OK 404 (proxy works; hash not found is expected)");
  } else if (geo.status === 200) {
    console.log("OK 200 (proxy and extract responded)");
  } else if (geo.status === 502) {
    console.log("502 (extract service unreachable)");
    console.log("   → Start the extract service: pnpm run dev:extract");
    console.log("   → Or with Docker: ensure extract container is running (docker compose up)");
    process.exitCode = 1;
  } else {
    console.log(geo.status === -1 ? "Error" : "FAIL " + geo.status);
    process.exitCode = 1;
  }

  console.log("");
  if (process.exitCode === 0) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. Fix the issues above and run again.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
