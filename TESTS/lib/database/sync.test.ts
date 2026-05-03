import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock react-native Platform
vi.mock('react-native', () => ({
  Platform: {
    OS: 'ios', // Mock as ios to bypass Platform.OS === 'web' checks
  },
}));

// Mock NetInfo
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: vi.fn(),
  },
  fetch: vi.fn(),
}));

// Mock TaskManager and BackgroundFetch
vi.mock('expo-task-manager', () => ({
  defineTask: vi.fn(),
  isTaskRegisteredAsync: vi.fn(),
}));

vi.mock('expo-background-fetch', () => ({
  getStatusAsync: vi.fn(),
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
  BackgroundFetchStatus: {
    Available: 0,
    Restricted: 1,
    Denied: 2,
  },
  BackgroundFetchResult: {
    NoData: 0,
    NewData: 1,
    Failed: 2,
  },
}));

// Mock syncEngine
vi.mock('@/lib/database/sync/syncEngine', () => ({
  syncEngine: {
    attemptSync: vi.fn(),
  },
}));

describe('Background Sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register background sync when available', async () => {
    const { registerBackgroundSync } = await import('@/lib/database/sync/backgroundSync');
    const BackgroundFetch = await import('expo-background-fetch');
    const TaskManager = await import('expo-task-manager');

    vi.mocked(BackgroundFetch.getStatusAsync).mockResolvedValue(BackgroundFetch.BackgroundFetchStatus.Available);
    vi.mocked(TaskManager.isTaskRegisteredAsync).mockResolvedValue(false);

    await registerBackgroundSync(15);

    expect(BackgroundFetch.registerTaskAsync).toHaveBeenCalledWith(
      'background-sync',
      expect.objectContaining({
        minimumInterval: 15 * 60,
      })
    );
  });

  it('should not register if status is not available', async () => {
    const { registerBackgroundSync } = await import('@/lib/database/sync/backgroundSync');
    const BackgroundFetch = await import('expo-background-fetch');

    vi.mocked(BackgroundFetch.getStatusAsync).mockResolvedValue(BackgroundFetch.BackgroundFetchStatus.Denied);

    await registerBackgroundSync();

    expect(BackgroundFetch.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('should unregister background sync', async () => {
    const { unregisterBackgroundSync } = await import('@/lib/database/sync/backgroundSync');
    const BackgroundFetch = await import('expo-background-fetch');
    const TaskManager = await import('expo-task-manager');

    vi.mocked(TaskManager.isTaskRegisteredAsync).mockResolvedValue(true);

    await unregisterBackgroundSync();

    expect(BackgroundFetch.unregisterTaskAsync).toHaveBeenCalledWith('background-sync');
  });
});

describe('Sync Engine (Unit)', () => {
  it('should have a singleton instance', async () => {
    const { syncEngine } = await import('@/lib/database/sync/syncEngine');
    expect(syncEngine).toBeDefined();
  });
});
