import { describe, it, expect, vi } from 'vitest';
import { solveRoute } from '../routeSolver';

// Mock trpc
vi.mock('../trpc', () => ({
  trpc: {
    spatial: {
      solveTSP: {
        mutate: vi.fn().mockResolvedValue({
          order: [0, 1],
          totalDistance: 100,
          totalDuration: 100,
          segments: [],
          algorithm: 'pgrouting'
        })
      }
    }
  }
}));

// Mock the native module
vi.mock('../../modules/route-optimizer', () => {
  return {
    RouteOptimizerModule: {
      solveRoute: vi.fn().mockResolvedValue({
        orderedIds: ['a', 'b'],
        totalDistanceM: 100,
        totalDurationS: 100,
        segments: [],
        algorithm: 'native-2-opt',
        solveTimeMs: 10
      })
    }
  };
});

describe('solveRoute FFI Integration', () => {
  it('calls the Rust native solver via RouteOptimizerModule when algorithm is 2-opt', async () => {
    const pts = [
      { id: 'a', lat: 45.00, lon: -73.00 },
      { id: 'b', lat: 45.10, lon: -73.00 }
    ];

    const res = await solveRoute(pts, { algorithm: '2-opt' });
    expect(res.algorithm).toBe('native-2-opt');
  });
});
