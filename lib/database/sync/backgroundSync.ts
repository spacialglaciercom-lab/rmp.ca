import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { syncEngine } from './syncEngine';
import { Platform } from 'react-native';

const BACKGROUND_SYNC_TASK = 'background-sync';

/**
 * Define the background sync task
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  console.log('[BackgroundSync] Task triggered');

  try {
    const result = await syncEngine.attemptSync();

    if (result.success) {
      console.log(`[BackgroundSync] Sync successful: ${result.pushed} pushed, ${result.pulled} pulled`);
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } else {
      console.log(`[BackgroundSync] Sync skipped or failed: ${result.reason || 'unknown'}`);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
  } catch (error) {
    console.error('[BackgroundSync] Task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register background sync task
 * @param intervalMinutes Minimum interval between syncs (default: 15)
 */
export async function registerBackgroundSync(intervalMinutes: number = 15) {
  if (Platform.OS === 'web') return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) {
      console.log('[BackgroundSync] Task already registered');
    }

    const status = await BackgroundFetch.getStatusAsync();
    if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
      console.warn('[BackgroundSync] Background fetch not available:', status);
      return;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: intervalMinutes * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });

    console.log(`[BackgroundSync] Registered with ${intervalMinutes}min interval`);
  } catch (error) {
    console.error('[BackgroundSync] Registration failed:', error);
  }
}

/**
 * Unregister background sync task
 */
export async function unregisterBackgroundSync() {
  if (Platform.OS === 'web') return;

  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
      console.log('[BackgroundSync] Unregistered');
    }
  } catch (error) {
    console.error('[BackgroundSync] Unregistration failed:', error);
  }
}
