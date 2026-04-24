import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  syncStatusStore,
  useIsSyncing,
  usePendingCount,
  useLastSyncAt,
  useBackgroundSyncEnabled,
} from '../syncStatusStore';

beforeEach(() => {
  syncStatusStore.setState({
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    lastError: null,
    backgroundSyncEnabled: true,
    syncIntervalMinutes: 15,
    wifiOnly: false,
  });
});

describe('initial state', () => {
  it('isSyncing is false', () => {
    expect(syncStatusStore.getState().isSyncing).toBe(false);
  });
  it('pendingCount is 0', () => {
    expect(syncStatusStore.getState().pendingCount).toBe(0);
  });
  it('lastSyncAt is null', () => {
    expect(syncStatusStore.getState().lastSyncAt).toBeNull();
  });
  it('lastError is null', () => {
    expect(syncStatusStore.getState().lastError).toBeNull();
  });
  it('backgroundSyncEnabled is true', () => {
    expect(syncStatusStore.getState().backgroundSyncEnabled).toBe(true);
  });
  it('syncIntervalMinutes is 15', () => {
    expect(syncStatusStore.getState().syncIntervalMinutes).toBe(15);
  });
  it('wifiOnly is false', () => {
    expect(syncStatusStore.getState().wifiOnly).toBe(false);
  });
});

describe('setters', () => {
  it('setIsSyncing updates isSyncing', () => {
    syncStatusStore.getState().setIsSyncing(true);
    expect(syncStatusStore.getState().isSyncing).toBe(true);
  });
  it('setPendingCount updates pendingCount', () => {
    syncStatusStore.getState().setPendingCount(7);
    expect(syncStatusStore.getState().pendingCount).toBe(7);
  });
  it('setLastSyncAt updates lastSyncAt', () => {
    const now = new Date();
    syncStatusStore.getState().setLastSyncAt(now);
    expect(syncStatusStore.getState().lastSyncAt).toEqual(now);
  });
  it('setLastSyncAt accepts null', () => {
    syncStatusStore.getState().setLastSyncAt(null);
    expect(syncStatusStore.getState().lastSyncAt).toBeNull();
  });
  it('setLastError updates lastError', () => {
    syncStatusStore.getState().setLastError('network timeout');
    expect(syncStatusStore.getState().lastError).toBe('network timeout');
  });
  it('setBackgroundSyncEnabled updates backgroundSyncEnabled', () => {
    syncStatusStore.getState().setBackgroundSyncEnabled(false);
    expect(syncStatusStore.getState().backgroundSyncEnabled).toBe(false);
  });
  it('setSyncIntervalMinutes updates syncIntervalMinutes', () => {
    syncStatusStore.getState().setSyncIntervalMinutes(30);
    expect(syncStatusStore.getState().syncIntervalMinutes).toBe(30);
  });
  it('setWifiOnly updates wifiOnly', () => {
    syncStatusStore.getState().setWifiOnly(true);
    expect(syncStatusStore.getState().wifiOnly).toBe(true);
  });
});

describe('clearError', () => {
  it('resets lastError to null', () => {
    syncStatusStore.getState().setLastError('something broke');
    syncStatusStore.getState().clearError();
    expect(syncStatusStore.getState().lastError).toBeNull();
  });

  it('does not affect other fields', () => {
    syncStatusStore.getState().setPendingCount(3);
    syncStatusStore.getState().setLastError('oops');
    syncStatusStore.getState().clearError();
    expect(syncStatusStore.getState().pendingCount).toBe(3);
  });
});

describe('updateStatus', () => {
  it('merges a partial state update', () => {
    syncStatusStore.getState().updateStatus({ isSyncing: true, pendingCount: 5 });
    expect(syncStatusStore.getState().isSyncing).toBe(true);
    expect(syncStatusStore.getState().pendingCount).toBe(5);
  });

  it('leaves untouched fields unchanged', () => {
    syncStatusStore.getState().setSyncIntervalMinutes(60);
    syncStatusStore.getState().updateStatus({ pendingCount: 1 });
    expect(syncStatusStore.getState().syncIntervalMinutes).toBe(60);
  });
});

describe('sync lifecycle', () => {
  it('transitions idle → syncing → success', () => {
    expect(syncStatusStore.getState().isSyncing).toBe(false);

    syncStatusStore.getState().setIsSyncing(true);
    expect(syncStatusStore.getState().isSyncing).toBe(true);

    const now = new Date();
    syncStatusStore.getState().updateStatus({ isSyncing: false, lastSyncAt: now, pendingCount: 0 });
    const s = syncStatusStore.getState();
    expect(s.isSyncing).toBe(false);
    expect(s.lastSyncAt).toEqual(now);
    expect(s.lastError).toBeNull();
  });

  it('transitions idle → syncing → error', () => {
    syncStatusStore.getState().setIsSyncing(true);
    syncStatusStore.getState().updateStatus({ isSyncing: false, lastError: 'request timed out' });
    const s = syncStatusStore.getState();
    expect(s.isSyncing).toBe(false);
    expect(s.lastError).toBe('request timed out');
  });
});

describe('selector hooks', () => {
  it('useIsSyncing is callable', () => {
    expect(typeof useIsSyncing).toBe('function');
  });
  it('usePendingCount is callable', () => {
    expect(typeof usePendingCount).toBe('function');
  });
  it('useLastSyncAt is callable', () => {
    expect(typeof useLastSyncAt).toBe('function');
  });
  it('useBackgroundSyncEnabled is callable', () => {
    expect(typeof useBackgroundSyncEnabled).toBe('function');
  });
});
