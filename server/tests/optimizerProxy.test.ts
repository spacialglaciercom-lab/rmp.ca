import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  nextPollDelay,
  injectVroomMatrix,
  submitAndPoll,
} from "../optimizerProxy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// nextPollDelay
// ---------------------------------------------------------------------------

describe("nextPollDelay", () => {
  it("starts at 1 000 ms for attempt 0", () => {
    expect(nextPollDelay(0)).toBe(1_000);
  });

  it("doubles on each attempt", () => {
    expect(nextPollDelay(1)).toBe(2_000);
    expect(nextPollDelay(2)).toBe(4_000);
    expect(nextPollDelay(3)).toBe(8_000);
    expect(nextPollDelay(4)).toBe(16_000);
    expect(nextPollDelay(5)).toBe(30_000); // capped
  });

  it("caps at 30 000 ms regardless of attempt count", () => {
    expect(nextPollDelay(10)).toBe(30_000);
    expect(nextPollDelay(100)).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// injectVroomMatrix
// ---------------------------------------------------------------------------

describe("injectVroomMatrix", () => {
  it("returns the same object when matrices is already present", () => {
    const body = { vehicles: [], jobs: [], matrices: { car: {} } };
    expect(injectVroomMatrix(body)).toBe(body);
  });

  it("replaces vehicle start/end coords with index references", () => {
    const body = {
      vehicles: [{ id: 1, start: [-73.9855, 40.758], end: [-73.9855, 40.759] }],
      jobs: [],
    };
    const result = injectVroomMatrix(body);
    const v = (result.vehicles as Record<string, unknown>[])[0];

    expect(v).not.toHaveProperty("start");
    expect(v).not.toHaveProperty("end");
    expect(v).toHaveProperty("start_index", 0);
    expect(v).toHaveProperty("end_index", 1);
  });

  it("replaces job location with location_index", () => {
    const body = {
      vehicles: [],
      jobs: [{ id: 1, location: [-73.9855, 40.758] }],
    };
    const result = injectVroomMatrix(body);
    const j = (result.jobs as Record<string, unknown>[])[0];

    expect(j).not.toHaveProperty("location");
    expect(j).toHaveProperty("location_index", 0);
  });

  it("deduplicates identical coordinates so the matrix stays small", () => {
    const coord = [-73.9855, 40.758] as [number, number];
    const body = {
      vehicles: [{ id: 1, start: coord }],
      jobs: [{ id: 1, location: coord }], // same coord as vehicle start
    };
    const result = injectVroomMatrix(body);
    const { durations, distances } = (
      result.matrices as { car: { durations: number[][]; distances: number[][] } }
    ).car;

    // Only one unique location → 1×1 matrix
    expect(durations).toHaveLength(1);
    expect(distances).toHaveLength(1);
    expect(distances[0][0]).toBe(0); // zero self-distance
  });

  it("computes non-zero distance and duration between distinct coords", () => {
    const body = {
      vehicles: [{ id: 1, start: [-73.9855, 40.758] }],
      jobs: [{ id: 1, location: [-73.975, 40.758] }], // ~0.01° lon apart
    };
    const result = injectVroomMatrix(body);
    const { durations, distances } = (
      result.matrices as { car: { durations: number[][]; distances: number[][] } }
    ).car;

    expect(distances[0][1]).toBeGreaterThan(0);
    expect(durations[0][1]).toBeGreaterThan(0);
    // Diagonal is always zero
    expect(distances[0][0]).toBe(0);
    expect(distances[1][1]).toBe(0);
  });

  it("produces a symmetric matrix (dist[i][j] === dist[j][i])", () => {
    const body = {
      vehicles: [{ id: 1, start: [-73.9855, 40.758] }],
      jobs: [{ id: 1, location: [-73.975, 40.765] }],
    };
    const result = injectVroomMatrix(body);
    const { distances } = (
      result.matrices as { car: { distances: number[][] } }
    ).car;

    expect(distances[0][1]).toBe(distances[1][0]);
  });
});

// ---------------------------------------------------------------------------
// submitAndPoll
// ---------------------------------------------------------------------------

describe("submitAndPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns 200 with the task result after SUCCESS", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if ((url as string).includes("/submit"))
        return jsonResp({ task_id: "t1", status: "PENDING" }, 202);
      pollCount++;
      if (pollCount >= 2)
        return jsonResp(
          { task_id: "t1", status: "SUCCESS", result: { route: [1, 2, 3] } },
          200,
        );
      return jsonResp({ task_id: "t1", status: "PROCESSING" }, 200);
    });

    const promise = submitAndPoll(
      "http://fake/submit",
      "http://fake/status",
      { features: [] },
      "test",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ route: [1, 2, 3] });
    expect(pollCount).toBe(2);
  });

  it("returns 500 with error details on FAILURE", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if ((url as string).includes("/submit"))
        return jsonResp({ task_id: "t2", status: "PENDING" }, 202);
      return jsonResp(
        { task_id: "t2", status: "FAILURE", error: "solver exploded" },
        500,
      );
    });

    const promise = submitAndPoll(
      "http://fake/submit",
      "http://fake/status",
      {},
      "test",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe("solver exploded");
    expect(body.task_id).toBe("t2");
  });

  it("forwards non-202 submit responses without entering the poll loop", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResp({ detail: "Unprocessable Entity" }, 422),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const promise = submitAndPoll(
      "http://fake/submit",
      "http://fake/status",
      {},
      "test",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(422);
    // fetch was called exactly once (the submit) — never polled
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers from transient network errors during polling and retries", async () => {
    let pollCount = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      if ((url as string).includes("/submit"))
        return jsonResp({ task_id: "t3", status: "PENDING" }, 202);
      pollCount++;
      if (pollCount === 1) throw new Error("ECONNRESET network blip");
      return jsonResp(
        { task_id: "t3", status: "SUCCESS", result: { ok: true } },
        200,
      );
    });

    const promise = submitAndPoll(
      "http://fake/submit",
      "http://fake/status",
      {},
      "test",
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(200);
    // First poll threw, second succeeded
    expect(pollCount).toBe(2);
  });

  it("returns 504 when polling exceeds the 10-minute deadline", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if ((url as string).includes("/submit"))
        return jsonResp({ task_id: "t4", status: "PENDING" }, 202);
      // Always PROCESSING — never finishes
      return jsonResp({ task_id: "t4", status: "PROCESSING" }, 200);
    });

    const promise = submitAndPoll(
      "http://fake/submit",
      "http://fake/status",
      {},
      "test",
    );

    // Advance fake clock past the 10-minute deadline
    await vi.advanceTimersByTimeAsync(11 * 60 * 1_000);
    const result = await promise;

    expect(result.status).toBe(504);
    const body = JSON.parse(result.body as string);
    expect(body.ok).toBe(false);
    expect(body.task_id).toBe("t4");
  });
});
