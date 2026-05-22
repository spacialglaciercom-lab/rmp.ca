import { describe, it, expect, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  AFTER_FIRST_UNLOCK: 0,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  ALWAYS: 2,
  ALWAYS_THIS_DEVICE_ONLY: 3,
  WHEN_UNLOCKED: 4,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 6,
}));

vi.mock('expo-modules-core', () => ({
  requireNativeModule: vi.fn(),
  EventEmitter: vi.fn()
}));
vi.mock('expo-linking', () => ({}));
vi.mock('expo-router', () => ({}));
vi.mock('expo-constants', () => ({}));

import { solveRoute } from '../routeSolver';

// Mock the native module which bridges Rust FFI and TypeScript
vi.mock('../../modules/route-optimizer', () => {
  return {
    RouteOptimizerModule: {
      solveRoute: vi.fn().mockResolvedValue({
        orderedIds: ['mock-1', 'mock-2'],
        totalDistanceM: 1200,
        totalDurationS: 600,
        segments: [
          { fromId: 'mock-1', toId: 'mock-2', distanceM: 1200, durationS: 600 }
        ],
        algorithm: 'native-2-opt-mock',
        solveTimeMs: 42
      })
    }
  };
});

describe('Golden File Test - RouteSolver (TypeScript -> Rust FFI Bridge)', () => {
  it('correctly maps input points to the native solver and returns SolverResult', async () => {
    // 1. Arrange
    const pts = [
      { id: 'mock-1', lat: 45.0, lon: -73.0, demand: 0, serviceTime: 120 },
      { id: 'mock-2', lat: 45.1, lon: -73.1, demand: 0, serviceTime: 120 }
    ];

    // 2. Act
    const result = await solveRoute(pts, { algorithm: '2-opt' });

    // 3. Assert (Snapshot)
    expect(result).toMatchInlineSnapshot(`
      {
        "algorithm": "native-2-opt-mock",
        "orderedPoints": [
          {
            "demand": 0,
            "id": "mock-1",
            "lat": 45,
            "lon": -73,
            "serviceTime": 120,
          },
          {
            "demand": 0,
            "id": "mock-2",
            "lat": 45.1,
            "lon": -73.1,
            "serviceTime": 120,
          },
        ],
        "segments": [
          {
            "distance": 1200,
            "duration": 600,
            "from": "mock-1",
            "to": "mock-2",
          },
        ],
        "solveTime": 42,
        "totalDistance": 1200,
        "totalDuration": 600,
      }
    `);
  });
});
