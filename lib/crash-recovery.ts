/**
 * Crash Recovery and Data Persistence
 * Automatically saves and restores application state
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RouteStatistics, RouteReport } from "@/types/routing";
import type { CollectionPoint } from "@/types";
import { sanitizeRouteStatistics } from "@/lib/export-utils";

const STORAGE_KEYS = {
  COLLECTION_POINTS: "trashroute_collection_points",
  ROUTE_STATISTICS: "trashroute_route_statistics",
  ROUTE_REPORT: "trashroute_route_report",
  GPX_DATA: "trashroute_gpx_data",
  OUTPUT_FILENAME: "trashroute_output_filename",
  LAST_ERROR: "trashroute_last_error",
  RECOVERY_TIMESTAMP: "trashroute_recovery_timestamp",
};

export interface RecoveryData {
  collectionPoints: CollectionPoint[];
  statistics: RouteStatistics | null;
  report: RouteReport | null;
  gpxData: string | null;
  outputFileName: string;
  timestamp: number;
}

/**
 * Save application state for crash recovery
 */
export async function saveRecoveryData(
  data: Partial<RecoveryData>,
): Promise<void> {
  try {
    const timestamp = Date.now();

    if (data.collectionPoints) {
      await AsyncStorage.setItem(
        STORAGE_KEYS.COLLECTION_POINTS,
        JSON.stringify(data.collectionPoints),
      );
    }

    if (data.statistics) {
      await AsyncStorage.setItem(
        STORAGE_KEYS.ROUTE_STATISTICS,
        JSON.stringify(data.statistics),
      );
    }

    if (data.report) {
      await AsyncStorage.setItem(
        STORAGE_KEYS.ROUTE_REPORT,
        JSON.stringify(data.report),
      );
    }

    if (data.gpxData) {
      await AsyncStorage.setItem(STORAGE_KEYS.GPX_DATA, data.gpxData);
    }

    if (data.outputFileName) {
      await AsyncStorage.setItem(
        STORAGE_KEYS.OUTPUT_FILENAME,
        data.outputFileName,
      );
    }

    // Update recovery timestamp
    await AsyncStorage.setItem(
      STORAGE_KEYS.RECOVERY_TIMESTAMP,
      timestamp.toString(),
    );
  } catch (error) {
    console.error("Failed to save recovery data:", error);
  }
}

/**
 * Load previously saved application state
 */
export async function loadRecoveryData(): Promise<RecoveryData | null> {
  try {
    const timestamp = await AsyncStorage.getItem(
      STORAGE_KEYS.RECOVERY_TIMESTAMP,
    );

    if (!timestamp) {
      return null;
    }

    // Check if recovery data is older than 24 hours
    const recoveryAge = Date.now() - parseInt(timestamp, 10);
    if (recoveryAge > 24 * 60 * 60 * 1000) {
      await clearRecoveryData();
      return null;
    }

    const collectionPointsStr = await AsyncStorage.getItem(
      STORAGE_KEYS.COLLECTION_POINTS,
    );
    const statisticsStr = await AsyncStorage.getItem(
      STORAGE_KEYS.ROUTE_STATISTICS,
    );
    const reportStr = await AsyncStorage.getItem(STORAGE_KEYS.ROUTE_REPORT);
    const gpxData = await AsyncStorage.getItem(STORAGE_KEYS.GPX_DATA);
    const outputFileName = await AsyncStorage.getItem(
      STORAGE_KEYS.OUTPUT_FILENAME,
    );

    const safeParse = <T>(str: string | null): T | null => {
      if (!str) return null;
      try {
        return JSON.parse(str) as T;
      } catch {
        return null;
      }
    };
    const statistics = safeParse<RouteStatistics>(statisticsStr);
    const report = safeParse<RouteReport>(reportStr);

    return {
      collectionPoints: safeParse<CollectionPoint[]>(collectionPointsStr) ?? [],
      statistics: statistics ? sanitizeRouteStatistics(statistics) : null,
      report: report ?? null,
      gpxData: gpxData || null,
      outputFileName: outputFileName || "trash_route",
      timestamp: parseInt(timestamp, 10),
    };
  } catch (error) {
    console.error("Failed to load recovery data:", error);
    return null;
  }
}

/**
 * Clear all recovery data
 */
export async function clearRecoveryData(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  } catch (error) {
    console.error("Failed to clear recovery data:", error);
  }
}

/**
 * Log error for debugging and report to Crashlytics when available (non-fatal).
 */
export async function logError(error: Error | string): Promise<void> {
  try {
    const errorMessage = typeof error === "string" ? error : error.message;
    const errorLog = {
      message: errorMessage,
      timestamp: new Date().toISOString(),
      stack: typeof error === "object" ? error.stack : undefined,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.LAST_ERROR,
      JSON.stringify(errorLog),
    );

    const { recordErrorToCrashlytics } =
      await import("@/lib/crashlytics-report");
    const err = typeof error === "string" ? new Error(error) : error;
    recordErrorToCrashlytics(err, "logError");
  } catch (err) {
    console.error("Failed to log error:", err);
  }
}

/**
 * Get last recorded error
 */
export async function getLastError(): Promise<string | null> {
  try {
    const errorStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_ERROR);
    if (!errorStr) return null;

    const error = JSON.parse(errorStr);
    return error.message;
  } catch (err) {
    return null;
  }
}

/**
 * Check if app crashed previously
 */
export async function checkForCrash(): Promise<boolean> {
  try {
    const recoveryData = await loadRecoveryData();
    const lastError = await getLastError();

    return !!(recoveryData || lastError);
  } catch (error) {
    return false;
  }
}

/**
 * Initialize crash recovery on app start
 */
export async function initializeCrashRecovery(): Promise<{
  hasCrashed: boolean;
  recoveryData: RecoveryData | null;
  lastError: string | null;
}> {
  try {
    const hasCrashed = await checkForCrash();
    const recoveryData = await loadRecoveryData();
    const lastError = await getLastError();

    return {
      hasCrashed,
      recoveryData,
      lastError,
    };
  } catch (error) {
    console.error("Failed to initialize crash recovery:", error);
    return {
      hasCrashed: false,
      recoveryData: null,
      lastError: null,
    };
  }
}
