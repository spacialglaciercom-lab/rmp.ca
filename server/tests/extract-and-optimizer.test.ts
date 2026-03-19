/**
 * Integration tests for extract and optimizer connectivity.
 * Run against a live backend when TEST_API_BASE_URL is set (e.g. http://localhost:3000).
 * Skip when not set so CI and unit-test runs don't require services.
 */
import { describe, it, expect } from "vitest";

const API_BASE = process.env.TEST_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

const shouldRun = Boolean(API_BASE && API_BASE.startsWith("http"));

describe.skipIf(!shouldRun)(
  "extract and optimizer connectivity (live backend)",
  () => {
  it("backend health returns 200", async () => {
    const url = `${API_BASE.replace(/\/$/, "")}/api/health`;
    const { ok, status } = await fetchJson(url);
    expect(ok, `GET ${url} should return 200, got ${status}`).toBe(true);
  });

  it("optimizer health returns ok or not_configured", async () => {
    // Backend proxies GET /optimizer/health to the Python optimizer
    const url = `${API_BASE.replace(/\/$/, "")}/optimizer/health`;
    const { ok, status, data } = await fetchJson(url);
    expect(
      ok || status === 502,
      `GET ${url} should return 200 or 502 (proxy down), got ${status}`,
    ).toBe(true);
    if (ok && data && typeof data === "object" && "status" in data) {
      // Python optimizer returns { status: "ok" } or similar
      expect(["ok", "not_configured", "unreachable"]).toContain((data as { status: string }).status);
    }
  });

  it("extract GeoJSON proxy responds (404 for unknown hash is ok)", async () => {
    const url = `${API_BASE.replace(/\/$/, "")}/geojson/test-nonexistent-hash-12345`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    // 404 = extract service replied "not found" (proxy works). 502 = extract unreachable.
    expect(
      [200, 404, 502].includes(res.status),
      `GET ${url} should return 200/404/502, got ${res.status}`,
    ).toBe(true);
    if (res.status === 502) {
      console.warn("Extract proxy returned 502 — extract service may be offline. Start it with: pnpm run dev:extract");
    }
  });
  },
);
