/**
 * Network utilities for offline-first functionality.
 * Provides cross-platform network state detection.
 */

import { Platform } from "react-native";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

export interface NetworkState {
  isConnected: boolean;
  isInternetReachable: boolean;
  type: string;
}

/**
 * Get current network state
 * Returns a normalized network state object
 */
export async function getNetworkState(): Promise<NetworkState> {
  // On web platform, assume connected
  if (Platform.OS === "web") {
    // Try to use navigator.onLine for web
    if (typeof navigator !== "undefined") {
      return {
        isConnected: navigator.onLine,
        isInternetReachable: navigator.onLine,
        type: "unknown",
      };
    }
    return {
      isConnected: true,
      isInternetReachable: true,
      type: "unknown",
    };
  }

  const state = await NetInfo.fetch();

  return {
    isConnected: state.isConnected ?? false,
    isInternetReachable: state.isInternetReachable ?? false,
    type: state.type ?? "unknown",
  };
}

/**
 * Subscribe to network state changes
 * Returns unsubscribe function
 */
export function subscribeToNetworkState(
  callback: (state: NetworkState) => void
): () => void {
  if (Platform.OS === "web") {
    // Web implementation using online/offline events
    const handleOnline = () => {
      callback({
        isConnected: true,
        isInternetReachable: true,
        type: "unknown",
      });
    };

    const handleOffline = () => {
      callback({
        isConnected: false,
        isInternetReachable: false,
        type: "unknown",
      });
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }

  // Native implementation using NetInfo
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    callback({
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable ?? false,
      type: state.type ?? "unknown",
    });
  });

  return unsubscribe;
}

/**
 * Check if device is currently online
 */
export async function isOnline(): Promise<boolean> {
  const state = await getNetworkState();
  return state.isConnected && state.isInternetReachable;
}