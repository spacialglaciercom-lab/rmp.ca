import { vi } from 'vitest';

// Fix the undefined Expo EventEmitter
vi.mock('expo-modules-core', async (importOriginal) => {
  const actual: any = await importOriginal();
  class MockEventEmitter {
    addListener() { return { remove: vi.fn() }; }
    removeAllListeners() {}
    emit() {}
  }

  return {
    ...actual,
    EventEmitter: MockEventEmitter,
    requireNativeModule: vi.fn().mockImplementation((name) => {
      if (name === 'RouteOptimizer') {
        return {
          solveCppFromGeojson: vi.fn().mockResolvedValue({
            orderedIds: [],
            totalDistanceM: 0,
            totalDurationS: 0,
            segments: [],
            algorithm: 'cpp-rust',
            solveTimeMs: 0
          })
        };
      }
      return new MockEventEmitter();
    }),
  };
});
